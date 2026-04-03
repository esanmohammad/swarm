import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';
import { isGhInstalled } from '../core/git.js';
import { loadConventions } from './learn.js';

interface ReviewedPR {
  number: number;
  sha: string;
  reviewedAt: string;
  verdict: string;
  cost: number;
}

interface PRInfo {
  number: number;
  title: string;
  body: string;
  headRefOid: string;
  author: { login: string };
  labels: Array<{ name: string }>;
  additions: number;
  deletions: number;
}

export function registerBabysitPrs(program: Command): void {
  const cmd = program
    .command('babysit-prs')
    .description('Background daemon that watches and reviews PRs automatically');

  cmd
    .command('start')
    .description('Start watching PRs for review')
    .option('-i, --interval <minutes>', 'Poll interval in minutes', '5')
    .option('-m, --model <model>', 'Model for reviews (e.g., sonnet, openai/gpt-4o, ollama/llama3)')
    .option('-l, --label <label>', 'Only review PRs with this label')
    .option('--auto-approve', 'Auto-approve PRs that pass review')
    .option('--post', 'Post review as PR comment (default: true)', true)
    .option('--once', 'Run one review cycle and exit (no daemon)')
    .option('-b, --budget <amount>', 'Max budget per review in USD', '3')
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
      config.model = opts.model || config.model;
      config.maxBudgetUsd = opts.budget === 'none' ? null : (parseFloat(opts.budget) || 3);
      const interval = (parseInt(opts.interval) || 5) * 60000;
      const label = opts.label as string | undefined;
      const autoApprove = opts.autoApprove ?? false;
      const post = opts.post ?? true;
      const once = opts.once ?? false;

      console.log(chalk.bold(`\nSwarm PR Babysitter`));
      console.log(chalk.dim(`Interval: ${opts.interval}min | Model: ${config.model} | Label: ${label || 'any'} | Auto-approve: ${autoApprove}`));
      console.log(chalk.dim(`Post comments: ${post}\n`));

      const reviewCycle = async () => {
        const { agentManager, cleanup } = createContext(swarmDir, config);
        try {
          await runReviewCycle(swarmDir, config, agentManager, {
            label, autoApprove, post,
          });
        } catch (err) {
          console.error(chalk.red(`Review cycle error: ${err instanceof Error ? err.message : err}`));
        } finally {
          cleanup();
        }
      };

      await reviewCycle();

      if (!once) {
        console.log(chalk.dim(`\nNext check in ${opts.interval} minutes... (Ctrl+C to stop)\n`));
        const timer = setInterval(reviewCycle, interval);
        // Graceful shutdown
        process.on('SIGINT', () => {
          clearInterval(timer);
          console.log(chalk.yellow('\nBabysitter stopped.'));
          process.exit(0);
        });
      }
    });

  cmd
    .command('status')
    .description('Show review history and stats')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found.'));
        process.exit(1);
      }

      const reviews = loadReviewHistory(swarmDir);
      if (reviews.length === 0) {
        console.log(chalk.dim('No PRs reviewed yet. Run `swarm babysit-prs start` to begin.'));
        return;
      }

      console.log(chalk.bold(`\nPR Review History (${reviews.length} reviews):\n`));
      const totalCost = reviews.reduce((sum, r) => sum + r.cost, 0);
      const approvals = reviews.filter(r => r.verdict === 'APPROVE').length;
      const changes = reviews.filter(r => r.verdict === 'REQUEST_CHANGES').length;

      console.log(chalk.dim(`  Total cost: $${totalCost.toFixed(2)} | Approvals: ${approvals} | Changes requested: ${changes}\n`));

      for (const r of reviews.slice(-10)) {
        const verdictColor = r.verdict === 'APPROVE' ? chalk.green : r.verdict === 'REQUEST_CHANGES' ? chalk.red : chalk.yellow;
        console.log(`  PR #${r.number} — ${verdictColor(r.verdict)} — $${r.cost.toFixed(2)} — ${r.reviewedAt.split('T')[0]}`);
      }
    });

  cmd
    .command('stop')
    .description('Stop the babysitter daemon (sends SIGINT)')
    .action(() => {
      console.log(chalk.yellow('To stop the babysitter, press Ctrl+C in the terminal where it is running.'));
      console.log(chalk.dim('Or use: kill $(pgrep -f "swarm babysit-prs")'));
    });
}

