import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import chalk from 'chalk';
import type { Command } from 'commander';

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'info';
  message: string;
  critical: boolean;
  fix?: string;
}

function checkNodeVersion(): CheckResult {
  const version = process.version.replace('v', '');
  const major = parseInt(version.split('.')[0], 10);
  if (major >= 18) {
    return { name: 'Node.js version', status: 'pass', message: `${process.version}`, critical: false };
  }
  return { name: 'Node.js version', status: 'warn', message: `${process.version} (>= 18.0.0 recommended)`, critical: false };
}

function checkClaudeInstalled(): CheckResult {
  try {
    const path = execSync('which claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return { name: 'claude CLI installed', status: 'pass', message: path, critical: true };
  } catch {
    return { name: 'claude CLI installed', status: 'fail', message: 'claude CLI not found in PATH', critical: true, fix: 'npm install -g @anthropic-ai/claude-code' };
  }
}

function checkClaudeAuthenticated(): CheckResult {
  try {
    const output = execSync('claude --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return { name: 'claude CLI authenticated', status: 'pass', message: output, critical: true };
  } catch {
    return { name: 'claude CLI authenticated', status: 'fail', message: 'claude --version failed — check authentication', critical: true, fix: 'Run: claude (to re-authenticate)' };
  }
}

function checkDiskSpace(): CheckResult {
  try {
    const output = execSync('df -k .', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = output.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      // Available space is typically the 4th column (index 3)
      const availableKb = parseInt(parts[3], 10);
      const availableGb = (availableKb / 1024 / 1024).toFixed(1);
      if (availableKb < 1024 * 1024) {
        return { name: 'Disk space', status: 'warn', message: `${availableGb} GB available (< 1 GB)`, critical: false };
      }
      return { name: 'Disk space', status: 'pass', message: `${availableGb} GB available`, critical: false };
    }
    return { name: 'Disk space', status: 'warn', message: 'Could not parse df output', critical: false };
  } catch {
    return { name: 'Disk space', status: 'warn', message: 'Could not check disk space', critical: false };
  }
}

function checkSwarmDir(): CheckResult {
  const swarmDir = join(process.cwd(), '.swarm');
  if (existsSync(swarmDir)) {
    return { name: '.swarm/ directory', status: 'pass', message: 'Found', critical: false };
  }
  return { name: '.swarm/ directory', status: 'info', message: 'Not found — run `swarm init` to create', critical: false };
}

function checkSwarmConfig(): CheckResult {
  const configPath = join(process.cwd(), '.swarm', 'config.yaml');
  if (!existsSync(configPath)) {
    return { name: '.swarm/config.yaml', status: 'info', message: 'Not found (no .swarm/ directory)', critical: false };
  }
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const config = parseYaml(raw);
    if (!config || typeof config !== 'object') {
      return { name: '.swarm/config.yaml', status: 'warn', message: 'File is empty or not a valid YAML object', critical: false };
    }
    return { name: '.swarm/config.yaml', status: 'pass', message: 'Valid', critical: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: '.swarm/config.yaml', status: 'warn', message: `Malformed YAML: ${msg}`, critical: false };
  }
}

const STATUS_ICONS: Record<CheckResult['status'], string> = {
  pass: chalk.green('\u2713'),
  fail: chalk.red('\u2717'),
  warn: chalk.yellow('\u26A0'),
  info: chalk.blue('i'),
};

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Run pre-flight checks for the Swarm environment')
    .action(async () => {
      console.log(chalk.bold('\nSwarm Doctor\n'));

      const checks: CheckResult[] = [
        checkNodeVersion(),
        checkClaudeInstalled(),
        checkClaudeAuthenticated(),
        checkDiskSpace(),
        checkSwarmDir(),
        checkSwarmConfig(),
      ];

      for (const check of checks) {
        const icon = STATUS_ICONS[check.status];
        console.log(`  ${icon} ${check.name}: ${chalk.dim(check.message)}`);
        if (check.fix && (check.status === 'fail' || check.status === 'warn')) {
          console.log(`    ${chalk.cyan('→ ' + check.fix)}`);
        }
      }

      const passed = checks.filter((c) => c.status === 'pass').length;
      const total = checks.length;
      const hasCriticalFailure = checks.some((c) => c.critical && c.status === 'fail');

      console.log(chalk.bold(`\n${passed}/${total} checks passed\n`));

      if (hasCriticalFailure) {
        process.exit(1);
      }
    });
}
