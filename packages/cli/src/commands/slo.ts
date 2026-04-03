import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import type { SloData } from '../types.js';

type SloEntry = SloData['slos'][number];

function sloFilePath(swarmDir: string): string {
  return join(swarmDir, 'slos.json');
}

function readSloData(swarmDir: string): SloData {
  const filePath = sloFilePath(swarmDir);
  if (!existsSync(filePath)) {
    return { slos: [], alerts: [] };
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as SloData;
  } catch {
    return { slos: [], alerts: [] };
  }
}

function writeSloData(swarmDir: string, data: SloData): void {
  if (!existsSync(swarmDir)) {
    mkdirSync(swarmDir, { recursive: true });
  }
  writeFileSync(sloFilePath(swarmDir), JSON.stringify(data, null, 2));
}

function statusColor(status: SloEntry['status']): string {
  switch (status) {
    case 'ok': return chalk.green(status);
    case 'warning': return chalk.yellow(status);
    case 'breach': return chalk.red(status);
    default: return status;
  }
}

function trendSymbol(trend: SloEntry['trend']): string {
  switch (trend) {
    case 'improving': return chalk.green('↑');
    case 'degrading': return chalk.red('↓');
    case 'stable': return chalk.dim('→');
    default: return '?';
  }
}

function formatBudget(budget: SloEntry['errorBudget']): string {
  const pct = budget.total > 0 ? ((budget.remaining / budget.total) * 100).toFixed(1) : '0.0';
  const color = budget.remaining / budget.total > 0.5 ? chalk.green : budget.remaining / budget.total > 0.2 ? chalk.yellow : chalk.red;
  return color(`${pct}% remaining (burn: ${budget.burnRate.toFixed(2)}x)`);
}

function printSloTable(data: SloData): void {
  if (data.slos.length === 0) {
    console.log(chalk.dim('No SLOs configured. Use `hivemind slo add <name>` to add one.'));
    return;
  }

  console.log(chalk.bold('\n  SLO Dashboard\n'));

  // Header
  const hdr = `  ${'Name'.padEnd(24)} ${'Target'.padEnd(16)} ${'Current'.padEnd(16)} ${'Status'.padEnd(10)} ${'Trend'.padEnd(6)} ${'Error Budget'.padEnd(36)} Source`;
  console.log(chalk.dim(hdr));
  console.log(chalk.dim('  ' + '─'.repeat(120)));

  for (const slo of data.slos) {
    const name = slo.name.padEnd(24);
    const target = slo.target.padEnd(16);
    const current = slo.current.padEnd(16);
    const status = statusColor(slo.status).padEnd(10 + 10); // extra for ANSI codes
    const trend = trendSymbol(slo.trend);
    const budget = formatBudget(slo.errorBudget);
    const source = chalk.dim(slo.source);
    const lastChecked = slo.lastChecked > 0 ? chalk.dim(` (checked ${timeSince(slo.lastChecked)})`) : '';

    console.log(`  ${name} ${target} ${current} ${status} ${trend}      ${budget}  ${source}${lastChecked}`);
  }

  // Alerts
  const recentAlerts = data.alerts.filter(a => Date.now() - a.timestamp < 86400000);
  if (recentAlerts.length > 0) {
    console.log(chalk.bold('\n  Recent Alerts (24h)\n'));
    for (const alert of recentAlerts) {
      const sev = alert.severity === 'critical' ? chalk.red('CRIT') : alert.severity === 'warning' ? chalk.yellow('WARN') : chalk.dim('INFO');
      console.log(`  [${sev}] ${alert.message}`);
    }
  }

  console.log('');
}

