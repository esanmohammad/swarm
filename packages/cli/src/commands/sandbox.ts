import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { requireSwarmDir } from '../core/config.js';
import { Sandbox, type SandboxConfig, type SandboxMode } from '../core/sandbox.js';

const VALID_MODES: SandboxMode[] = ['strict', 'moderate', 'off'];

function getSandboxConfigPath(swarmDir: string): string {
  return join(swarmDir, 'sandbox.yaml');
}

function loadSandboxConfig(swarmDir: string): SandboxConfig {
  const configPath = getSandboxConfigPath(swarmDir);
  if (!existsSync(configPath)) {
    return { mode: 'moderate' };
  }
  try {
    const raw = readFileSync(configPath, 'utf-8');
    // Simple YAML-like parsing for sandbox config
    const config: SandboxConfig = { mode: 'moderate' };
    const lines = raw.split('\n');
    let currentKey: string | null = null;
    let currentList: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (trimmed.startsWith('- ') && currentKey) {
        currentList.push(trimmed.slice(2).trim());
        continue;
      }

      // Save previous list
      if (currentKey && currentList.length > 0) {
        (config as unknown as Record<string, unknown>)[currentKey] = currentList;
        currentList = [];
      }

      const match = trimmed.match(/^(\w+):\s*(.*)$/);
      if (match) {
        const [, key, value] = match;
        if (value && !value.startsWith('[')) {
          if (key === 'mode' && VALID_MODES.includes(value as SandboxMode)) {
            config.mode = value as SandboxMode;
          }
          currentKey = null;
        } else {
          currentKey = key === 'allowedPaths' || key === 'blockedPaths' || key === 'allowedHosts' || key === 'blockedCommands' ? key : null;
          currentList = [];
        }
      }
    }

    // Save last list
    if (currentKey && currentList.length > 0) {
      (config as unknown as Record<string, unknown>)[currentKey] = currentList;
    }

    return config;
  } catch {
    return { mode: 'moderate' };
  }
}

function saveSandboxConfig(swarmDir: string, config: SandboxConfig): void {
  const configPath = getSandboxConfigPath(swarmDir);
  if (!existsSync(swarmDir)) {
    mkdirSync(swarmDir, { recursive: true });
  }
  const lines: string[] = [
    '# Swarm Sandbox Configuration',
    `mode: ${config.mode}`,
  ];

  if (config.allowedPaths && config.allowedPaths.length > 0) {
    lines.push('allowedPaths:');
    for (const p of config.allowedPaths) lines.push(`  - ${p}`);
  }

  if (config.blockedPaths && config.blockedPaths.length > 0) {
    lines.push('blockedPaths:');
    for (const p of config.blockedPaths) lines.push(`  - ${p}`);
  }

  if (config.allowedHosts && config.allowedHosts.length > 0) {
    lines.push('allowedHosts:');
    for (const h of config.allowedHosts) lines.push(`  - ${h}`);
  }

  if (config.blockedCommands && config.blockedCommands.length > 0) {
    lines.push('blockedCommands:');
    for (const c of config.blockedCommands) lines.push(`  - ${c}`);
  }

  writeFileSync(configPath, lines.join('\n') + '\n');
}

