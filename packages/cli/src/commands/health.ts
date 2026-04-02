import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Command } from 'commander';

export interface HealthMetric {
  name: string;
  score: number;      // 0-100
  status: 'good' | 'warning' | 'poor';
  detail: string;
  suggestion?: string;
}

export interface HealthReport {
  overall: number;    // weighted average
  metrics: HealthMetric[];
  timestamp: number;
  projectName: string;
}

function statusFromScore(score: number): 'good' | 'warning' | 'poor' {
  if (score >= 80) return 'good';
  if (score >= 50) return 'warning';
  return 'poor';
}

function checkDependencyFreshness(cwd: string): HealthMetric {
  try {
    const raw = execSync('npm outdated --json 2>/dev/null || true', { cwd, encoding: 'utf-8', timeout: 30000 });
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '{}') {
      return { name: 'Dependencies', score: 100, status: 'good', detail: 'All dependencies up to date' };
    }
    let parsed: Record<string, { current: string; wanted: string; latest: string }>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { name: 'Dependencies', score: 100, status: 'good', detail: 'All dependencies up to date' };
    }
    const total = Object.keys(parsed).length;
    if (total === 0) {
      return { name: 'Dependencies', score: 100, status: 'good', detail: 'All dependencies up to date' };
    }

    // Count major vs minor vs patch outdated
    let major = 0;
    let minor = 0;
    let patch = 0;
    for (const [, info] of Object.entries(parsed)) {
      const current = (info.current || '').split('.');
      const latest = (info.latest || '').split('.');
      if (current[0] !== latest[0]) major++;
      else if (current[1] !== latest[1]) minor++;
      else patch++;
    }

    // Deduct: major = -15 each, minor = -5 each, patch = -2 each
    const score = Math.max(0, Math.min(100, 100 - major * 15 - minor * 5 - patch * 2));
    const parts: string[] = [];
    if (major > 0) parts.push(`${major} major`);
    if (minor > 0) parts.push(`${minor} minor`);
    if (patch > 0) parts.push(`${patch} patch`);
    const detail = `${total} outdated (${parts.join(', ')})`;

    return {
      name: 'Dependencies',
      score,
      status: statusFromScore(score),
      detail,
      suggestion: major > 0 ? 'Run `npm update` or `npm outdated` to review major version bumps' : undefined,
    };
  } catch {
    return { name: 'Dependencies', score: 50, status: 'warning', detail: 'Could not check dependencies' };
  }
}

function checkVulnerabilities(cwd: string): HealthMetric {
  try {
    const raw = execSync('npm audit --json 2>/dev/null || true', { cwd, encoding: 'utf-8', timeout: 30000 });
    let parsed: { metadata?: { vulnerabilities?: { critical?: number; high?: number; moderate?: number; low?: number } } };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { name: 'Vulnerabilities', score: 100, status: 'good', detail: 'No vulnerabilities detected' };
    }
    const vuln = parsed?.metadata?.vulnerabilities;
    if (!vuln) {
      return { name: 'Vulnerabilities', score: 100, status: 'good', detail: 'No vulnerabilities detected' };
    }
    const critical = vuln.critical || 0;
    const high = vuln.high || 0;
    const moderate = vuln.moderate || 0;
    const low = vuln.low || 0;
    const total = critical + high + moderate + low;

    if (total === 0) {
      return { name: 'Vulnerabilities', score: 100, status: 'good', detail: 'No vulnerabilities detected' };
    }

    // Deduct: critical = -25, high = -15, moderate = -5, low = -1
    const score = Math.max(0, Math.min(100, 100 - critical * 25 - high * 15 - moderate * 5 - low * 1));
    const parts: string[] = [];
    if (critical > 0) parts.push(`${critical} critical`);
    if (high > 0) parts.push(`${high} high`);
    if (moderate > 0) parts.push(`${moderate} moderate`);
    if (low > 0) parts.push(`${low} low`);

    return {
      name: 'Vulnerabilities',
      score,
      status: statusFromScore(score),
      detail: `${total} vulnerabilities (${parts.join(', ')})`,
      suggestion: critical > 0 || high > 0 ? 'Run `npm audit fix` to address vulnerabilities' : undefined,
    };
  } catch {
    return { name: 'Vulnerabilities', score: 50, status: 'warning', detail: 'Could not run npm audit' };
  }
}

