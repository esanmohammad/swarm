import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import type { Command } from 'commander';
import { requireSwarmDir, loadConfig } from '../core/config.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BenchmarkResult {
  name: string;
  opsPerSec?: number;
  avgMs?: number;
  minMs?: number;
  maxMs?: number;
  samples?: number;
}

export interface BundleSizeInfo {
  totalBytes: number;
  files: number;
}

export interface BenchmarkReport {
  results: BenchmarkResult[];
  bundleSize?: BundleSizeInfo;
  startupTimeMs?: number;
  timestamp: number;
  gitSha: string;
  regressions: Array<{ name: string; baseline: number; current: number; changePercent: number }>;
  improvements: Array<{ name: string; baseline: number; current: number; changePercent: number }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getGitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function getBaselinePath(swarmDir: string): string {
  return join(swarmDir, 'benchmark-baseline.json');
}

function getHistoryPath(swarmDir: string): string {
  return join(swarmDir, 'benchmark-history.json');
}

function loadBaseline(swarmDir: string): BenchmarkReport | null {
  const p = getBaselinePath(swarmDir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function saveBaseline(swarmDir: string, report: BenchmarkReport): void {
  writeFileSync(getBaselinePath(swarmDir), JSON.stringify(report, null, 2));
}

function loadHistory(swarmDir: string): BenchmarkReport[] {
  const p = getHistoryPath(swarmDir);
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return [];
  }
}

function appendHistory(swarmDir: string, report: BenchmarkReport): void {
  const history = loadHistory(swarmDir);
  history.push(report);
  // Keep last 20 entries
  const trimmed = history.slice(-20);
  writeFileSync(getHistoryPath(swarmDir), JSON.stringify(trimmed, null, 2));
}

// ─── Benchmark detection ─────────────────────────────────────────────────────

type BenchType = 'node-script' | 'vitest-bench' | 'jest-bench' | 'go-bench' | 'pytest-bench' | 'custom';

interface DetectedBench {
  type: BenchType;
  cmd: string;
  label: string;
}

function detectBenchmark(cwd: string): DetectedBench | null {
  // Node.js: check package.json for bench script
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.scripts?.bench) {
        return { type: 'node-script', cmd: 'npm run bench', label: 'npm run bench' };
      }
      if (pkg.scripts?.benchmark) {
        return { type: 'node-script', cmd: 'npm run benchmark', label: 'npm run benchmark' };
      }
    } catch { /* ignore */ }

    // Vitest bench
    if (existsSync(join(cwd, 'node_modules', 'vitest'))) {
      return { type: 'vitest-bench', cmd: 'npx vitest bench --reporter=json', label: 'vitest bench' };
    }

    // Jest bench (jest-bench-runner)
    if (existsSync(join(cwd, 'node_modules', 'jest-bench'))) {
      return { type: 'jest-bench', cmd: 'npx jest --config jest.bench.config.js', label: 'jest bench' };
    }
  }

  // Go
  if (existsSync(join(cwd, 'go.mod'))) {
    return { type: 'go-bench', cmd: 'go test -bench=. -benchmem ./...', label: 'go test -bench' };
  }

  // Python pytest-benchmark
  if (existsSync(join(cwd, 'setup.py')) || existsSync(join(cwd, 'pyproject.toml')) || existsSync(join(cwd, 'requirements.txt'))) {
    return { type: 'pytest-bench', cmd: 'pytest --benchmark-only --benchmark-json=.swarm/pytest-bench.json', label: 'pytest benchmark' };
  }

  return null;
}

// ─── Output parsers ──────────────────────────────────────────────────────────

function parseVitestBenchOutput(output: string): BenchmarkResult[] {
  const results: BenchmarkResult[] = [];
  // Vitest bench outputs lines like: "benchName   1,234 ops/sec  ±1.23%  (100 samples)"
  const lineRe = /^\s*(.+?)\s+([\d,.]+)\s+ops\/sec\s+.*?\((\d+)\s+samples?\)/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(output))) {
    results.push({
      name: m[1].trim(),
      opsPerSec: parseFloat(m[2].replace(/,/g, '')),
      samples: parseInt(m[3]),
    });
  }
  return results;
}

function parseGoBenchOutput(output: string): BenchmarkResult[] {
  const results: BenchmarkResult[] = [];
  // Go bench: BenchmarkXxx-8   123456   9876 ns/op   1234 B/op   12 allocs/op
  const lineRe = /^(Benchmark\S+)\s+(\d+)\s+([\d.]+)\s+ns\/op/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(output))) {
    const nsPerOp = parseFloat(m[3]);
    results.push({
      name: m[1],
      avgMs: nsPerOp / 1e6,
      opsPerSec: 1e9 / nsPerOp,
      samples: parseInt(m[2]),
    });
  }
  return results;
}

