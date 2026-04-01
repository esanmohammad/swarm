import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir } from '../core/config.js';
import { createContext } from './shared.js';
import { InputListener } from '../core/input-listener.js';

export function registerBuild(program: Command): void {
  program
    .command('build')
    .description('Run Engineer persona(s) to implement TASKS.md')
    .option('-s, --stack <stack>', 'Tech stack override (react, node, go)')
    .option('-m, --model <model>', 'Model override (sonnet, opus, haiku)')
    .option('-p, --parallel <n>', 'Max parallel agents', '3')
    .option('-t, --task <id>', 'Run a specific task ID only')
    .option('--headless', 'Skip interactive features (for CI/automation)')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const config = loadConfig();
      if (opts.model) config.model = opts.model;
      const stack = (opts.stack as TechStack) || config.stack;
      const { pipeline, agentManager, costTracker, cleanup } = createContext(swarmDir, config);

      // Set up input listener for sending messages to running agents
      const inputListener = new InputListener();
      if (!opts.headless) {
        inputListener.start((text) => {
          // Send input to the most recently running agent
          const agents = agentManager.getRunningAgents();
          if (agents.length > 0) {
            const target = agents[agents.length - 1];
            agentManager.sendInput(target.id, text);
            console.log(chalk.magenta(`  → sent to ${target.name}`));
          }
        });
        console.log(chalk.dim('Tip: Type a message and press Enter to send feedback to the active engineer.\n'));
      }

      const spinner = opts.headless ? ora('Running engineer(s)...').start() : null;
      try {
        await pipeline.runBuild({
          stack,
          parallel: parseInt(opts.parallel, 10),
          taskId: opts.task,
        });
        if (spinner) spinner.succeed('Build complete');
        else console.log(chalk.green('\nBuild complete'));
        console.log(chalk.dim(costTracker.formatTotal()));
      } catch (err) {
        if (spinner) spinner.fail('Build failed');
        else console.log(chalk.red('\nBuild failed'));
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      } finally {
        inputListener.stop();
        cleanup();
      }
    });
}
