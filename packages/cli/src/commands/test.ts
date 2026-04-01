import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir } from '../core/config.js';
import { createContext } from './shared.js';
import { InputListener } from '../core/input-listener.js';

export function registerTest(program: Command): void {
  program
    .command('test')
    .description('Generate test plan (TESTPLAN.md) and run Playwright E2E tests')
    .option('-s, --stack <stack>', 'Tech stack override (react, node, go)')
    .option('-m, --model <model>', 'Model override (sonnet, opus, haiku)')
    .option('-p, --parallel <n>', 'Max parallel agents', '2')
    .option('--figma <url>', 'Figma design URL for visual test cases')
    .option('-i, --interactive', 'Run tester in interactive mode (stdio inherited)')
    .option('--headless', 'Skip interactive features (for CI/automation)')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const config = loadConfig();
      if (opts.model) config.model = opts.model;
      const stack = (opts.stack as TechStack) || config.stack;
      const interactive = opts.interactive ?? false;
      const { pipeline, agentManager, costTracker, cleanup } = createContext(swarmDir, config);

      if (interactive) {
        // Full interactive mode — agent owns terminal
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
        // Non-interactive with optional input listener
        const inputListener = new InputListener();
        if (!opts.headless) {
          inputListener.start((text) => {
            const agents = agentManager.getRunningAgents();
            if (agents.length > 0) {
              const target = agents[agents.length - 1];
              agentManager.sendInput(target.id, text);
              console.log(chalk.magenta(`  → sent to ${target.name}`));
            }
          });
          console.log(chalk.dim('Tip: Type a message and press Enter to send feedback to the active agent.\n'));
        }

        const spinner = opts.headless ? ora('Running test stage...').start() : null;
        try {
          await pipeline.runTest({
            stack,
            parallel: parseInt(opts.parallel, 10),
            figmaUrl: opts.figma,
          });
          if (spinner) spinner.succeed('Test stage complete');
          else console.log(chalk.green('\nTest stage complete'));
          console.log(chalk.dim(costTracker.formatTotal()));
        } catch (err) {
          if (spinner) spinner.fail('Test stage failed');
          else console.log(chalk.red('\nTest stage failed'));
          console.error(chalk.red(err instanceof Error ? err.message : String(err)));
          process.exit(1);
        } finally {
          inputListener.stop();
          cleanup();
        }
      }
    });
}
