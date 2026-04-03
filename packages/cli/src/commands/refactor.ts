import { existsSync, readFileSync } from 'node:fs';
import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';

export function registerRefactor(program: Command): void {
  program
    .command('refactor')
    .description('Refactor code: analyze scope → engineer changes → run tests')
    .argument('<description>', 'What to refactor and why')
    .option('-s, --stack <stack>', 'Tech stack override')
    .option('-m, --model <model>', 'Model override (e.g., sonnet, openai/gpt-4o, ollama/llama3)')
    .option('-f, --file', 'Treat argument as a file path to read')
    .option('-b, --budget <amount>', 'Max budget in USD (default: from config)')
    .option('--scope <path>', 'Limit refactoring to a specific directory or file')
    .option('--no-git', 'Skip git branch creation and auto-commits')
    .option('-y, --yes', 'Skip cost confirmation')
    .action(async (description: string, opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        const cwd = process.cwd();
        const stack = (opts.stack as TechStack) || autoDetectStack(cwd);
        const projectName = cwd.split('/').pop() || 'my-project';
        console.log(chalk.yellow(`No .swarm/ found — auto-initializing (stack: ${stack})...`));
        swarmDir = autoInit(projectName, stack, cwd);
      }

      const config = loadConfig();
      if (opts.model) config.model = opts.model;
      if (opts.budget) {
        config.maxBudgetUsd = opts.budget === 'none' ? null : (parseFloat(opts.budget) || null);
      }

      const stack = (opts.stack as TechStack) || config.stack;
      const { agentManager, cleanup } = createContext(swarmDir, config);

      try {
        let refactorDescription = description;
        if (opts.file) {
          if (!existsSync(description)) {
            console.error(chalk.red(`File not found: ${description}`));
            process.exit(1);
          }
          refactorDescription = readFileSync(description, 'utf-8');
        }

        const scopeClause = opts.scope
          ? `\nScope: Only modify files within "${opts.scope}". Do NOT touch files outside this scope.`
          : '';

        console.log(chalk.bold(`\nSwarm Refactor — targeted code refactoring`));
        console.log(chalk.dim(`Task: ${refactorDescription.slice(0, 100)}${refactorDescription.length > 100 ? '...' : ''}`));
        if (opts.scope) console.log(chalk.dim(`Scope: ${opts.scope}`));
        console.log(chalk.dim(`Model: ${config.model} | Budget: ${config.maxBudgetUsd ? '$' + config.maxBudgetUsd : 'unlimited'}\n`));

        // Step 1: Analyze scope — quick read-only scan
        console.log(chalk.cyan('[1/2] Analyzing refactoring scope...\n'));
        const analyzeSpinner = ora('Scanning codebase...').start();

        const analyzePrompt = [
          'You are analyzing a codebase for a targeted refactoring. Do NOT make any changes yet.',
          '',
          `Refactoring goal: ${refactorDescription}`,
          scopeClause,
          '',
          'Instructions:',
          '1. Read the relevant files to understand the current structure.',
          '2. Identify all files that need to change.',
          '3. List potential risks (breaking changes, test failures, API changes).',
          '4. Print a summary with:',
          '   - Files to modify (with brief reason for each)',
          '   - Estimated complexity (simple/moderate/complex)',
          '   - Risks and considerations',
        ].join('\n');

        const analyst = await agentManager.spawn({
          name: `refactor-analyst-${stack}`,
          persona: 'engineer',
          stack,
          prompt: analyzePrompt,
          model: config.model,
          cwd: process.cwd(),
          interactive: false,
          permissionMode: 'auto',
          disallowedTools: ['Edit', 'Write', 'Bash', 'NotebookEdit'],
        });

        await agentManager.waitForAgent(analyst.id);
        const analysisCost = analyst.cost.totalUsd;

        if (analyst.status !== 'done') {
          analyzeSpinner.fail(`Analysis failed: ${analyst.error || 'Unknown error'}`);
          process.exit(1);
        }
        analyzeSpinner.succeed(`Scope analysis complete. Cost: $${analysisCost.toFixed(2)}`);

        // Step 2: Engineer the refactoring
        console.log(chalk.cyan('\n[2/2] Applying refactoring...\n'));
        const refactorSpinner = ora('Refactoring...').start();

        const analysisOutput = analyst.output.slice(-10000); // Last 10KB of analysis
        const refactorPrompt = [
          'You are refactoring code based on the analysis below. Make the changes and verify they work.',
          '',
          `Refactoring goal: ${refactorDescription}`,
          scopeClause,
          '',
          'Analysis findings:',
          analysisOutput,
          '',
          'Instructions:',
          '1. Apply the refactoring changes identified in the analysis.',
          '2. Make minimal, focused changes — do NOT add features or fix unrelated issues.',
          '3. Preserve all existing behavior — this is a refactoring, not a feature change.',
          '4. Run existing tests to verify nothing is broken.',
          '5. If tests fail, fix the refactoring (not the tests) to restore passing behavior.',
        ].join('\n');

        const engineer = await agentManager.spawn({
          name: `refactor-engineer-${stack}`,
          persona: 'engineer',
          stack,
          prompt: refactorPrompt,
          model: config.model,
          cwd: process.cwd(),
          interactive: false,
          permissionMode: 'auto',
        });

        await agentManager.waitForAgent(engineer.id);
        const totalCost = analysisCost + engineer.cost.totalUsd;

        if (engineer.status === 'done') {
          refactorSpinner.succeed(`Refactoring complete. Total cost: $${totalCost.toFixed(2)}`);
        } else {
          refactorSpinner.fail(`Refactoring failed: ${engineer.error || 'Unknown error'}`);
          process.exit(1);
        }
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      } finally {
        cleanup();
      }
    });
}