function parsePytestBenchOutput(swarmDir: string): BenchmarkResult[] {
  const results: BenchmarkResult[] = [];
  const jsonPath = join(swarmDir, 'pytest-bench.json');
  if (!existsSync(jsonPath)) return results;
  try {
    const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    for (const bench of data.benchmarks || []) {
      results.push({
        name: bench.name,
        avgMs: (bench.stats?.mean ?? 0) * 1000,
        minMs: (bench.stats?.min ?? 0) * 1000,
        maxMs: (bench.stats?.max ?? 0) * 1000,
        opsPerSec: bench.stats?.ops ?? undefined,
        samples: bench.stats?.rounds ?? undefined,
      });
    }
  } catch { /* ignore */ }
  return results;
}

function parseGenericOutput(output: string): BenchmarkResult[] {
  const results: BenchmarkResult[] = [];
  // Try to find "name ... X ops/sec" or "name ... Xms" patterns
  const opsRe = /^\s*(.+?)\s+([\d,.]+)\s+ops\/sec/gm;
  let m: RegExpExecArray | null;
  while ((m = opsRe.exec(output))) {
    results.push({
      name: m[1].trim(),
      opsPerSec: parseFloat(m[2].replace(/,/g, '')),
    });
  }

  // Also try "name ... X ms" patterns
  if (results.length === 0) {
    const msRe = /^\s*(.+?)\s+([\d,.]+)\s*ms/gm;
    while ((m = msRe.exec(output))) {
      results.push({
        name: m[1].trim(),
        avgMs: parseFloat(m[2].replace(/,/g, '')),
      });
    }
  }

  return results;
}

// ─── Bundle size measurement ─────────────────────────────────────────────────

function measureBundleSize(cwd: string): BundleSizeInfo | undefined {
  const distDir = join(cwd, 'dist');
  if (!existsSync(distDir)) return undefined;

  let totalBytes = 0;
  let fileCount = 0;

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else {
        totalBytes += st.size;
        fileCount++;
      }
    }
  }

  try {
    walk(distDir);
    return { totalBytes, files: fileCount };
  } catch {
    return undefined;
  }
}

// ─── Startup time measurement ────────────────────────────────────────────────

function measureStartupTime(cwd: string): number | undefined {
  // Look for common entry points
  const candidates = [
    'dist/index.js',
    'dist/main.js',
    'dist/bin/swarm.js',
    'dist/cli.js',
  ];

  let entryPoint: string | null = null;
  for (const c of candidates) {
    if (existsSync(join(cwd, c))) {
      entryPoint = c;
      break;
    }
  }
  if (!entryPoint) return undefined;

  try {
    const start = performance.now();
    execSync(`node ${entryPoint} --help`, { cwd, timeout: 10000, stdio: 'pipe' });
    return performance.now() - start;
  } catch {
    return undefined;
  }
}

// ─── Comparison logic ────────────────────────────────────────────────────────

function compareResults(
  current: BenchmarkResult[],
  baseline: BenchmarkResult[],
  threshold: number,
): { regressions: BenchmarkReport['regressions']; improvements: BenchmarkReport['improvements'] } {
  const regressions: BenchmarkReport['regressions'] = [];
  const improvements: BenchmarkReport['improvements'] = [];

  const baselineMap = new Map(baseline.map(b => [b.name, b]));

  for (const cur of current) {
    const base = baselineMap.get(cur.name);
    if (!base) continue;

    // Compare ops/sec (higher is better)
    if (cur.opsPerSec != null && base.opsPerSec != null && base.opsPerSec > 0) {
      const changePct = ((cur.opsPerSec - base.opsPerSec) / base.opsPerSec) * 100;
      if (changePct < -threshold) {
        regressions.push({ name: cur.name, baseline: base.opsPerSec, current: cur.opsPerSec, changePercent: changePct });
      } else if (changePct > threshold) {
        improvements.push({ name: cur.name, baseline: base.opsPerSec, current: cur.opsPerSec, changePercent: changePct });
      }
      continue;
    }

    // Compare avgMs (lower is better)
    if (cur.avgMs != null && base.avgMs != null && base.avgMs > 0) {
      const changePct = ((cur.avgMs - base.avgMs) / base.avgMs) * 100;
      if (changePct > threshold) {
        regressions.push({ name: cur.name, baseline: base.avgMs, current: cur.avgMs, changePercent: changePct });
      } else if (changePct < -threshold) {
        improvements.push({ name: cur.name, baseline: base.avgMs, current: cur.avgMs, changePercent: changePct });
      }
    }
  }

  return { regressions, improvements };
}

