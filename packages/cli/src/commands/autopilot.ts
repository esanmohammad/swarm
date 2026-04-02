import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import type { AutopilotIssue, AutopilotState, TechStack } from '../types.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';
import { isGhInstalled, getCurrentBranch, buildPRBody } from '../core/git.js';

interface GhIssue {
  number: number;
  title: string;
  body: string;
  labels: Array<{ name: string }>;
  author: { login: string };
  url: string;
  updatedAt: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function getStatePath(swarmDir: string): string {
  return join(swarmDir, 'autopilot-state.json');
}

function loadAutopilotState(swarmDir: string): AutopilotState {
  const path = getStatePath(swarmDir);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch { /* fall through */ }
  }
  return {
    running: false,
    label: 'swarm',
    pollInterval: 10,
    maxConcurrent: 1,
    budgetPerIssue: 10,
    processedIssues: [],
    queue: [],
    stats: { totalProcessed: 0, successful: 0, failed: 0, totalCost: 0 },
  };
}

function saveAutopilotState(swarmDir: string, state: AutopilotState): void {
  if (!existsSync(swarmDir)) mkdirSync(swarmDir, { recursive: true });
  writeFileSync(getStatePath(swarmDir), JSON.stringify(state, null, 2), 'utf-8');
}

export { loadAutopilotState, saveAutopilotState };

export function registerAutopilot(program: Command): void {
  const cmd = program
    .command('autopilot')
    .description('Issue-to-PR automation — watches GitHub issues and builds features automatically');

  cmd
    .command('start')
    .description('Start the autopilot daemon')
    .option('-l, --label <label>', 'GitHub label to watch', 'swarm')
    .option('-i, --interval <minutes>', 'Poll interval in minutes', '10')
    .option('-c, --max-concurrent <n>', 'Max concurrent pipelines', '1')
    .option('-b, --budget <amount>', 'Max budget per issue in USD', '10')
    .option('--auto-assign', 'Assign created PR to issue author')
    .option('--dry-run', 'Process issues but don\'t create PRs')
    .option('-s, --stack <stack>', 'Tech stack override')
    .option('--once', 'Run one cycle and exit (no daemon)')
    .action(async (opts) => {
      if (!isGhInstalled()) {
        console.error(chalk.red('GitHub CLI (gh) is required. Install: https://cli.github.com'));
        process.exit(1);
      }

      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        const cwd = process.cwd();
        const stack = autoDetectStack(cwd);
        const projectName = cwd.split('/').pop() || 'my-project';
        console.log(chalk.yellow(`No .swarm/ found — auto-initializing (stack: ${stack})...`));
        swarmDir = autoInit(projectName, stack, cwd);
      }

      const config = loadConfig();
      const label = opts.label as string;
      const interval = (parseInt(opts.interval) || 10) * 60000;
      const maxConcurrent = parseInt(opts.maxConcurrent) || 1;
      const budget = parseFloat(opts.budget) || 10;
      const autoAssign = opts.autoAssign ?? false;
      const dryRun = opts.dryRun ?? false;
      const stack = (opts.stack as TechStack) || config.stack;
      const once = opts.once ?? false;

      console.log(chalk.bold('\nSwarm Autopilot'));
      console.log(chalk.dim(`Label: ${label} | Interval: ${opts.interval}min | Budget: $${budget}/issue | Max concurrent: ${maxConcurrent}`));
      console.log(chalk.dim(`Dry run: ${dryRun} | Auto-assign: ${autoAssign} | Stack: ${stack}\n`));

      const autopilotState = loadAutopilotState(swarmDir);
      autopilotState.running = true;
      autopilotState.label = label;
      autopilotState.pollInterval = parseInt(opts.interval) || 10;
      autopilotState.maxConcurrent = maxConcurrent;
      autopilotState.budgetPerIssue = budget;
      saveAutopilotState(swarmDir, autopilotState);

      const runCycle = async () => {
        await processIssues(swarmDir, config, {
          label,
          maxConcurrent,
          budget,
          autoAssign,
          dryRun,
          stack,
        });
      };

      await runCycle();

      if (!once) {
        console.log(chalk.dim(`\nNext check in ${opts.interval} minutes... (Ctrl+C to stop)\n`));
        const timer = setInterval(runCycle, interval);
        process.on('SIGINT', () => {
          clearInterval(timer);
          const state = loadAutopilotState(swarmDir);
          state.running = false;
          saveAutopilotState(swarmDir, state);
          console.log(chalk.yellow('\nAutopilot stopped.'));
          process.exit(0);
        });
      } else {
        autopilotState.running = false;
        saveAutopilotState(swarmDir, autopilotState);
      }
    });

  cmd
    .command('stop')
    .description('Stop the autopilot daemon')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found.'));
        process.exit(1);
      }
      const state = loadAutopilotState(swarmDir);
      state.running = false;
      saveAutopilotState(swarmDir, state);
      console.log(chalk.yellow('Autopilot marked as stopped.'));
      console.log(chalk.dim('To kill a running daemon: kill $(pgrep -f "swarm autopilot")'));
    });

  cmd
    .command('status')
    .description('Show autopilot status, queue, and stats')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found.'));
        process.exit(1);
      }

      const state = loadAutopilotState(swarmDir);
      const statusColor = state.running ? chalk.green : chalk.red;

      console.log(chalk.bold('\nSwarm Autopilot Status'));
      console.log(`  Status: ${statusColor(state.running ? 'RUNNING' : 'STOPPED')}`);
      console.log(`  Label: ${state.label} | Poll: ${state.pollInterval}min | Budget: $${state.budgetPerIssue}/issue`);
      console.log('');

      // Stats
      console.log(chalk.bold('Stats'));
      console.log(`  Total processed: ${state.stats.totalProcessed}`);
      console.log(`  Successful: ${chalk.green(String(state.stats.successful))}`);
      console.log(`  Failed: ${chalk.red(String(state.stats.failed))}`);
      console.log(`  Total cost: $${state.stats.totalCost.toFixed(2)}`);
      if (state.stats.totalProcessed > 0) {
        const successRate = ((state.stats.successful / state.stats.totalProcessed) * 100).toFixed(0);
        console.log(`  Success rate: ${successRate}%`);
      }
      console.log('');

      // Queue
      if (state.queue.length > 0) {
        console.log(chalk.bold(`Queue (${state.queue.length}):`));
        for (const issue of state.queue) {
          console.log(`  #${issue.number} — ${issue.title} — ${chalk.yellow(issue.status)}`);
        }
        console.log('');
      }

      // Recent processed
      const recent = state.processedIssues.slice(-10);
      if (recent.length > 0) {
        console.log(chalk.bold(`Recent (last ${recent.length}):`));
        for (const issue of recent) {
          const statusIcon = issue.status === 'done' ? chalk.green('done') : chalk.red('failed');
          const prLink = issue.prUrl ? ` → ${issue.prUrl}` : '';
          const cost = issue.cost != null ? ` ($${issue.cost.toFixed(2)})` : '';
          console.log(`  #${issue.number} — ${issue.title} — ${statusIcon}${cost}${prLink}`);
        }
      }

      if (state.processedIssues.length === 0 && state.queue.length === 0) {
        console.log(chalk.dim('No issues processed yet. Run `swarm autopilot start` to begin.'));
      }
    });
}

