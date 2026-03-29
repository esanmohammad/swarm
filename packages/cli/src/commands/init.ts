import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as toYaml } from 'yaml';
import chalk from 'chalk';
import type { Command } from 'commander';
import type { SwarmConfig, TechStack } from '../types.js';
import { DEFAULT_CONFIG, createEmptyPipeline } from '../types.js';

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Initialize a Swarm project in the current directory')
    .option('-s, --stack <stack>', 'Tech stack (react, node, go)', 'react')
    .option('-m, --model <model>', 'Default model (sonnet, opus, haiku)', 'opus')
    .option('-b, --budget <amount>', 'Max budget per agent in USD (0 = no limit)', '0')
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

      const config: SwarmConfig = {
        ...DEFAULT_CONFIG,
        projectName,
        stack,
        model: opts.model,
        maxBudgetUsd: parseFloat(opts.budget) || null,
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

      // Write .gitignore for state
      writeFileSync(join(swarmDir, '.gitignore'), 'state.json\nlogs/\n');

      console.log(chalk.green(`Initialized Swarm project "${projectName}"`));
      console.log(`  Stack:  ${chalk.cyan(stack)}`);
      console.log(`  Model:  ${chalk.cyan(config.model)}`);
      console.log(`  Budget: ${chalk.cyan(config.maxBudgetUsd ? '$' + config.maxBudgetUsd + '/agent' : 'no limit')}`);
      console.log(`  Config: ${chalk.dim(join(swarmDir, 'config.yaml'))}`);
      console.log(`\nNext: ${chalk.bold('swarm analyze "your feature request"')}`);
    });
}
