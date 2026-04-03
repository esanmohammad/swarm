import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';
import { isGhInstalled } from '../core/git.js';

export function registerFix(program: Command): void {
  program
    .command('fix')
    .description('Fix a bug: skip analysis/architecture, go straight to engineer → test → fix loop')
    .argument('[description]', 'Bug description (text or file path)')
    .option('-s, --stack <stack>', 'Tech stack override (react, node, go, python, rust, swift)')
    .option('-m, --model <model>', 'Model override (e.g., sonnet, openai/gpt-4o, ollama/llama3)')
    .option('-f, --file', 'Treat argument as a file path to read')
    .option('-i, --issue <number>', 'GitHub issue number to fix (fetches via gh CLI)')
    .option('-b, --budget <amount>', 'Max budget in USD (default: from config)')
    .option('-n, --max-iterations <n>', 'Max fix-retest iterations', '3')
    .option('--fix-budget <amount>', 'Max USD to spend on fix iterations', '10')
    .option('-y, --yes', 'Skip cost confirmation')
    .option('--no-git', 'Skip git branch creation and auto-commits')
    .action(async (description: string | undefined, opts) => {
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
      const { agentManager, state: stateManager, cleanup } = createContext(swarmDir, config);

      try {
        let bugDescription = '';
        let issueContext = '';

        // GitHub issue mode
        if (opts.issue) {
          if (!isGhInstalled()) {
            console.error(chalk.red('gh CLI is not installed. Install it from https://cli.github.com'));
            process.exit(1);
          }
          console.log(chalk.dim(`Fetching issue #${opts.issue}...`));
          try {
            const issueJson = execSync(
              `gh issue view ${opts.issue} --json title,body,labels,comments`,
              { encoding: 'utf-8', cwd: process.cwd() },
            ).trim();
            const issue = JSON.parse(issueJson);
            bugDescription = `[Issue #${opts.issue}] ${issue.title}\n\n${issue.body || ''}`;

            // Include up to 5 most recent comments for context
            if (issue.comments && issue.comments.length > 0) {
              const recentComments = issue.comments.slice(-5);
              issueContext = '\n\nIssue comments:\n' + recentComments
                .map((c: { author: { login: string }; body: string }) => `@${c.author.login}: ${c.body.slice(0, 500)}`)
                .join('\n---\n');
            }

            if (issue.labels && issue.labels.length > 0) {
              issueContext += `\nLabels: ${issue.labels.map((l: { name: string }) => l.name).join(', ')}`;
            }

            console.log(chalk.dim(`Issue: ${issue.title}`));
          } catch (err) {
            console.error(chalk.red(`Failed to fetch issue #${opts.issue}. Is gh CLI authenticated?`));
            process.exit(1);
          }
        } else if (description) {
          bugDescription = description;
          if (opts.file) {
            if (!existsSync(description)) {
              console.error(chalk.red(`File not found: ${description}`));
              process.exit(1);
            }
            bugDescription = readFileSync(description, 'utf-8');
          }
        } else {
          console.error(chalk.red('Bug description required. Usage: swarm fix "describe the bug" or swarm fix --issue 123'));
          process.exit(1);
        }

        // Gather git context for the engineer
        let gitContext = '';
        try {
          const diff = execSync('git diff HEAD', { encoding: 'utf-8', cwd: process.cwd() }).trim();
          if (diff) {
            gitContext = `\n\nRecent uncommitted changes:\n\`\`\`diff\n${diff.slice(0, 5000)}\n\`\`\``;
          }
        } catch { /* not a git repo or no changes */ }

        console.log(chalk.bold(`\nSwarm Fix — direct bug fix mode`));
        console.log(chalk.dim(`Bug: ${bugDescription.slice(0, 100)}${bugDescription.length > 100 ? '...' : ''}`));
        console.log(chalk.dim(`Model: ${config.model} | Budget: ${config.maxBudgetUsd ? '$' + config.maxBudgetUsd : 'unlimited'}\n`));

        const prompt = [
          'You are fixing a bug. Read the codebase, understand the issue, and fix it.',
          '',
          `Bug description: ${bugDescription}`,
          issueContext,
          '',
          'Instructions:',
          '1. First, understand the bug by reading relevant files and understanding the codebase structure.',
          '2. Identify the root cause.',
          '3. Implement the fix with minimal changes — do NOT refactor unrelated code.',
          '4. Run existing tests to verify the fix does not break anything.',
          '5. If no tests exist for this bug, write a focused test that reproduces the bug and verifies the fix.',
          gitContext,
        ].join('\n');

        const spinner = ora('Engineer fixing bug...').start();

        const agent = await agentManager.spawn({
          name: `fix-engineer-${stack}`,
          persona: 'engineer',
          stack,
          prompt,
          model: config.model,
          cwd: process.cwd(),
          interactive: false,
          permissionMode: 'auto',
        });

        await agentManager.waitForAgent(agent.id);
        const cost = agent.cost.totalUsd;
        const durationMs = Date.now() - (agent.startedAt ?? Date.now());

        if (agent.status === 'done') {
          spinner.succeed(`Bug fix complete. Cost: $${cost.toFixed(2)}`);
          stateManager.saveActivity({
            activityType: 'fix',
            summary: bugDescription.slice(0, 200),
            cost: agent.cost,
            durationMs,
            status: 'success',
            model: config.model,
          });
        } else {
          spinner.fail(`Bug fix failed: ${agent.error || 'Unknown error'}`);
          stateManager.saveActivity({
            activityType: 'fix',
            summary: bugDescription.slice(0, 200),
            cost: agent.cost,
            durationMs,
            status: 'error',
            model: config.model,
          });
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
