import chalk from 'chalk';
import type { Command } from 'commander';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import { PerfAnalyzer } from '../core/perf-analyzer.js';
import type { OptimizeReport, HotPath, QueryIssue, TechStack } from '../types.js';

// ─── Display helpers ────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function printHotPaths(hotPaths: HotPath[]): void {
  if (hotPaths.length === 0) return;
  console.log(chalk.bold('\n  Hot Paths'));
  console.log(chalk.dim('  ─────────────────────────────────────────────────────────────'));
  console.log(chalk.dim('  Function                          File                CPU%   Calls'));
  console.log(chalk.dim('  ─────────────────────────────────────────────────────────────'));
  for (const hp of hotPaths.slice(0, 15)) {
    const fn = hp.function.slice(0, 32).padEnd(34);
    const file = `${hp.file}:${hp.line}`.slice(0, 18).padEnd(20);
    const cpu = `${hp.cpuPercent.toFixed(1)}%`.padStart(5);
    const calls = String(hp.callCount).padStart(7);
    const color = hp.cpuPercent > 20 ? chalk.red : hp.cpuPercent > 10 ? chalk.yellow : chalk.white;
    console.log(`  ${color(fn)}${chalk.dim(file)}${color(cpu)}${chalk.dim(calls)}`);
  }
  console.log('');
}

function printQueryIssues(issues: QueryIssue[]): void {
  if (issues.length === 0) return;
  console.log(chalk.bold('\n  Query Issues'));
  console.log(chalk.dim('  ─────────────────────────────────────────────────────────────'));
  for (const iss of issues.slice(0, 20)) {
    const typeColor = iss.type === 'n-plus-one' ? chalk.red
      : iss.type === 'full-scan' ? chalk.yellow
      : chalk.cyan;
    console.log(`  ${typeColor(`[${iss.type}]`.padEnd(16))} ${chalk.dim(`${iss.file}:${iss.line}`)}`);
    console.log(`    ${chalk.dim(iss.query.slice(0, 100))}`);
    console.log(`    ${chalk.green('Fix:')} ${iss.suggestion}`);
    console.log(`    ${chalk.dim(`Est. impact: ~${iss.estimatedImpactMs}ms`)}`);
    console.log('');
  }
}

function printMemoryLeaks(leaks: OptimizeReport['memoryLeaks']): void {
  if (!leaks || leaks.length === 0) return;
  console.log(chalk.bold('\n  Memory Leak Patterns'));
  console.log(chalk.dim('  ─────────────────────────────────────────────────────────────'));
  for (const leak of leaks.slice(0, 20)) {
    console.log(`  ${chalk.yellow('!')} ${chalk.dim(leak.location)}`);
    console.log(`    ${leak.description}`);
    console.log('');
  }
}

function printBundleSize(bundleSize: OptimizeReport['bundleSize']): void {
  if (!bundleSize) return;
  console.log(chalk.bold('\n  Bundle Analysis'));
  console.log(chalk.dim('  ─────────────────────────────────────────────────────────────'));
  console.log(`  Total dist size: ${chalk.bold(formatBytes(bundleSize.totalBytes))}`);
  if (bundleSize.largestModules.length > 0) {
    console.log(chalk.bold('\n  Largest Dependencies'));
    for (const mod of bundleSize.largestModules.slice(0, 10)) {
      const bar = chalk.cyan('#'.repeat(Math.min(40, Math.round(mod.bytes / (1024 * 100)))));
      console.log(`    ${mod.name.padEnd(30)} ${formatBytes(mod.bytes).padStart(10)} ${bar}`);
    }
  }
  console.log('');
}

function printRecommendations(recs: string[]): void {
  if (recs.length === 0) return;
  console.log(chalk.bold('\n  Recommendations'));
  console.log(chalk.dim('  ─────────────────────────────────────────────────────────────'));
  for (const rec of recs) {
    console.log(`  ${chalk.green('>')} ${rec}`);
  }
  console.log('');
}

