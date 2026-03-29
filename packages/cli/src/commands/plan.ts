import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir } from '../core/config.js';
import { createContext } from './shared.js';

export function registerPlan(program: Command): void {
  program
    .command('plan')
    .description('Run the Lead persona to produce TASKS.md from SPEC.md')
    .option('-s, --stack <stack>', 'Tech stack override (react, node, go)')
    .option('-m, --model <model>', 'Model override (sonnet, opus, haiku)')
    .option('--no-interactive', 'Run in single-shot mode (no conversation)')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const config = loadConfig();
      if (opts.model) config.model = opts.model;
      const stack = (opts.stack as TechStack) || config.stack;
      const interactive = opts.interactive !== false;
      const { pipeline, cleanup } = createContext(swarmDir, config);

      if (interactive) {
        try {
          await pipeline.runPlan({ stack, interactive: true });
        } catch (err) {
          console.error(chalk.red(err instanceof Error ? err.message : String(err)));
          process.exit(1);
        } finally {
          cleanup();
        }
      } else {
        const spinner = ora('Running lead...').start();
        try {
          await pipeline.runPlan({ stack, interactive: false });
          spinner.succeed('Task planning complete');
        } catch (err) {
          spinner.fail('Planning failed');
          console.error(chalk.red(err instanceof Error ? err.message : String(err)));
          process.exit(1);
        } finally {
          cleanup();
        }
      }
    });
}
