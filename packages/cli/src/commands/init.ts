import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { stringify as toYaml } from 'yaml';
import chalk from 'chalk';
import type { Command } from 'commander';
import type { SwarmConfig, TechStack } from '../types.js';
import { DEFAULT_CONFIG, createEmptyPipeline } from '../types.js';

/** Derive a deterministic port pair from the project name so different projects don't collide. */
function derivePort(projectName: string, offset: number): number {
  const hash = createHash('md5').update(projectName).digest();
  // Use 2 bytes → range 0-65535, then clamp to 10000-60000
  const raw = hash.readUInt16BE(offset % (hash.length - 1));
  return 10000 + (raw % 50000);
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Initialize a Swarm project in the current directory')
    .option('-s, --stack <stack>', 'Tech stack (react, node, go)', 'react')
    .option('-m, --model <model>', 'Default model (e.g., sonnet, openai/gpt-4o, ollama/llama3)', 'sonnet')
    .option('-b, --budget <amount>', 'Max budget per agent in USD (0 = no limit)', '5')
    .option('-n, --name <name>', 'Project name')
    .action(async (opts) => {
      const cwd = process.cwd();
      const swarmDir = join(cwd, '.swarm');

      if (existsSync(swarmDir)) {
        console.log(chalk.yellow('.swarm/ directory already exists. Skipping init.'));
        return;
      }

      const projectName = opts.name || cwd.split('/').pop() || 'my-project';
      const stack = opts.stack as TechStack;

      // Derive unique ports from project name so multiple projects can run simultaneously
      const wsPort = derivePort(projectName, 0);
      let dashboardPort = derivePort(projectName, 2);
      // Ensure ws and dashboard ports don't collide
      if (dashboardPort === wsPort) dashboardPort = wsPort + 1;

      const config: SwarmConfig = {
        ...DEFAULT_CONFIG,
        projectName,
        stack,
        model: opts.model,
        maxBudgetUsd: opts.budget === '0' ? null : (parseFloat(opts.budget) || DEFAULT_CONFIG.maxBudgetUsd),
        wsPort,
        dashboardPort,
      };

      // Create directories
      mkdirSync(swarmDir, { recursive: true });
      mkdirSync(join(swarmDir, 'logs'), { recursive: true });

      // Write config
      writeFileSync(join(swarmDir, 'config.yaml'), toYaml(config));

      // Write default guardrails
      const defaultGuardrails = {
        rules: [
          {
            name: 'Custom: example rule',
            target: 'REQUIREMENTS.md',
            checks: [
              {
                type: 'section-exists',
                value: 'Summary',
                message: 'REQUIREMENTS.md should have a Summary section',
                severity: 'warning',
              },
            ],
          },
        ],
      };
      writeFileSync(join(swarmDir, 'guardrails.yaml'), toYaml(defaultGuardrails));

      // Write initial state
      const state = createEmptyPipeline(projectName, stack);
      writeFileSync(join(swarmDir, 'state.json'), JSON.stringify(state, null, 2));

      // Write Playwright config scaffold
      writeFileSync(
        join(swarmDir, 'playwright.config.yaml'),
        [
          '# Playwright E2E testing configuration for swarm test stage',
          '# Uncomment and configure as needed:',
          '# baseUrl: http://localhost:3000',
          '# authStorageState: .auth/storageState.json',
          '# globalSetupScript: e2e/global-setup.ts',
          '# testDir: e2e',
          '',
        ].join('\n'),
      );

      // Write .gitignore for state
      writeFileSync(join(swarmDir, '.gitignore'), 'state.json\nlogs/\n');

      console.log(chalk.green(`\nInitialized Swarm project "${projectName}"`));
      console.log(`  Stack:  ${chalk.cyan(stack)}`);
      console.log(`  Model:  ${chalk.cyan(config.model)}`);
      console.log(`  Budget: ${chalk.cyan(config.maxBudgetUsd ? '$' + config.maxBudgetUsd + ' per pipeline' : 'no limit')}`);
      console.log(`  Config: ${chalk.dim(join(swarmDir, 'config.yaml'))}`);
      console.log('');
      console.log(chalk.dim('Quick start:'));
      console.log(`  ${chalk.bold('hivemind "your feature request"')}   Build a feature end-to-end`);
      console.log(`  ${chalk.bold('hivemind dashboard')}                Open the web UI`);
      console.log(`  ${chalk.bold('hivemind doctor')}                   Check your environment`);
      console.log('');
    });
}
