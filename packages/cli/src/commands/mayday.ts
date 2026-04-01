import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import type { Command } from 'commander';
import type { TechStack, StageName } from '../types.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';
import { Pipeline } from '../core/pipeline.js';

async function confirmCost(model: string, stageCount: number): Promise<boolean> {
  const est = Pipeline.estimateCost(stageCount, model);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      chalk.yellow(`Estimated cost: ~$${est.low.toFixed(2)}-$${est.high.toFixed(2)}. Proceed? [Y/n] `),
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() !== 'n');
      },
    );
  });
}

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
    .option('-b, --budget <amount>', 'Max total budget in USD (default: from config, "none" for no limit)')
    .option('--fix-budget <amount>', 'Max USD to spend on fix iterations (default: 15, "none" for no limit)', '15')
    .option('-f, --file', 'Treat argument as a file path to read')
    .option('--resume', 'Resume a previously interrupted MayDay session')
    .option('-y, --yes', 'Skip cost confirmation prompt')
    .option('--from <stage>', 'Skip stages before this one (analyze, architect, plan, build, test)')
    .option('--approve', 'Require approval between pipeline stages')
    .option('--no-git', 'Skip git branch creation and auto-commits')
    .action(async (featureRequest: string | undefined, opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        // Auto-init if .swarm/ doesn't exist
        const cwd = process.cwd();
        const stack = (opts.stack as TechStack) || autoDetectStack(cwd);
        const projectName = cwd.split('/').pop() || 'my-project';
        console.log(chalk.yellow(`No .swarm/ found — auto-initializing (stack: ${stack})...`));
        swarmDir = autoInit(projectName, stack, cwd);
        console.log(chalk.green(`Initialized .swarm/ for "${projectName}"`));
      }
      const config = loadConfig();
      if (opts.model) config.model = opts.model;
      if (opts.budget) {
        config.maxBudgetUsd = opts.budget === 'none' ? null : (parseFloat(opts.budget) || null);
      }

      const stack = (opts.stack as TechStack) || config.stack;
      const { pipeline, state, cleanup } = createContext(swarmDir, config);
      pipeline.gitEnabled = opts.git !== false;

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

        const fixBudget = opts.fixBudget === 'none' ? null : (parseFloat(opts.fixBudget) || 15);

        // Cost confirmation (MayDay = 5 stages + fix iterations, estimate 6x)
        if (!opts.yes) {
          const confirmed = await confirmCost(config.model, 6);
          if (!confirmed) {
            console.log(chalk.dim('Aborted.'));
            return;
          }
        }

        await pipeline.runMayday(prompt, {
          stack,
          maxIterations: parseInt(opts.maxIterations, 10),
          figmaUrl: opts.figma,
          parallel: parseInt(opts.parallel, 10),
          maxFixBudgetUsd: fixBudget,
          fromStage: opts.from as StageName | undefined,
          approvalRequired: opts.approve ?? false,
        });
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      } finally {
        cleanup();
      }
    });
}
