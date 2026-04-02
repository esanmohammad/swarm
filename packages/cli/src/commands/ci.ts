import { readFileSync, existsSync } from 'node:fs';
import chalk from 'chalk';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';

export function registerCi(program: Command): void {
  program
    .command('ci')
    .description('Headless CI pipeline: runs MayDay with JSON output, exits with status code')
    .argument('<feature-request>', 'Feature request description (text or file path)')
    .option('-s, --stack <stack>', 'Tech stack override')
    .option('-m, --model <model>', 'Model override')
    .option('-p, --parallel <n>', 'Max parallel agents', '3')
    .option('-n, --max-iterations <n>', 'Max fix-retest iterations', '3')
    .option('-b, --budget <amount>', 'Max budget in USD', '10')
    .option('--fix-budget <amount>', 'Max fix budget in USD', '10')
    .option('-f, --file', 'Treat argument as a file path to read')
    .option('--lean', 'Use lean mode (haiku for docs, default model for engineer)')
    .option('--from <stage>', 'Start from stage (analyze, architect, plan, build, test)')
    .option('--timeout <minutes>', 'Overall timeout in minutes', '30')
    .option('--json', 'Output results as JSON to stdout')
    .action(async (featureRequest: string, opts) => {
      // Suppress chalk colors in CI
      if (opts.json) {
        chalk.level = 0;
      }

      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        const cwd = process.cwd();
        const stack = (opts.stack as TechStack) || autoDetectStack(cwd);
        const projectName = cwd.split('/').pop() || 'my-project';
        swarmDir = autoInit(projectName, stack, cwd);
      }

      const config = loadConfig();
      if (opts.model) config.model = opts.model;
      config.maxBudgetUsd = opts.budget === 'none' ? null : (parseFloat(opts.budget) || 10);

      // Lean mode
      if (opts.lean) {
        const engineerModel = config.models?.engineer ?? config.model;
        config.models = {
          ...config.models,
          analyst: 'haiku', architect: 'haiku', lead: 'haiku', tester: 'haiku',
          engineer: engineerModel,
        };
      }

      const stack = (opts.stack as TechStack) || config.stack;
      const { pipeline, state, cleanup } = createContext(swarmDir, config);
      pipeline.gitEnabled = false; // CI doesn't create branches

      const fixBudget = opts.fixBudget === 'none' ? null : (parseFloat(opts.fixBudget) || 10);

      // Overall timeout
      const timeoutMs = (parseInt(opts.timeout, 10) || 30) * 60 * 1000;
      const overallTimer = setTimeout(() => {
        if (opts.json) {
          console.log(JSON.stringify({ status: 'timeout', error: `CI timeout after ${opts.timeout}m` }));
        } else {
          console.error(chalk.red(`CI timeout after ${opts.timeout} minutes`));
        }
        cleanup();
        process.exit(2);
      }, timeoutMs);

      const startTime = Date.now();

      try {
        let prompt = featureRequest;
        if (opts.file) {
          if (!existsSync(featureRequest)) {
            throw new Error(`File not found: ${featureRequest}`);
          }
          prompt = readFileSync(featureRequest, 'utf-8');
        }

        await pipeline.runMayday(prompt, {
          stack,
          maxIterations: parseInt(opts.maxIterations, 10),
          parallel: parseInt(opts.parallel, 10),
          maxFixBudgetUsd: fixBudget,
          fromStage: opts.from,
          headless: true,
        });

        clearTimeout(overallTimer);

        const pipelineState = state.getState();
        const elapsed = Date.now() - startTime;
        const testsPassed = !pipelineState.mayday?.error;

        if (opts.json) {
          console.log(JSON.stringify({
            status: testsPassed ? 'pass' : 'fail',
            cost: pipelineState.totalCost.totalUsd,
            durationMs: elapsed,
            stages: Object.fromEntries(
              Object.entries(pipelineState.stages).map(([name, s]) => [
                name, { status: s.status, artifact: s.artifact, cost: s.stageCost ?? null },
              ]),
            ),
            error: pipelineState.mayday?.error ?? null,
          }));
        } else {
          console.log(chalk.bold(`\nCI Pipeline ${testsPassed ? 'PASSED' : 'FAILED'}`));
          console.log(chalk.dim(`  Cost: $${pipelineState.totalCost.totalUsd.toFixed(2)} | Time: ${(elapsed / 60000).toFixed(1)}m`));
        }

        process.exit(testsPassed ? 0 : 1);
      } catch (err) {
        clearTimeout(overallTimer);
        const errMsg = err instanceof Error ? err.message : String(err);

        if (opts.json) {
          console.log(JSON.stringify({
            status: 'error',
            error: errMsg,
            cost: state.getState().totalCost.totalUsd,
            durationMs: Date.now() - startTime,
          }));
        } else {
          console.error(chalk.red(`CI pipeline error: ${errMsg}`));
        }

        process.exit(2);
      } finally {
        cleanup();
      }
    });
}