async function runReviewCycle(
  swarmDir: string,
  config: import('../types.js').SwarmConfig,
  agentManager: import('../core/agent-manager.js').AgentManager,
  opts: { label?: string; autoApprove: boolean; post: boolean },
): Promise<void> {
  const cwd = process.cwd();
  const reviewed = loadReviewHistory(swarmDir);
  const reviewedMap = new Map(reviewed.map(r => [`${r.number}-${r.sha}`, r]));

  // Fetch open PRs
  let prListCmd = 'gh pr list --json number,title,body,headRefOid,author,labels,additions,deletions --limit 20';
  if (opts.label) {
    prListCmd += ` --label "${opts.label}"`;
  }

  let prs: PRInfo[];
  try {
    const raw = execSync(prListCmd, { encoding: 'utf-8', cwd }).trim();
    prs = JSON.parse(raw || '[]');
  } catch {
    console.log(chalk.dim('No open PRs found or gh CLI error.'));
    return;
  }

  if (prs.length === 0) {
    console.log(chalk.dim(`${new Date().toLocaleTimeString()} — No open PRs to review.`));
    return;
  }

  // Filter out already-reviewed PRs (same PR + same SHA)
  const pending = prs.filter(pr => !reviewedMap.has(`${pr.number}-${pr.headRefOid}`));

  if (pending.length === 0) {
    console.log(chalk.dim(`${new Date().toLocaleTimeString()} — ${prs.length} open PR(s), all already reviewed.`));
    return;
  }

  console.log(chalk.cyan(`${new Date().toLocaleTimeString()} — Found ${pending.length} PR(s) to review.`));

  // Load conventions for injection
  const conventions = loadConventions(swarmDir);

  for (const pr of pending) {
    console.log(chalk.cyan(`\n  Reviewing PR #${pr.number}: ${pr.title} (by @${pr.author.login})`));
    console.log(chalk.dim(`  +${pr.additions} -${pr.deletions} lines`));

    let diff: string;
    try {
      diff = execSync(`gh pr diff ${pr.number}`, { encoding: 'utf-8', cwd }).trim();
    } catch {
      console.log(chalk.yellow(`  Skipping PR #${pr.number} — could not fetch diff.`));
      continue;
    }

    if (!diff) {
      console.log(chalk.dim(`  PR #${pr.number} has no changes.`));
      continue;
    }

    // Truncate large diffs
    const maxLen = 50000;
    const truncated = diff.length > maxLen;
    const trimmedDiff = truncated ? diff.slice(0, maxLen) : diff;

    const prompt = [
      'You are a senior code reviewer performing an automated PR review.',
      '',
      `Pull Request #${pr.number}: ${pr.title}`,
      `Author: @${pr.author.login}`,
      `Changes: +${pr.additions} -${pr.deletions} lines`,
      pr.body ? `\nDescription:\n${pr.body.slice(0, 2000)}` : '',
      '',
      conventions ? `\n${conventions}\n` : '',
      'Produce a structured code review:',
      '',
      '## Summary',
      'Brief description of what the PR does.',
      '',
      '## Issues',
      'Bugs, security issues, performance problems. For each: severity, file, suggestion.',
      '',
      '## Convention Violations',
      'Any deviations from project conventions (naming, patterns, imports, tests).',
      '',
      '## Suggestions',
      'Improvements for readability, maintainability, or performance.',
      '',
      '## Verdict',
      'APPROVE, REQUEST_CHANGES, or COMMENT — with one-line justification.',
      '',
      truncated ? '(Note: diff truncated to 50KB)\n' : '',
      '```diff',
      trimmedDiff,
      '```',
    ].join('\n');

    const agent = await agentManager.spawn({
      name: `pr-reviewer-${pr.number}`,
      persona: 'engineer',
      stack: config.stack,
      prompt,
      model: config.model,
      cwd,
      interactive: false,
      permissionMode: 'auto',
      disallowedTools: ['Edit', 'Write', 'Bash', 'NotebookEdit'],
      appendSystemPrompt: conventions || undefined,
    });

    await agentManager.waitForAgent(agent.id);
    const cost = agent.cost.totalUsd;

    // Parse verdict from output
    const output = agent.output.trim();
    let verdict = 'COMMENT';
    if (output.match(/verdict[:\s]*APPROVE/i)) verdict = 'APPROVE';
    else if (output.match(/verdict[:\s]*REQUEST_CHANGES/i)) verdict = 'REQUEST_CHANGES';

    const verdictColor = verdict === 'APPROVE' ? chalk.green : verdict === 'REQUEST_CHANGES' ? chalk.red : chalk.yellow;
    console.log(`  ${verdictColor(verdict)} — $${cost.toFixed(2)}`);

    // Post comment
    if (opts.post && output) {
      try {
        const commentBody = `## Swarm AI Review\n\n${output}\n\n---\n*Reviewed by [Swarm](https://github.com/esanmohammad/swarm) (${config.model}, $${cost.toFixed(2)})*`;
        // Use stdin to avoid shell escaping issues
        execSync(`gh pr comment ${pr.number} --body-file -`, {
          input: commentBody,
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        console.log(chalk.green(`  Comment posted to PR #${pr.number}`));
      } catch {
        console.log(chalk.yellow(`  Could not post comment to PR #${pr.number}`));
      }
    }

    // Auto-approve if configured and verdict is APPROVE
    if (opts.autoApprove && verdict === 'APPROVE') {
      try {
        execSync(`gh pr review ${pr.number} --approve --body "Auto-approved by Swarm AI review"`, {
          cwd,
          stdio: 'pipe',
        });
        console.log(chalk.green(`  PR #${pr.number} auto-approved`));
      } catch {
        console.log(chalk.yellow(`  Could not auto-approve PR #${pr.number}`));
      }
    }

    // Save to history
    saveReview(swarmDir, {
      number: pr.number,
      sha: pr.headRefOid,
      reviewedAt: new Date().toISOString(),
      verdict,
      cost,
    });
  }
}

function getReviewHistoryPath(swarmDir: string): string {
  return join(swarmDir, 'memory', 'pr-reviews.json');
}

function loadReviewHistory(swarmDir: string): ReviewedPR[] {
  const path = getReviewHistoryPath(swarmDir);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return [];
  }
}

function saveReview(swarmDir: string, review: ReviewedPR): void {
  const dir = join(swarmDir, 'memory');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = getReviewHistoryPath(swarmDir);
  const reviews = loadReviewHistory(swarmDir);
  reviews.push(review);
  // Keep last 200 reviews
  const trimmed = reviews.slice(-200);
  writeFileSync(path, JSON.stringify(trimmed, null, 2), 'utf-8');
}

/** Load review history for dashboard */
export function getReviewHistory(swarmDir: string): ReviewedPR[] {
  return loadReviewHistory(swarmDir);
}
