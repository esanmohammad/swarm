import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir } from '../core/config.js';
import { createContext } from './shared.js';

export function registerBuild(program: Command): void {
  program
    .command('build')
    .description('Run Engineer persona(s) to implement TASKS.md')
    .option('-s, --stack <stack>', 'Tech stack override (react, node, go)')
    .option('-m, --model <model>', 'Model override (sonnet, opus, haiku)')
    .option('-p, --parallel <n>', 'Max parallel agents', '3')
    .option('-t, --task <id>', 'Run a specific task ID only')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const config = loadConfig();
      if (opts.model) config.model = opts.model;
      const stack = (opts.stack as TechStack) || config.stack;
      const { pipeline, costTracker, cleanup } = createContext(swarmDir, config);

      const spinner = ora('Running engineer(s)...').start();
      try {
        await pipeline.runBuild({
          stack,
          parallel: parseInt(opts.parallel, 10),
          taskId: opts.task,
        });
        spinner.succeed('Build complete');
        console.log(chalk.dim(costTracker.formatTotal()));
      } catch (err) {
        spinner.fail('Build failed');
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      } finally {
        cleanup();
      }
    });
}