async function processIssues(
  swarmDir: string,
  config: import('../types.js').SwarmConfig,
  opts: {
    label: string;
    maxConcurrent: number;
    budget: number;
    autoAssign: boolean;
    dryRun: boolean;
    stack: TechStack;
  },
): Promise<void> {
  const cwd = process.cwd();
  const autopilotState = loadAutopilotState(swarmDir);

  // Fetch open issues with the target label
  let issues: GhIssue[];
  try {
    const raw = execSync(
      `gh issue list --label "${opts.label}" --json number,title,body,labels,author,url,updatedAt --state open --limit 20`,
      { encoding: 'utf-8', cwd },
    ).trim();
    issues = JSON.parse(raw || '[]');
  } catch {
    console.log(chalk.dim(`${new Date().toLocaleTimeString()} — Could not fetch issues (gh CLI error).`));
    return;
  }

  if (issues.length === 0) {
    console.log(chalk.dim(`${new Date().toLocaleTimeString()} — No open issues with label "${opts.label}".`));
    return;
  }

  // Filter out already-processed issues (by number + updatedAt)
  const processedKeys = new Set(
    autopilotState.processedIssues.map(i => `${i.number}-${i.updatedAt}`),
  );
  const pending = issues.filter(i => !processedKeys.has(`${i.number}-${i.updatedAt}`));

  if (pending.length === 0) {
    console.log(chalk.dim(`${new Date().toLocaleTimeString()} — ${issues.length} open issue(s), all already processed.`));
    return;
  }

  console.log(chalk.cyan(`${new Date().toLocaleTimeString()} — Found ${pending.length} issue(s) to process.`));

  // Process up to maxConcurrent at a time (sequential for now — pipeline needs exclusive state)
  const toProcess = pending.slice(0, opts.maxConcurrent);

  for (const issue of toProcess) {
    const issueEntry: AutopilotIssue = {
      number: issue.number,
      title: issue.title,
      body: issue.body || '',
      labels: issue.labels.map(l => l.name),
      author: issue.author.login,
      url: issue.url,
      updatedAt: issue.updatedAt,
      status: 'running',
      startedAt: Date.now(),
    };

    // Add to queue
    autopilotState.queue.push(issueEntry);
    saveAutopilotState(swarmDir, autopilotState);

    console.log(chalk.cyan(`\n  Processing #${issue.number}: ${issue.title} (by @${issue.author.login})`));

    const branchName = `autopilot/${issue.number}-${slugify(issue.title)}`;
    const originalBranch = getCurrentBranch();

    try {
      // Create and checkout a new branch
      execSync(`git checkout -b "${branchName}"`, { cwd, stdio: 'pipe' });

      // Build a feature request from the issue
      const featureRequest = [
        `GitHub Issue #${issue.number}: ${issue.title}`,
        '',
        issue.body || 'No description provided.',
      ].join('\n');

      if (opts.dryRun) {
        console.log(chalk.yellow(`  [DRY RUN] Would run pipeline for: ${issue.title}`));
        issueEntry.status = 'done';
        issueEntry.completedAt = Date.now();
        issueEntry.duration = Date.now() - (issueEntry.startedAt || Date.now());
      } else {
        // Run the full MayDay pipeline
        const { pipeline, state: stateManager, cleanup } = createContext(swarmDir, {
          ...config,
          maxBudgetUsd: opts.budget,
        });

        try {
          await pipeline.runMayday(featureRequest, {
            stack: opts.stack,
            maxIterations: 5,
            parallel: 3,
            maxFixBudgetUsd: opts.budget,
          });

          // Get pipeline state for PR body
          const pipelineState = stateManager.getState();
          const totalCost = pipelineState?.totalCost?.totalUsd ?? 0;

          // Create PR
          const prTitle = `feat: ${issue.title} (autopilot #${issue.number})`;
          const prBody = [
            `## Summary`,
            '',
            `Closes #${issue.number}`,
            '',
            `> ${issue.title}`,
            '',
            issue.body ? `### Issue Description\n${issue.body.slice(0, 2000)}` : '',
            '',
            pipelineState ? buildPRBody(pipelineState) : '',
            '',
            '---',
            `_Auto-generated by Swarm Autopilot ($${totalCost.toFixed(2)})_`,
          ].filter(Boolean).join('\n');

          let prUrl = '';
          try {
            prUrl = execSync(
              `gh pr create --title "${prTitle.replace(/"/g, '\\"')}" --body-file - --base ${originalBranch} --label autopilot`,
              { input: prBody, encoding: 'utf-8', cwd, stdio: ['pipe', 'pipe', 'pipe'] },
            ).trim();
            console.log(chalk.green(`  PR created: ${prUrl}`));
          } catch (prErr) {
            console.log(chalk.yellow(`  Could not create PR: ${prErr instanceof Error ? prErr.message : prErr}`));
          }

          // Comment on the issue
          if (prUrl) {
            try {
              execSync(`gh issue comment ${issue.number} --body-file -`, {
                input: `Swarm Autopilot created PR: ${prUrl}\n\nCost: $${totalCost.toFixed(2)}`,
                cwd,
                stdio: ['pipe', 'pipe', 'pipe'],
              });
            } catch { /* best effort */ }

            // Update labels
            try {
              execSync(`gh issue edit ${issue.number} --add-label in-review --remove-label "${opts.label}"`, {
                cwd, stdio: 'pipe',
              });
            } catch { /* best effort */ }

            // Auto-assign PR to issue author
            if (opts.autoAssign && issue.author.login) {
              try {
                execSync(`gh pr edit --add-assignee "${issue.author.login}"`, {
                  cwd, stdio: 'pipe',
                });
              } catch { /* best effort */ }
            }
          }

          issueEntry.status = 'done';
          issueEntry.prUrl = prUrl || undefined;
          issueEntry.cost = totalCost;
          issueEntry.completedAt = Date.now();
          issueEntry.duration = Date.now() - (issueEntry.startedAt || Date.now());
        } catch (pipeErr) {
          console.error(chalk.red(`  Pipeline failed: ${pipeErr instanceof Error ? pipeErr.message : pipeErr}`));
          issueEntry.status = 'failed';
          issueEntry.error = pipeErr instanceof Error ? pipeErr.message : String(pipeErr);
          issueEntry.completedAt = Date.now();
          issueEntry.duration = Date.now() - (issueEntry.startedAt || Date.now());

          // Comment about failure on the issue
          try {
            execSync(`gh issue comment ${issue.number} --body-file -`, {
              input: `Swarm Autopilot failed to process this issue.\n\nError: ${issueEntry.error?.slice(0, 500)}`,
              cwd,
              stdio: ['pipe', 'pipe', 'pipe'],
            });
          } catch { /* best effort */ }
        } finally {
          cleanup();
        }
      }
    } catch (err) {
      console.error(chalk.red(`  Error processing #${issue.number}: ${err instanceof Error ? err.message : err}`));
      issueEntry.status = 'failed';
      issueEntry.error = err instanceof Error ? err.message : String(err);
      issueEntry.completedAt = Date.now();
    } finally {
      // Switch back to original branch
      try {
        execSync(`git checkout "${originalBranch}"`, { cwd, stdio: 'pipe' });
      } catch { /* best effort */ }

      // Remove from queue, add to processed
      autopilotState.queue = autopilotState.queue.filter(q => q.number !== issue.number);
      autopilotState.processedIssues.push(issueEntry);
      autopilotState.stats.totalProcessed++;
      if (issueEntry.status === 'done') {
        autopilotState.stats.successful++;
      } else {
        autopilotState.stats.failed++;
      }
      autopilotState.stats.totalCost += issueEntry.cost ?? 0;

      // Keep last 200 processed issues
      if (autopilotState.processedIssues.length > 200) {
        autopilotState.processedIssues = autopilotState.processedIssues.slice(-200);
      }
      saveAutopilotState(swarmDir, autopilotState);
    }
  }
}