function timeSince(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function checkTestCoverage(cwd: string): Promise<{ current: string; status: 'ok' | 'warning' | 'breach' }> {
  // Try to find common coverage summary files
  const coveragePaths = [
    join(cwd, 'coverage', 'coverage-summary.json'),
    join(cwd, 'coverage', 'lcov.info'),
    join(cwd, '.nyc_output', 'coverage-summary.json'),
  ];

  for (const p of coveragePaths) {
    if (existsSync(p)) {
      try {
        if (p.endsWith('.json')) {
          const data = JSON.parse(readFileSync(p, 'utf-8'));
          const pct = data?.total?.lines?.pct ?? data?.total?.statements?.pct;
          if (typeof pct === 'number') {
            return {
              current: `${pct.toFixed(1)}%`,
              status: pct >= 80 ? 'ok' : pct >= 60 ? 'warning' : 'breach',
            };
          }
        }
      } catch { /* ignore parse errors */ }
    }
  }

  // Fallback: count test files
  const { execSync } = await import('node:child_process');
  try {
    const result = execSync('find . -name "*.test.*" -o -name "*.spec.*" -o -name "*_test.*" | wc -l', {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    const count = parseInt(result) || 0;
    return {
      current: `${count} test files`,
      status: count > 10 ? 'ok' : count > 0 ? 'warning' : 'breach',
    };
  } catch {
    return { current: 'unknown', status: 'warning' };
  }
}

async function checkDependencyAge(cwd: string): Promise<{ current: string; status: 'ok' | 'warning' | 'breach' }> {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) {
    return { current: 'no package.json', status: 'warning' };
  }

  const lockPaths = [
    join(cwd, 'package-lock.json'),
    join(cwd, 'yarn.lock'),
    join(cwd, 'pnpm-lock.yaml'),
  ];

  for (const lockPath of lockPaths) {
    if (existsSync(lockPath)) {
      const { statSync } = await import('node:fs');
      const stat = statSync(lockPath);
      const ageDays = Math.floor((Date.now() - stat.mtimeMs) / 86400000);
      return {
        current: `${ageDays}d since lock update`,
        status: ageDays <= 30 ? 'ok' : ageDays <= 90 ? 'warning' : 'breach',
      };
    }
  }

  return { current: 'no lockfile', status: 'warning' };
}

async function checkErrorRate(_cwd: string): Promise<{ current: string; status: 'ok' | 'warning' | 'breach' }> {
  // Check for recent CI results in common locations
  const ciPaths = [
    join(_cwd, '.swarm', 'state.json'),
  ];

  for (const p of ciPaths) {
    if (existsSync(p)) {
      try {
        const data = JSON.parse(readFileSync(p, 'utf-8'));
        const history = data?.history ?? [];
        if (history.length > 0) {
          const recent = history.slice(-10);
          const failures = recent.filter((h: { status: string }) => h.status === 'error' || h.status === 'failed').length;
          const rate = ((failures / recent.length) * 100).toFixed(1);
          return {
            current: `${rate}% (last ${recent.length} runs)`,
            status: failures === 0 ? 'ok' : failures <= 2 ? 'warning' : 'breach',
          };
        }
      } catch { /* ignore */ }
    }
  }

  return { current: 'no CI data', status: 'warning' };
}

async function runSloCheck(slo: SloEntry, cwd: string): Promise<{ current: string; status: 'ok' | 'warning' | 'breach' }> {
  const nameLower = slo.name.toLowerCase();

  if (nameLower.includes('coverage') || nameLower.includes('test')) {
    return checkTestCoverage(cwd);
  }

  if (nameLower.includes('dependency') || nameLower.includes('dep') || nameLower.includes('outdated')) {
    return checkDependencyAge(cwd);
  }

  if (nameLower.includes('error') || nameLower.includes('failure') || nameLower.includes('ci')) {
    return checkErrorRate(cwd);
  }

  // Custom / unknown — manual check needed
  return { current: 'manual check needed', status: 'warning' };
}

export function registerSlo(program: Command): void {
  const sloCmd = program
    .command('slo')
    .description('SLO management — track service level objectives')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      loadConfig();
      const data = readSloData(swarmDir);
      printSloTable(data);
    });

  sloCmd
    .command('add <name>')
    .description('Add a new SLO')
    .requiredOption('--target <value>', 'Target value (e.g., ">80%", "<200ms")')
    .option('--source <source>', 'Data source for this SLO', 'manual')
    .action((name: string, opts: { target: string; source: string }) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      loadConfig();
      const data = readSloData(swarmDir);

      // Check for duplicate names
      if (data.slos.some(s => s.name === name)) {
        console.error(chalk.red(`SLO "${name}" already exists. Remove it first or use a different name.`));
        process.exit(1);
      }

      const newSlo: SloEntry = {
        id: randomUUID(),
        name,
        target: opts.target,
        current: 'pending',
        status: 'warning',
        trend: 'stable',
        errorBudget: { total: 100, remaining: 100, burnRate: 0 },
        source: opts.source,
        lastChecked: 0,
      };

      data.slos.push(newSlo);
      writeSloData(swarmDir, data);

      console.log(chalk.green(`✓ Added SLO "${name}" with target ${opts.target} (source: ${opts.source})`));
    });

  sloCmd
    .command('check')
    .description('Check all SLOs against current metrics')
    .action(async () => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      loadConfig();
      const data = readSloData(swarmDir);

      if (data.slos.length === 0) {
        console.log(chalk.dim('No SLOs configured. Use `hivemind slo add <name>` to add one.'));
        return;
      }

      const cwd = process.cwd();
      console.log(chalk.bold('\n  Checking SLOs...\n'));

      for (const slo of data.slos) {
        const previousStatus = slo.status;
        const result = await runSloCheck(slo, cwd);

        slo.current = result.current;
        slo.status = result.status;
        slo.lastChecked = Date.now();

        // Update trend based on status change
        if (previousStatus === 'breach' && result.status !== 'breach') {
          slo.trend = 'improving';
        } else if (previousStatus === 'ok' && result.status !== 'ok') {
          slo.trend = 'degrading';
        }
        // else keep existing trend

        // Update error budget
        if (result.status === 'breach') {
          slo.errorBudget.remaining = Math.max(0, slo.errorBudget.remaining - 5);
          slo.errorBudget.burnRate = Math.min(10, slo.errorBudget.burnRate + 0.5);
        } else if (result.status === 'ok') {
          slo.errorBudget.burnRate = Math.max(0, slo.errorBudget.burnRate - 0.1);
        }

        // Generate alert if status changed to breach
        if (result.status === 'breach' && previousStatus !== 'breach') {
          data.alerts.push({
            sloId: slo.id,
            message: `SLO "${slo.name}" is now in breach: ${result.current} (target: ${slo.target})`,
            severity: 'critical',
            timestamp: Date.now(),
          });
        } else if (result.status === 'warning' && previousStatus === 'ok') {
          data.alerts.push({
            sloId: slo.id,
            message: `SLO "${slo.name}" is at warning: ${result.current} (target: ${slo.target})`,
            severity: 'warning',
            timestamp: Date.now(),
          });
        }

        const icon = result.status === 'ok' ? chalk.green('✓') : result.status === 'warning' ? chalk.yellow('⚠') : chalk.red('✗');
        console.log(`  ${icon} ${slo.name}: ${result.current} (target: ${slo.target})`);
      }

      // Prune alerts older than 7 days
      data.alerts = data.alerts.filter(a => Date.now() - a.timestamp < 7 * 86400000);

      writeSloData(swarmDir, data);
      console.log(chalk.dim('\n  Results saved to .swarm/slos.json\n'));
    });

  sloCmd
    .command('remove <name>')
    .description('Remove an SLO')
    .action((name: string) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      loadConfig();
      const data = readSloData(swarmDir);

      const idx = data.slos.findIndex(s => s.name === name);
      if (idx === -1) {
        console.error(chalk.red(`SLO "${name}" not found.`));
        process.exit(1);
      }

      const removed = data.slos.splice(idx, 1)[0];
      // Also remove related alerts
      data.alerts = data.alerts.filter(a => a.sloId !== removed.id);

      writeSloData(swarmDir, data);
      console.log(chalk.green(`✓ Removed SLO "${name}"`));
    });
}
