import { execSync } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';

export function registerSimplify(program: Command): void {
  program
    .command('simplify')
    .description('Review changed code for reuse, quality, and efficiency — then auto-fix issues')
    .option('-s, --stack <stack>', 'Tech stack override')
    .option('-m, --model <model>', 'Model override (default: haiku for speed, e.g., sonnet, openai/gpt-4o)')
    .option('--scope <path>', 'Limit to specific directory or file')
    .option('--dry-run', 'Report only — do not apply changes')
    .option('-b, --budget <amount>', 'Max budget in USD', '3')
    .action(async (opts) => {
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
      config.model = opts.model || 'haiku';
      if (opts.budget) {
        config.maxBudgetUsd = opts.budget === 'none' ? null : (parseFloat(opts.budget) || 3);
      }

      const stack = (opts.stack as TechStack) || config.stack;
      const { agentManager, cleanup } = createContext(swarmDir, config);
      const dryRun = opts.dryRun ?? false;

      try {
        // Gather changed files
        let diff = '';
        let changedFiles = '';
        const cwd = process.cwd();

        try {
          const staged = execSync('git diff --cached', { encoding: 'utf-8', cwd }).trim();
          const unstaged = execSync('git diff', { encoding: 'utf-8', cwd }).trim();
          diff = [staged, unstaged].filter(Boolean).join('\n');

          if (!diff) {
            // Try branch diff against main/master
            try {
              diff = execSync('git diff main...HEAD', { encoding: 'utf-8', cwd }).trim();
            } catch {
              try {
                diff = execSync('git diff master...HEAD', { encoding: 'utf-8', cwd }).trim();
              } catch { /* ignore */ }
            }
          }

          changedFiles = execSync('git diff --name-only HEAD', { encoding: 'utf-8', cwd }).trim();
          if (!changedFiles) {
            try {
              changedFiles = execSync('git diff --name-only main...HEAD', { encoding: 'utf-8', cwd }).trim();
            } catch {
              try {
                changedFiles = execSync('git diff --name-only master...HEAD', { encoding: 'utf-8', cwd }).trim();
              } catch { /* ignore */ }
            }
          }
        } catch {
          console.error(chalk.red('Not a git repository or no changes found.'));
          process.exit(1);
        }

        if (!diff) {
          console.log(chalk.yellow('No changes to simplify.'));
          return;
        }

        // Apply scope filter
        if (opts.scope) {
          const scopePrefix = opts.scope.replace(/\/$/, '');
          const filteredFiles = changedFiles.split('\n').filter(f => f.startsWith(scopePrefix));
          if (filteredFiles.length === 0) {
            console.log(chalk.yellow(`No changed files within scope "${opts.scope}".`));
            return;
          }
          changedFiles = filteredFiles.join('\n');
        }

        // Truncate large diffs
        const maxDiffLen = 40000;
        const truncated = diff.length > maxDiffLen;
        const trimmedDiff = truncated ? diff.slice(0, maxDiffLen) : diff;

        console.log(chalk.bold(`\nSwarm Simplify — code quality review${dryRun ? ' (dry run)' : ''}`));
        console.log(chalk.dim(`Changed files: ${changedFiles.split('\n').length}`));
        if (opts.scope) console.log(chalk.dim(`Scope: ${opts.scope}`));
        console.log(chalk.dim(`Model: ${config.model} | Mode: ${dryRun ? 'report only' : 'auto-fix'}\n`));

        // Step 1: Analyze changes
        console.log(chalk.cyan(dryRun ? '[1/1] Analyzing changes...\n' : '[1/2] Analyzing changes...\n'));
        const analyzeSpinner = ora('Scanning for issues...').start();

        const analyzePrompt = [
          'You are a code quality reviewer. Analyze these code changes and identify simplification opportunities.',
          '',
          'Changed files:',
          changedFiles,
          '',
          'Review the diff AND read the full source files for context. Look for:',
          '',
          '1. **Dead code**: Unused imports, variables, functions, or unreachable code introduced in the changes.',
          '2. **Unnecessary abstractions**: Wrappers, helpers, or indirection that add complexity without value.',
          '3. **Duplication**: Code that duplicates existing utilities or patterns already in the codebase.',
          '4. **Over-engineering**: Feature flags, configuration, or extensibility that isn\'t needed yet.',
          '5. **Inconsistent patterns**: Code that deviates from patterns used elsewhere in the project.',
          '6. **Missed reuse**: Existing utilities, components, or helpers that could replace new code.',
          '',
          'For each finding, report:',
          '- **Severity**: high (definite problem) | medium (improvement) | low (nit)',
          '- **File**: exact file path',
          '- **Lines**: approximate line range',
          '- **Issue**: what\'s wrong',
          '- **Fix**: specific suggested change',
          '',
          truncated ? '(Note: diff truncated to 40KB — read full files for complete context)\n' : '',
          '```diff',
          trimmedDiff,
          '```',
        ].join('\n');

        const analyst = await agentManager.spawn({
          name: `simplify-analyst-${stack}`,
          persona: 'engineer',
          stack,
          prompt: analyzePrompt,
          model: config.model,
          cwd,
          interactive: false,
          permissionMode: 'auto',
          disallowedTools: ['Edit', 'Write', 'Bash', 'NotebookEdit'],
        });

        await agentManager.waitForAgent(analyst.id);

        if (analyst.status !== 'done') {
          analyzeSpinner.fail(`Analysis failed: ${analyst.error || 'Unknown error'}`);
          process.exit(1);
        }
        analyzeSpinner.succeed(`Analysis complete. Cost: $${analyst.cost.totalUsd.toFixed(2)}`);

        if (dryRun) {
          console.log(chalk.dim('\nDry run — no changes applied.'));
          return;
        }

        // Step 2: Apply fixes
        console.log(chalk.cyan('\n[2/2] Applying simplifications...\n'));
        const fixSpinner = ora('Simplifying code...').start();

        const analysisOutput = analyst.output.slice(-10000);
        const fixPrompt = [
          'Apply the simplification fixes identified in the analysis below.',
          '',
          'Analysis findings:',
          analysisOutput,
          '',
          'Rules:',
          '1. Only apply changes rated "high" severity with full confidence.',
          '2. For "medium" severity: apply if the fix is straightforward and clearly correct.',
          '3. Skip "low" severity items — they\'re nits.',
          '4. After applying fixes, run existing tests to verify nothing is broken.',
          '5. If a fix breaks tests, REVERT that specific fix immediately.',
          '6. Do NOT refactor code that wasn\'t flagged in the analysis.',
          '7. Do NOT add comments, docstrings, or type annotations that weren\'t in the original.',
        ].join('\n');

        const fixer = await agentManager.spawn({
          name: `simplify-fixer-${stack}`,
          persona: 'engineer',
          stack,
          prompt: fixPrompt,
          model: config.model,
          cwd,
          interactive: false,
          permissionMode: 'auto',
        });

        await agentManager.waitForAgent(fixer.id);
        const totalCost = analyst.cost.totalUsd + fixer.cost.totalUsd;

        if (fixer.status === 'done') {
          fixSpinner.succeed(`Simplification complete. Total cost: $${totalCost.toFixed(2)}`);
        } else {
          fixSpinner.fail(`Simplification failed: ${fixer.error || 'Unknown error'}`);
        }
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      } finally {
        cleanup();
      }
    });
}