function printReport(report: OptimizeReport): void {
  const typeLabel = report.type.charAt(0).toUpperCase() + report.type.slice(1);
  console.log(chalk.bold(`\n  Optimization Report — ${typeLabel}`));
  console.log(chalk.dim(`  Generated: ${new Date(report.timestamp).toLocaleString()}`));

  printHotPaths(report.hotPaths);
  printQueryIssues(report.queryIssues);
  printBundleSize(report.bundleSize);
  printMemoryLeaks(report.memoryLeaks);
  printRecommendations(report.recommendations);

  if (report.improvements.length > 0) {
    console.log(chalk.bold('\n  Measured Improvements'));
    console.log(chalk.dim('  ─────────────────────────────────────────────────────────────'));
    for (const imp of report.improvements) {
      console.log(`  ${chalk.green('+')} ${imp.description}`);
      console.log(`    ${chalk.dim(imp.beforeMetric)} ${chalk.green('->')} ${chalk.bold(imp.afterMetric)} ${chalk.green(`(${imp.improvementPercent.toFixed(1)}% better)`)}`);
    }
    console.log('');
  }
}

// ─── Command registration ────────────────────────────────────────────────────

export function registerOptimize(program: Command): void {
  const opt = program
    .command('optimize')
    .alias('perf')
    .description('AI-driven performance optimization — profile, bundle, query, and memory analysis');

  // Default: show last report
  opt.action(() => {
    let swarmDir: string;
    try {
      swarmDir = requireSwarmDir();
    } catch {
      console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
      process.exit(1);
    }

    const config = loadConfig();
    const analyzer = new PerfAnalyzer(swarmDir, config.stack as TechStack | undefined);
    const report = analyzer.getReport();

    if (!report) {
      console.log(chalk.dim('\n  No optimization reports yet. Run one of:'));
      console.log(chalk.dim('    swarm optimize profile   — Run profiler and analyze hot paths'));
      console.log(chalk.dim('    swarm optimize bundle    — Analyze bundle size'));
      console.log(chalk.dim('    swarm optimize queries   — Find slow database queries'));
      console.log(chalk.dim('    swarm optimize memory    — Detect memory leak patterns'));
      console.log(chalk.dim('    swarm optimize "<goal>"  — Goal-directed optimization\n'));
      return;
    }

    printReport(report);
  });

  // ── profile ───────────────────────────────────────────────────────────

  opt
    .command('profile')
    .description('Run profiler and analyze hot paths')
    .option('--stack <stack>', 'Override detected stack (node, go, python)')
    .option('--scope <path>', 'Limit analysis to specific directory')
    .option('--dry-run', 'Show what would be profiled without running')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const config = loadConfig();
      const stack = (opts.stack ?? config.stack) as TechStack | undefined;
      const analyzer = new PerfAnalyzer(swarmDir, stack);

      if (opts.dryRun) {
        console.log(chalk.dim(`\n  Would profile project with stack: ${stack ?? 'auto-detect'}`));
        console.log(chalk.dim(`  Scope: ${opts.scope ?? 'entire project'}\n`));
        return;
      }

      console.log(chalk.bold('\n  Running profiler...\n'));
      const report = analyzer.profile(opts.scope);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printReport(report);
      }
    });

  // ── bundle ────────────────────────────────────────────────────────────

  opt
    .command('bundle')
    .description('Analyze and optimize bundle size (JS/TS projects)')
    .option('--scope <path>', 'Limit analysis to specific directory')
    .option('--dry-run', 'Show what would be analyzed without running')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const config = loadConfig();
      const analyzer = new PerfAnalyzer(swarmDir, config.stack as TechStack | undefined);

      if (opts.dryRun) {
        console.log(chalk.dim('\n  Would analyze bundle size and dependencies'));
        console.log(chalk.dim(`  Scope: ${opts.scope ?? 'entire project'}\n`));
        return;
      }

      console.log(chalk.bold('\n  Analyzing bundle...\n'));
      const report = analyzer.analyzeBundle(opts.scope);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printReport(report);
      }
    });

  // ── queries ───────────────────────────────────────────────────────────

  opt
    .command('queries')
    .description('Find slow database queries and N+1 patterns')
    .option('--scope <path>', 'Limit analysis to specific directory')
    .option('--dry-run', 'Show what would be analyzed without running')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const config = loadConfig();
      const analyzer = new PerfAnalyzer(swarmDir, config.stack as TechStack | undefined);

      if (opts.dryRun) {
        console.log(chalk.dim('\n  Would scan source files for slow query patterns'));
        console.log(chalk.dim(`  Scope: ${opts.scope ?? 'entire project'}\n`));
        return;
      }

      console.log(chalk.bold('\n  Analyzing queries...\n'));
      const report = analyzer.analyzeQueries(opts.scope);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printReport(report);
      }
    });

  // ── memory ────────────────────────────────────────────────────────────

  opt
    .command('memory')
    .description('Detect memory leak patterns')
    .option('--stack <stack>', 'Override detected stack (node, go, python)')
    .option('--scope <path>', 'Limit analysis to specific directory')
    .option('--dry-run', 'Show what would be analyzed without running')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const config = loadConfig();
      const stack = (opts.stack ?? config.stack) as TechStack | undefined;
      const analyzer = new PerfAnalyzer(swarmDir, stack);

      if (opts.dryRun) {
        console.log(chalk.dim('\n  Would scan source files for memory leak patterns'));
        console.log(chalk.dim(`  Scope: ${opts.scope ?? 'entire project'}\n`));
        return;
      }

      console.log(chalk.bold('\n  Analyzing memory patterns...\n'));
      const report = analyzer.analyzeMemory(opts.scope);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printReport(report);
      }
    });

  // ── goal-directed (positional argument) ───────────────────────────────

  opt
    .command('goal <description>')
    .description('Goal-directed optimization (e.g., "reduce API latency")')
    .option('--stack <stack>', 'Override detected stack (node, go, python)')
    .option('--scope <path>', 'Limit analysis to specific directory')
    .option('--dry-run', 'Show what would be analyzed without running')
    .option('--json', 'Output as JSON')
    .action((description: string, opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const config = loadConfig();
      const stack = (opts.stack ?? config.stack) as TechStack | undefined;
      const analyzer = new PerfAnalyzer(swarmDir, stack);

      if (opts.dryRun) {
        console.log(chalk.dim(`\n  Would optimize for goal: "${description}"`));
        console.log(chalk.dim(`  Stack: ${stack ?? 'auto-detect'}`));
        console.log(chalk.dim(`  Scope: ${opts.scope ?? 'entire project'}\n`));
        return;
      }

      console.log(chalk.bold(`\n  Optimizing for: "${description}"...\n`));
      const report = analyzer.optimizeForGoal(description, opts.scope);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printReport(report);
      }
    });

  // ── history ───────────────────────────────────────────────────────────

  opt
    .command('history')
    .description('Show optimization report history')
    .option('--json', 'Output as JSON')
    .option('--limit <n>', 'Number of reports to show', '10')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const config = loadConfig();
      const analyzer = new PerfAnalyzer(swarmDir, config.stack as TechStack | undefined);
      const reports = analyzer.getReports();
      const limit = parseInt(opts.limit) || 10;
      const recent = reports.slice(-limit);

      if (opts.json) {
        console.log(JSON.stringify(recent, null, 2));
        return;
      }

      if (recent.length === 0) {
        console.log(chalk.dim('\n  No optimization reports yet.\n'));
        return;
      }

      console.log(chalk.bold(`\n  Optimization History (${recent.length} of ${reports.length} reports)\n`));
      console.log(chalk.dim('  Type        Date                     Hot Paths  Queries  Leaks  Recs'));
      console.log(chalk.dim('  ─────────────────────────────────────────────────────────────────────'));

      for (const r of recent) {
        const type = r.type.padEnd(10);
        const date = new Date(r.timestamp).toLocaleString().padEnd(24);
        const hp = String(r.hotPaths.length).padStart(9);
        const qi = String(r.queryIssues.length).padStart(8);
        const ml = String(r.memoryLeaks?.length ?? 0).padStart(6);
        const recs = String(r.recommendations.length).padStart(5);
        console.log(`  ${type} ${chalk.dim(date)} ${hp} ${qi} ${ml} ${recs}`);
      }
      console.log('');
    });
}