// ─── Display ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function printReport(report: BenchmarkReport, baseline: BenchmarkReport | null): void {
  console.log(chalk.bold(`\nBenchmark Report — ${new Date(report.timestamp).toLocaleString()}`));
  console.log(chalk.dim(`  Git SHA: ${report.gitSha}\n`));

  if (report.results.length > 0) {
    console.log(chalk.bold('  Results'));
    for (const r of report.results) {
      const parts: string[] = [`    ${r.name}`];
      if (r.opsPerSec != null) parts.push(`${r.opsPerSec.toLocaleString()} ops/sec`);
      if (r.avgMs != null) parts.push(`${r.avgMs.toFixed(3)} ms`);
      if (r.samples != null) parts.push(`(${r.samples} samples)`);
      console.log(parts.join('  '));
    }
    console.log('');
  }

  if (report.bundleSize) {
    console.log(chalk.bold('  Bundle Size'));
    console.log(`    Total: ${formatBytes(report.bundleSize.totalBytes)}  (${report.bundleSize.files} files)`);
    if (baseline?.bundleSize) {
      const diff = report.bundleSize.totalBytes - baseline.bundleSize.totalBytes;
      const pct = baseline.bundleSize.totalBytes > 0
        ? ((diff / baseline.bundleSize.totalBytes) * 100).toFixed(1)
        : '0';
      const color = diff > 0 ? chalk.red : diff < 0 ? chalk.green : chalk.dim;
      const sign = diff > 0 ? '+' : '';
      console.log(`    Change: ${color(`${sign}${formatBytes(diff)} (${sign}${pct}%)`)}`);
    }
    console.log('');
  }

  if (report.startupTimeMs != null) {
    console.log(chalk.bold('  Startup Time'));
    console.log(`    ${report.startupTimeMs.toFixed(0)} ms`);
    console.log('');
  }

  if (report.regressions.length > 0) {
    console.log(chalk.bold.red('  Regressions'));
    for (const r of report.regressions) {
      console.log(`    ${chalk.red('▼')} ${r.name}: ${r.changePercent.toFixed(1)}% (${r.baseline.toFixed(2)} → ${r.current.toFixed(2)})`);
    }
    console.log('');
  }

  if (report.improvements.length > 0) {
    console.log(chalk.bold.green('  Improvements'));
    for (const imp of report.improvements) {
      console.log(`    ${chalk.green('▲')} ${imp.name}: +${imp.changePercent.toFixed(1)}% (${imp.baseline.toFixed(2)} → ${imp.current.toFixed(2)})`);
    }
    console.log('');
  }

  if (baseline && report.regressions.length === 0 && report.improvements.length === 0 && report.results.length > 0) {
    console.log(chalk.green('  No significant performance changes detected.\n'));
  }
}

// ─── Run benchmarks ──────────────────────────────────────────────────────────

function runBenchmarks(swarmDir: string, opts: { cmd?: string; threshold: number; save?: boolean; json?: boolean; failOnRegression?: boolean }): void {
  const cwd = resolve(swarmDir, '..');
  const threshold = opts.threshold;

  // Determine benchmark command
  let benchCmd: string | null = opts.cmd ?? null;
  let benchType: BenchType = 'custom';

  if (!benchCmd) {
    const detected = detectBenchmark(cwd);
    if (detected) {
      benchCmd = detected.cmd;
      benchType = detected.type;
      console.log(chalk.dim(`  Auto-detected: ${detected.label}`));
    }
  }

  // Run benchmark command
  let benchOutput = '';
  let benchResults: BenchmarkResult[] = [];

  if (benchCmd) {
    console.log(chalk.dim(`  Running: ${benchCmd}`));
    try {
      benchOutput = execSync(benchCmd, { cwd, encoding: 'utf-8', timeout: 300000, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err: unknown) {
      // Some bench tools exit non-zero but still produce output
      if (err && typeof err === 'object' && 'stdout' in err) {
        benchOutput = String((err as { stdout: unknown }).stdout);
      }
      if (!benchOutput) {
        console.error(chalk.red(`  Benchmark command failed: ${benchCmd}`));
      }
    }

    // Parse output based on type
    switch (benchType) {
      case 'go-bench':
        benchResults = parseGoBenchOutput(benchOutput);
        break;
      case 'pytest-bench':
        benchResults = parsePytestBenchOutput(swarmDir);
        break;
      case 'vitest-bench':
        benchResults = parseVitestBenchOutput(benchOutput);
        break;
      default:
        benchResults = parseGenericOutput(benchOutput);
        break;
    }
  } else {
    console.log(chalk.dim('  No benchmark command detected. Measuring bundle size and startup time only.'));
  }

  // Measure bundle size
  const bundleSize = measureBundleSize(cwd);

  // Measure startup time
  const startupTimeMs = measureStartupTime(cwd);

  // Load baseline for comparison
  const baseline = loadBaseline(swarmDir);

  // Compare
  const { regressions, improvements } = baseline
    ? compareResults(benchResults, baseline.results, threshold)
    : { regressions: [] as BenchmarkReport['regressions'], improvements: [] as BenchmarkReport['improvements'] };

  // Build report
  const report: BenchmarkReport = {
    results: benchResults,
    bundleSize,
    startupTimeMs,
    timestamp: Date.now(),
    gitSha: getGitSha(),
    regressions,
    improvements,
  };

  // Append to history
  appendHistory(swarmDir, report);

  // Save as baseline if requested
  if (opts.save) {
    saveBaseline(swarmDir, report);
    console.log(chalk.green('  Saved as new baseline.'));
  }

  // Output
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report, baseline);
  }

  // Fail on regression
  if (opts.failOnRegression && regressions.length > 0) {
    console.error(chalk.red(`\n${regressions.length} regression(s) detected — exiting with error.`));
    process.exit(1);
  }
}

