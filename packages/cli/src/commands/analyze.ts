import { readFileSync, existsSync } from 'node:fs';
import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir } from '../core/config.js';
import { createContext } from './shared.js';

export function registerAnalyze(program: Command): void {
  program
    .command('analyze')
    .description('Run the Analyst persona to produce REQUIREMENTS.md')
    .argument('<feature-request>', 'Feature request description (text or file path)')
    .option('-s, --stack <stack>', 'Tech stack override (react, node, go)')
    .option('-m, --model <model>', 'Model override (sonnet, opus, haiku)')
    .option('-f, --file', 'Treat argument as a file path to read')
    .option('--no-interactive', 'Run in single-shot mode (no conversation)')
    .action(async (featureRequest: string, opts) => {
      const swarmDir = requireSwarmDir();
      const config = loadConfig();
      if (opts.model) config.model = opts.model;

      let prompt = featureRequest;
      if (opts.file) {
        if (!existsSync(featureRequest)) {
          console.error(chalk.red(`File not found: ${featureRequest}`));
          process.exit(1);
        }
        prompt = readFileSync(featureRequest, 'utf-8');
      }

      const stack = (opts.stack as TechStack) || config.stack;
      const interactive = opts.interactive !== false;
      const { pipeline, cleanup } = createContext(swarmDir, config);

      if (interactive) {
        // Interactive mode: no spinner, Claude takes over the terminal
        try {
          await pipeline.runAnalyze(prompt, { stack, interactive: true });
        } catch (err) {
          console.error(chalk.red(err instanceof Error ? err.message : String(err)));
          process.exit(1);
        } finally {
          cleanup();
        }
      } else {
        // Non-interactive: single-shot with spinner
        const spinner = ora('Running analyst...').start();
        try {
          await pipeline.runAnalyze(prompt, { stack, interactive: false });
          spinner.succeed('Analysis complete');
        } catch (err) {
          spinner.fail('Analysis failed');
          console.error(chalk.red(err instanceof Error ? err.message : String(err)));
          process.exit(1);
        } finally {
          cleanup();
        }
      }
    });
}