export function registerSandbox(program: Command): void {
  const sandbox = program
    .command('sandbox')
    .description('Manage sandboxed code execution for agents');

  sandbox
    .command('status')
    .description('Show current sandbox mode and configuration')
    .action(async () => {
      const swarmDir = requireSwarmDir();
      const config = loadSandboxConfig(swarmDir);

      console.log(chalk.bold('\nSandbox Status\n'));

      const modeColor = config.mode === 'strict' ? chalk.red
        : config.mode === 'moderate' ? chalk.yellow
        : chalk.dim;
      console.log(`  Mode: ${modeColor(config.mode)}`);

      if (config.mode === 'off') {
        console.log(chalk.dim('\n  Sandbox is disabled. Agents have unrestricted access.\n'));
        return;
      }

      console.log('');

      if (config.allowedPaths && config.allowedPaths.length > 0) {
        console.log(chalk.dim('  Allowed paths:'));
        for (const p of config.allowedPaths) console.log(`    ${chalk.green('+')} ${p}`);
      }

      if (config.blockedPaths && config.blockedPaths.length > 0) {
        console.log(chalk.dim('  Extra blocked paths:'));
        for (const p of config.blockedPaths) console.log(`    ${chalk.red('-')} ${p}`);
      }

      if (config.allowedHosts && config.allowedHosts.length > 0) {
        console.log(chalk.dim('  Allowed hosts:'));
        for (const h of config.allowedHosts) console.log(`    ${chalk.green('+')} ${h}`);
      }

      if (config.blockedCommands && config.blockedCommands.length > 0) {
        console.log(chalk.dim('  Blocked commands:'));
        for (const c of config.blockedCommands) console.log(`    ${chalk.red('-')} ${c}`);
      }

      // Show default protections
      console.log(chalk.dim('\n  Default protections (always active):'));
      console.log(chalk.dim('    - Sensitive paths blocked (~/.ssh, ~/.aws, ~/.npmrc, etc.)'));
      console.log(chalk.dim('    - Dangerous commands blocked (rm -rf /, sudo, curl|bash, etc.)'));
      if (config.mode === 'moderate') {
        console.log(chalk.dim('    - Package registries allowed (npmjs, pypi, crates.io, etc.)'));
      } else if (config.mode === 'strict') {
        console.log(chalk.dim('    - All network access blocked except registries + allowed hosts'));
        console.log(chalk.dim('    - All filesystem access outside project dir blocked'));
      }

      // Show violation count
      const sb = new Sandbox(process.cwd(), config);
      const violations = sb.getPersistedViolations(1000);
      if (violations.length > 0) {
        const blocked = violations.filter(v => v.severity === 'blocked').length;
        const warnings = violations.filter(v => v.severity === 'warning').length;
        console.log(chalk.dim(`\n  Violations: ${chalk.red(String(blocked) + ' blocked')}, ${chalk.yellow(String(warnings) + ' warnings')}`));
      }

      console.log('');
    });

  sandbox
    .command('set')
    .argument('<mode>', 'Sandbox mode: strict, moderate, or off')
    .description('Set the sandbox execution mode')
    .action(async (mode: string) => {
      if (!VALID_MODES.includes(mode as SandboxMode)) {
        console.error(chalk.red(`Invalid mode: ${mode}. Must be one of: ${VALID_MODES.join(', ')}`));
        process.exit(1);
      }

      const swarmDir = requireSwarmDir();
      const config = loadSandboxConfig(swarmDir);
      config.mode = mode as SandboxMode;
      saveSandboxConfig(swarmDir, config);

      const modeColor = mode === 'strict' ? chalk.red
        : mode === 'moderate' ? chalk.yellow
        : chalk.dim;
      console.log(`Sandbox mode set to ${modeColor(mode)}`);

      if (mode === 'off') {
        console.log(chalk.yellow('Warning: Agents will have unrestricted access. Use with caution.'));
      }
    });

  sandbox
    .command('violations')
    .description('Show sandbox violation log')
    .option('-n, --limit <count>', 'Number of entries to show', '50')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const config = loadSandboxConfig(swarmDir);
      const sb = new Sandbox(process.cwd(), config);
      const limit = parseInt(opts.limit, 10) || 50;
      const violations = sb.getPersistedViolations(limit);

      if (violations.length === 0) {
        console.log(chalk.dim('No sandbox violations recorded.'));
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(violations, null, 2));
        return;
      }

      console.log(chalk.dim(`Showing ${violations.length} violations (newest first)\n`));

      for (const v of violations) {
        const time = new Date(v.timestamp).toLocaleString();
        const severityColor = v.severity === 'blocked' ? chalk.red : chalk.yellow;
        const typeColor = chalk.cyan;

        console.log(
          `${chalk.dim(time)}  ${severityColor(v.severity.padEnd(8))}  ${typeColor(v.type.padEnd(10))}  ${v.detail}`,
        );
      }
    });
}
