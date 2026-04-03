import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir } from '../core/config.js';
import { createContext } from './shared.js';

export function registerArchitect(program: Command): void {
  program
    .command('architect')
    .description('Run the Architect persona to produce SPEC.md from REQUIREMENTS.md')
    .option('-s, --stack <stack>', 'Tech stack override (react, node, go)')
    .option('-m, --model <model>', 'Model override (e.g., sonnet, openai/gpt-4o, ollama/llama3)')
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
          await pipeline.runArchitect({ stack, interactive: true });
        } catch (err) {
          console.error(chalk.red(err instanceof Error ? err.message : String(err)));
          process.exit(1);
        } finally {
          cleanup();
        }
      } else {
        const spinner = ora('Running architect...').start();
        try {
          await pipeline.runArchitect({ stack, interactive: false });
          spinner.succeed('Architecture complete');
        } catch (err) {
          spinner.fail('Architecture failed');
          console.error(chalk.red(err instanceof Error ? err.message : String(err)));
          process.exit(1);
        } finally {
          cleanup();
        }
      }
    });
}
