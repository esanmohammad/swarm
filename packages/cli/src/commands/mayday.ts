import { readFileSync, existsSync } from 'node:fs';
import chalk from 'chalk';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir } from '../core/config.js';
import { createContext } from './shared.js';

export function registerMayday(program: Command): void {
  program
    .command('mayday')
    .description('Autonomous end-to-end pipeline: analyze → build → test → fix loop until all tests pass')
    .argument('[feature-request]', 'Feature request description (text or file path)')
    .option('-s, --stack <stack>', 'Tech stack override (react, node, go)')
    .option('-m, --model <model>', 'Model override (sonnet, opus, haiku)')
    .option('-p, --parallel <n>', 'Max parallel agents', '3')
    .option('-n, --max-iterations <n>', 'Max fix-retest iterations', '5')
    .option('--figma <url>', 'Figma design URL')
    .option('-f, --file', 'Treat argument as a file path to read')
    .option('--resume', 'Resume a previously interrupted MayDay session')
    .action(async (featureRequest: string | undefined, opts) => {
      const swarmDir = requireSwarmDir();
      const config = loadConfig();
      if (opts.model) config.model = opts.model;

      const stack = (opts.stack as TechStack) || config.stack;
      const { pipeline, state, cleanup } = createContext(swarmDir, config);

      try {
        // Resume mode
        if (opts.resume) {
          const mayday = state.getMayday();
          if (!mayday?.active) {
            console.error(chalk.red('No active MayDay session to resume.'));
            process.exit(1);
          }
          await pipeline.resumeMayday({ parallel: parseInt(opts.parallel, 10) });
          return;
        }

        // New run requires a feature request
        if (!featureRequest) {
          console.error(chalk.red('Feature request required. Usage: swarm mayday "build a login page"'));
          process.exit(1);
        }

        let prompt = featureRequest;
        if (opts.file) {
          if (!existsSync(featureRequest)) {
            console.error(chalk.red(`File not found: ${featureRequest}`));
            process.exit(1);
          }
          prompt = readFileSync(featureRequest, 'utf-8');
        }

        await pipeline.runMayday(prompt, {
          stack,
          maxIterations: parseInt(opts.maxIterations, 10),
          figmaUrl: opts.figma,
          parallel: parseInt(opts.parallel, 10),
        });
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      } finally {
        cleanup();
      }
    });
}