function checkDeadCode(cwd: string): HealthMetric {
  try {
    // Collect all exported names from .ts files (excluding node_modules and dist)
    const tsFiles: string[] = [];
    function walkDir(dir: string): void {
      if (dir.includes('node_modules') || dir.includes('/dist/') || dir.endsWith('/dist')) return;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) walkDir(full);
          else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) tsFiles.push(full);
        }
      } catch { /* skip unreadable dirs */ }
    }
    walkDir(cwd);

    if (tsFiles.length === 0) {
      return { name: 'Dead Code', score: 100, status: 'good', detail: 'No TypeScript files found' };
    }

    // Find exported names and check if they're imported elsewhere
    const exportPattern = /export\s+(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/g;
    const exportedNames: Array<{ name: string; file: string }> = [];

    for (const file of tsFiles) {
      try {
        const content = readFileSync(file, 'utf-8');
        let match;
        while ((match = exportPattern.exec(content)) !== null) {
          exportedNames.push({ name: match[1], file });
        }
      } catch { /* skip unreadable files */ }
    }

    if (exportedNames.length === 0) {
      return { name: 'Dead Code', score: 100, status: 'good', detail: 'No exports detected' };
    }

    // Build a combined content string for faster searching (heuristic approach)
    const allContent: string[] = [];
    for (const file of tsFiles) {
      try {
        allContent.push(readFileSync(file, 'utf-8'));
      } catch { /* skip */ }
    }
    const combined = allContent.join('\n');

    let unusedCount = 0;
    for (const exp of exportedNames) {
      // Check if the name appears as an import or reference outside its own export
      // Simple heuristic: count occurrences minus 1 (for the export itself)
      const regex = new RegExp(`\\b${exp.name}\\b`, 'g');
      const matches = combined.match(regex);
      if (matches && matches.length <= 1) {
        unusedCount++;
      }
    }

    const usedPct = exportedNames.length > 0
      ? ((exportedNames.length - unusedCount) / exportedNames.length) * 100
      : 100;
    const score = Math.max(0, Math.min(100, Math.round(usedPct)));

    return {
      name: 'Dead Code',
      score,
      status: statusFromScore(score),
      detail: unusedCount > 0 ? `~${unusedCount} unused exports detected` : 'No unused exports detected',
      suggestion: unusedCount > 5 ? 'Review unused exports and remove dead code to reduce maintenance burden' : undefined,
    };
  } catch {
    return { name: 'Dead Code', score: 50, status: 'warning', detail: 'Could not analyze dead code' };
  }
}

function checkComplexityHotspots(cwd: string): HealthMetric {
  try {
    const tsFiles: string[] = [];
    function walkDir(dir: string): void {
      if (dir.includes('node_modules') || dir.includes('/dist/') || dir.endsWith('/dist')) return;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) walkDir(full);
          else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) tsFiles.push(full);
        }
      } catch { /* skip */ }
    }
    walkDir(cwd);

    const largeFiles: Array<{ file: string; lines: number }> = [];
    for (const file of tsFiles) {
      try {
        const content = readFileSync(file, 'utf-8');
        const lineCount = content.split('\n').length;
        if (lineCount > 500) {
          largeFiles.push({ file: relative(cwd, file), lines: lineCount });
        }
      } catch { /* skip */ }
    }

    if (largeFiles.length === 0) {
      return { name: 'Complexity', score: 100, status: 'good', detail: 'No files exceed 500 lines' };
    }

    // Deduct 10 per large file, capped
    const score = Math.max(0, Math.min(100, 100 - largeFiles.length * 10));
    const topFiles = largeFiles.sort((a, b) => b.lines - a.lines).slice(0, 3);
    const detail = `${largeFiles.length} files exceed 500 lines`;

    return {
      name: 'Complexity',
      score,
      status: statusFromScore(score),
      detail,
      suggestion: `Top: ${topFiles.map(f => `${f.file} (${f.lines}L)`).join(', ')}`,
    };
  } catch {
    return { name: 'Complexity', score: 50, status: 'warning', detail: 'Could not analyze complexity' };
  }
}

