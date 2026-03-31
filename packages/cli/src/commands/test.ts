import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir } from '../core/config.js';
import { createContext } from './shared.js';

export function registerTest(program: Command): void {
  program
    .command('test')
    .description('Generate test plan (TESTPLAN.md) and run Playwright E2E tests')
    .option('-s, --stack <stack>', 'Tech stack override (react, node, go)')
    .option('-m, --model <model>', 'Model override (sonnet, opus, haiku)')
    .option('-p, --parallel <n>', 'Max parallel agents', '2')
    .option('--figma <url>', 'Figma design URL for visual test cases')
    .option('-i, --interactive', 'Run tester in interactive mode')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const config = loadConfig();
      if (opts.model) config.model = opts.model;
      const stack = (opts.stack as TechStack) || config.stack;
      const interactive = opts.interactive ?? false;
      const { pipeline, costTracker, cleanup } = createContext(swarmDir, config);

      if (interactive) {
        try {
          await pipeline.runTest({
            stack,
            parallel: parseInt(opts.parallel, 10),
            figmaUrl: opts.figma,
            interactive: true,
          });
        } catch (err) {
          console.error(chalk.red(err instanceof Error ? err.message : String(err)));
          process.exit(1);
        } finally {
          cleanup();
        }
      } else {
        const spinner = ora('Running test stage...').start();
        try {
          await pipeline.runTest({
            stack,
            parallel: parseInt(opts.parallel, 10),
            figmaUrl: opts.figma,
          });
          spinner.succeed('Test stage complete');
          console.log(chalk.dim(costTracker.formatTotal()));
        } catch (err) {
          spinner.fail('Test stage failed');
          console.error(chalk.red(err instanceof Error ? err.message : String(err)));
          process.exit(1);
        } finally {
          cleanup();
        }
      }
    });
}
