import { execSync } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';

export function registerReview(program: Command): void {
  program
    .command('review')
    .description('Code review: review staged/unstaged changes or a GitHub PR')
    .argument('[target]', 'PR number, branch name, or omit for current changes')
    .option('-s, --stack <stack>', 'Tech stack override')
    .option('-m, --model <model>', 'Model override (default: sonnet)')
    .option('--post', 'Post review as PR comment (requires gh CLI)')
    .option('-b, --budget <amount>', 'Max budget in USD', '3')
    .action(async (target: string | undefined, opts) => {
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
      config.model = opts.model || 'sonnet';
      if (opts.budget) {
        config.maxBudgetUsd = opts.budget === 'none' ? null : (parseFloat(opts.budget) || 3);
      }

      const stack = (opts.stack as TechStack) || config.stack;
      const { agentManager, cleanup } = createContext(swarmDir, config);

      try {
        let diffContent = '';
        let reviewContext = '';

        if (target && /^\d+$/.test(target)) {
          // PR number — fetch via gh CLI
          console.log(chalk.dim(`Fetching PR #${target}...`));
          try {
            const prInfo = execSync(`gh pr view ${target} --json title,body,files,additions,deletions`, {
              encoding: 'utf-8',
              cwd: process.cwd(),
            }).trim();
            const prDiff = execSync(`gh pr diff ${target}`, {
              encoding: 'utf-8',
              cwd: process.cwd(),
            }).trim();
            reviewContext = `Pull Request #${target}:\n${prInfo}`;
            diffContent = prDiff;
          } catch (err) {
            console.error(chalk.red(`Failed to fetch PR #${target}. Is gh CLI installed and authenticated?`));
            process.exit(1);
          }
        } else if (target) {
          // Branch name — diff against it
          try {
            diffContent = execSync(`git diff ${target}...HEAD`, { encoding: 'utf-8', cwd: process.cwd() }).trim();
            reviewContext = `Changes from branch "${target}" to HEAD`;
          } catch {
            console.error(chalk.red(`Failed to diff against branch "${target}".`));
            process.exit(1);
          }
        } else {
          // No target — review current changes (staged + unstaged)
          try {
            const staged = execSync('git diff --cached', { encoding: 'utf-8', cwd: process.cwd() }).trim();
            const unstaged = execSync('git diff', { encoding: 'utf-8', cwd: process.cwd() }).trim();
            diffContent = [staged, unstaged].filter(Boolean).join('\n');
            if (!diffContent) {
              // Fall back to diff against main/master
              try {
                diffContent = execSync('git diff main...HEAD', { encoding: 'utf-8', cwd: process.cwd() }).trim();
                reviewContext = 'Changes on current branch vs main';
              } catch {
                try {
                  diffContent = execSync('git diff master...HEAD', { encoding: 'utf-8', cwd: process.cwd() }).trim();
                  reviewContext = 'Changes on current branch vs master';
                } catch {
                  console.error(chalk.red('No changes to review.'));
                  process.exit(1);
                }
              }
            } else {
              reviewContext = 'Staged and unstaged changes';
            }
          } catch {
            console.error(chalk.red('Not a git repository or git is not available.'));
            process.exit(1);
          }
        }

        if (!diffContent) {
          console.error(chalk.red('No changes to review.'));
          process.exit(1);
        }

        // Truncate very large diffs
        const maxDiffLen = 50000;
        const truncated = diffContent.length > maxDiffLen;
        const diff = truncated ? diffContent.slice(0, maxDiffLen) : diffContent;

        const prompt = [
          'You are a senior code reviewer. Review the following code changes thoroughly.',
          '',
          reviewContext ? `Context: ${reviewContext}` : '',
          '',
          'Produce a structured code review with these sections:',
          '',
          '## Summary',
          'One paragraph describing what the changes do.',
          '',
          '## Issues',
          'List any bugs, security vulnerabilities, performance problems, or logic errors.',
          'For each issue: severity (critical/warning/nit), file, line range, description, suggestion.',
          '',
          '## Suggestions',
          'Code quality improvements, better patterns, naming, readability.',
          '',
          '## Verdict',
          'APPROVE, REQUEST_CHANGES, or COMMENT with a one-line justification.',
          '',
          truncated ? '(Note: diff was truncated to 50KB — review what is visible)\n' : '',
          '---',
          '',
          '```diff',
          diff,
          '```',
        ].join('\n');

        console.log(chalk.bold(`\nSwarm Review — code review`));
        console.log(chalk.dim(`Target: ${reviewContext || 'current changes'}`));
        console.log(chalk.dim(`Model: ${config.model} | Diff size: ${(diffContent.length / 1024).toFixed(1)}KB\n`));

        const spinner = ora('Reviewing code...').start();

        const agent = await agentManager.spawn({
          name: `reviewer-${stack}`,
          persona: 'engineer',
          stack,
          prompt,
          model: config.model,
          cwd: process.cwd(),
          interactive: false,
          permissionMode: 'auto',
          disallowedTools: ['Edit', 'Write', 'Bash', 'NotebookEdit'],
        });

        await agentManager.waitForAgent(agent.id);
        const cost = agent.cost.totalUsd;

        if (agent.status === 'done') {
          spinner.succeed(`Review complete. Cost: $${cost.toFixed(2)}`);

          // Post as PR comment if requested
          if (opts.post && target && /^\d+$/.test(target)) {
            try {
              const reviewOutput = agent.output.trim();
              if (reviewOutput) {
                execSync(`gh pr comment ${target} --body "${reviewOutput.replace(/"/g, '\\"')}"`, {
                  cwd: process.cwd(),
                  stdio: 'pipe',
                });
                console.log(chalk.green(`Review posted to PR #${target}`));
              }
            } catch {
              console.log(chalk.yellow('Could not post review comment — printing to stdout instead.'));
            }
          }
        } else {
          spinner.fail(`Review failed: ${agent.error || 'Unknown error'}`);
        }
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      } finally {
        cleanup();
      }
    });
}