function checkTypeCoverage(cwd: string): HealthMetric {
  try {
    const tsFiles: string[] = [];
    function walkDir(dir: string): void {
      if (dir.includes('node_modules') || dir.includes('/dist/') || dir.endsWith('/dist')) return;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) walkDir(full);
          else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) tsFiles.push(full);
        }
      } catch { /* skip */ }
    }
    walkDir(cwd);

    let anyCount = 0;
    let totalLines = 0;
    for (const file of tsFiles) {
      try {
        const content = readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        totalLines += lines.length;
        for (const line of lines) {
          // Count : any, as any, <any>, Record<string, any> patterns
          const matches = line.match(/\bany\b/g);
          if (matches) anyCount += matches.length;
        }
      } catch { /* skip */ }
    }

    if (totalLines === 0) {
      return { name: 'Type Safety', score: 100, status: 'good', detail: 'No TypeScript files found' };
    }

    // Deduct 1 point per `any` usage, min 0
    const score = Math.max(0, Math.min(100, 100 - anyCount));
    return {
      name: 'Type Safety',
      score,
      status: statusFromScore(score),
      detail: anyCount > 0 ? `${anyCount} uses of 'any' type` : 'No uses of \'any\' type',
      suggestion: anyCount > 20 ? 'Replace `any` with proper types to improve type safety' : undefined,
    };
  } catch {
    return { name: 'Type Safety', score: 50, status: 'warning', detail: 'Could not analyze type coverage' };
  }
}

function checkBundleSize(cwd: string): HealthMetric {
  const distDir = join(cwd, 'dist');
  if (!existsSync(distDir)) {
    // Check for packages/*/dist
    const pkgDist = join(cwd, 'packages');
    if (!existsSync(pkgDist)) {
      return { name: 'Bundle Size', score: 100, status: 'good', detail: 'No dist/ directory found' };
    }
  }

  try {
    let totalSize = 0;

    function measureDir(dir: string): void {
      if (!existsSync(dir)) return;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== 'node_modules') measureDir(full);
          } else {
            try { totalSize += statSync(full).size; } catch { /* skip */ }
          }
        }
      } catch { /* skip */ }
    }

    // Measure all dist directories
    if (existsSync(distDir)) measureDir(distDir);
    const pkgsDir = join(cwd, 'packages');
    if (existsSync(pkgsDir)) {
      try {
        for (const pkg of readdirSync(pkgsDir, { withFileTypes: true })) {
          if (pkg.isDirectory()) {
            const d = join(pkgsDir, pkg.name, 'dist');
            if (existsSync(d)) measureDir(d);
          }
        }
      } catch { /* skip */ }
    }

    if (totalSize === 0) {
      return { name: 'Bundle Size', score: 100, status: 'good', detail: 'No dist/ output found' };
    }

    const sizeMB = totalSize / (1024 * 1024);
    // Score: 100 for <1MB, deduct 5 per MB over 1MB
    const score = Math.max(0, Math.min(100, Math.round(100 - Math.max(0, sizeMB - 1) * 5)));

    return {
      name: 'Bundle Size',
      score,
      status: statusFromScore(score),
      detail: `dist/ is ${sizeMB.toFixed(1)}MB`,
      suggestion: sizeMB > 10 ? 'Consider tree-shaking or code splitting to reduce bundle size' : undefined,
    };
  } catch {
    return { name: 'Bundle Size', score: 50, status: 'warning', detail: 'Could not measure bundle size' };
  }
}

function checkDocFreshness(cwd: string): HealthMetric {
  const readmePath = join(cwd, 'README.md');
  if (!existsSync(readmePath)) {
    return { name: 'Documentation', score: 30, status: 'poor', detail: 'No README.md found', suggestion: 'Add a README.md to document the project' };
  }

  try {
    const stat = statSync(readmePath);
    const daysSinceModified = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);

    // Score: 100 if updated within 30 days, deduct 1 per day over 30, min 0
    const score = Math.max(0, Math.min(100, Math.round(100 - Math.max(0, daysSinceModified - 30))));
    const daysRounded = Math.round(daysSinceModified);

    return {
      name: 'Documentation',
      score,
      status: statusFromScore(score),
      detail: daysRounded <= 1 ? 'README updated today' : `README updated ${daysRounded} days ago`,
      suggestion: daysSinceModified > 90 ? 'README.md is stale — consider updating documentation' : undefined,
    };
  } catch {
    return { name: 'Documentation', score: 50, status: 'warning', detail: 'Could not check README.md' };
  }
}