// ─── Command registration ────────────────────────────────────────────────────

export function registerBenchmark(program: Command): void {
  const bench = program
    .command('benchmark')
    .alias('bench')
    .description('Performance regression detection — run benchmarks and compare with baseline');

  bench
    .command('run')
    .description('Run benchmarks and compare with baseline')
    .option('--cmd <command>', 'Custom benchmark command')
    .option('--threshold <percent>', 'Regression threshold percentage', '10')
    .option('--fail-on-regression', 'Exit with error if regression detected')
    .option('--json', 'Output as JSON')
    .option('--save', 'Save results as new baseline')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }

      runBenchmarks(swarmDir, {
        cmd: opts.cmd,
        threshold: parseInt(opts.threshold) || 10,
        save: opts.save,
        json: opts.json,
        failOnRegression: opts.failOnRegression,
      });
    });

  bench
    .command('baseline')
    .description('Save current benchmark results as baseline')
    .option('--cmd <command>', 'Custom benchmark command')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }

      console.log(chalk.bold('\nSaving benchmark baseline...\n'));
      runBenchmarks(swarmDir, {
        cmd: opts.cmd,
        threshold: 10,
        save: true,
      });
    });

  bench
    .command('compare')
    .description('Compare current performance vs baseline')
    .option('--cmd <command>', 'Custom benchmark command')
    .option('--threshold <percent>', 'Regression threshold percentage', '10')
    .option('--json', 'Output as JSON')
    .option('--fail-on-regression', 'Exit with error if regression detected')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }

      const baseline = loadBaseline(swarmDir);
      if (!baseline) {
        console.error(chalk.red('No baseline found. Run `swarm benchmark baseline` first.'));
        process.exit(1);
      }

      console.log(chalk.bold('\nComparing with baseline...\n'));
      runBenchmarks(swarmDir, {
        cmd: opts.cmd,
        threshold: parseInt(opts.threshold) || 10,
        json: opts.json,
        failOnRegression: opts.failOnRegression,
      });
    });

  bench
    .command('status')
    .description('Show baseline and history info')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }

      const baseline = loadBaseline(swarmDir);
      const history = loadHistory(swarmDir);

      if (opts.json) {
        console.log(JSON.stringify({ baseline, historyCount: history.length, history }, null, 2));
        return;
      }

      console.log(chalk.bold('\nBenchmark Status\n'));

      if (baseline) {
        console.log(chalk.bold('  Baseline'));
        console.log(`    Saved: ${new Date(baseline.timestamp).toLocaleString()}`);
        console.log(`    Git SHA: ${baseline.gitSha}`);
        console.log(`    Benchmarks: ${baseline.results.length}`);
        if (baseline.bundleSize) {
          console.log(`    Bundle: ${formatBytes(baseline.bundleSize.totalBytes)} (${baseline.bundleSize.files} files)`);
        }
        console.log('');
      } else {
        console.log(chalk.dim('  No baseline saved. Run `swarm benchmark baseline` to create one.\n'));
      }

      console.log(chalk.bold('  History'));
      console.log(`    ${history.length} run(s) recorded (max 20)`);
      if (history.length > 0) {
        const last = history[history.length - 1];
        console.log(`    Last run: ${new Date(last.timestamp).toLocaleString()} (${last.gitSha})`);
        if (last.regressions.length > 0) {
          console.log(`    Last run had ${chalk.red(String(last.regressions.length) + ' regression(s)')}`);
        }
        if (last.improvements.length > 0) {
          console.log(`    Last run had ${chalk.green(String(last.improvements.length) + ' improvement(s)')}`);
        }
      }
      console.log('');
    });

  // Default action: show help
  bench.action(() => {
    bench.help();
  });
}