export function checkHealth(cwd: string): HealthReport {
  const metrics: HealthMetric[] = [
    checkDependencyFreshness(cwd),
    checkVulnerabilities(cwd),
    checkDeadCode(cwd),
    checkComplexityHotspots(cwd),
    checkTypeCoverage(cwd),
    checkBundleSize(cwd),
    checkDocFreshness(cwd),
  ];

  // Weighted average: deps=15, vulns=20, dead=10, complexity=15, types=15, bundle=10, docs=15
  const weights = [15, 20, 10, 15, 15, 10, 15];
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const overall = Math.round(
    metrics.reduce((sum, m, i) => sum + m.score * weights[i], 0) / totalWeight
  );

  // Try to determine project name from package.json
  let projectName = 'unknown';
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
    projectName = pkg.name || 'unknown';
  } catch { /* ignore */ }

  return { overall, metrics, timestamp: Date.now(), projectName };
}

function saveReport(swarmDir: string, report: HealthReport): void {
  const historyPath = join(swarmDir, 'health-history.json');
  let history: HealthReport[] = [];
  try {
    if (existsSync(historyPath)) {
      history = JSON.parse(readFileSync(historyPath, 'utf-8'));
    }
  } catch { /* start fresh */ }

  history.push(report);
  // Keep last 50 reports
  if (history.length > 50) {
    history = history.slice(-50);
  }
  writeFileSync(historyPath, JSON.stringify(history, null, 2));
}

function displayReport(report: HealthReport, threshold: number): void {
  const overallStatus = report.overall >= 80 ? 'Good' : report.overall >= 50 ? 'Warning' : 'Poor';
  const overallColor = report.overall >= 80 ? chalk.green : report.overall >= 50 ? chalk.yellow : chalk.red;

  console.log('');
  console.log(`  Codebase Health: ${overallColor(`${report.overall}/100`)} (${overallStatus})`);
  console.log('');

  for (const metric of report.metrics) {
    const color = metric.status === 'good' ? chalk.green : metric.status === 'warning' ? chalk.yellow : chalk.red;
    const scorePad = String(metric.score).padStart(3);
    const statusPad = metric.status.padEnd(7);
    console.log(`    ${metric.name.padEnd(16)} ${scorePad}/100  ${color(statusPad)}  ${metric.detail}`);
    if (metric.suggestion) {
      console.log(`    ${' '.repeat(16)} ${chalk.dim(metric.suggestion)}`);
    }
  }
  console.log('');

  if (report.overall < threshold) {
    console.log(chalk.yellow(`  Warning: Health score ${report.overall} is below threshold ${threshold}`));
    console.log('');
  }
}

export function registerHealth(program: Command): void {
  program
    .command('health')
    .description('Run a codebase health check and display results')
    .option('--json', 'Output as JSON')
    .option('--watch', 'Re-run periodically')
    .option('--interval <minutes>', 'Interval in minutes for --watch mode', '60')
    .option('--threshold <score>', 'Warn if health drops below this score', '60')
    .action(async (opts) => {
      const cwd = process.cwd();
      const swarmDir = join(cwd, '.swarm');
      const threshold = parseInt(opts.threshold) || 60;

      const runOnce = (): HealthReport => {
        const report = checkHealth(cwd);

        // Save to history if .swarm/ exists
        if (existsSync(swarmDir)) {
          saveReport(swarmDir, report);
        }

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          displayReport(report, threshold);
        }

        return report;
      };

      if (opts.watch) {
        const intervalMs = (parseInt(opts.interval) || 60) * 60 * 1000;
        console.log(chalk.dim(`Watching health every ${opts.interval || 60} minutes. Press Ctrl+C to stop.\n`));

        // Initial run
        runOnce();

        // Periodic runs
        const timer = setInterval(() => {
          console.log(chalk.dim(`\n--- Health check at ${new Date().toLocaleTimeString()} ---`));
          runOnce();
        }, intervalMs);

        // Clean exit
        process.on('SIGINT', () => {
          clearInterval(timer);
          process.exit(0);
        });
        process.on('SIGTERM', () => {
          clearInterval(timer);
          process.exit(0);
        });

        // Keep process alive
        await new Promise(() => {});
      } else {
        const report = runOnce();
        if (report.overall < threshold) {
          process.exitCode = 1;
        }
      }
    });
}
