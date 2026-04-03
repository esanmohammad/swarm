import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';
import { isGhInstalled } from '../core/git.js';
import { triageWorkItems, classifyType, DEFAULT_TRIAGE_CONFIG } from '../core/triage.js';
import type { WorkItem, TriageConfig } from '../core/triage.js';

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export interface InboxState {
  running: boolean;
  paused: boolean;
  label: string;
  pollInterval: number;
  maxConcurrent: number;
  queue: WorkItem[];
  processed: WorkItem[];
  stats: {
    totalProcessed: number;
    successful: number;
    failed: number;
    skipped: number;
    totalCost: number;
    dailyBudget: number;
    dailySpent: number;
  };
  workHours?: { start: string; end: string; timezone: string };
}

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

function getStatePath(swarmDir: string): string {
  return join(swarmDir, 'inbox-state.json');
}

export function loadInboxState(swarmDir: string): InboxState {
  const path = getStatePath(swarmDir);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch { /* fall through */ }
  }
  return {
    running: false,
    paused: false,
    label: 'swarm',
    pollInterval: 10,
    maxConcurrent: 1,
    queue: [],
    processed: [],
    stats: {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      totalCost: 0,
      dailyBudget: 25,
      dailySpent: 0,
    },
  };
}

export function saveInboxState(swarmDir: string, state: InboxState): void {
  const dir = swarmDir;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getStatePath(dir), JSON.stringify(state, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// GitHub polling
// ---------------------------------------------------------------------------

function fetchGitHubIssues(label: string): WorkItem[] {
  try {
    const raw = execSync(
      `gh issue list --label "${label}" --json number,title,body,labels,author,updatedAt --state open --limit 50`,
      { encoding: 'utf-8', timeout: 30000 },
    ).trim();
    const issues: Array<{
      number: number;
      title: string;
      body: string;
      labels: Array<{ name: string }>;
      author: { login: string };
      updatedAt: string;
    }> = JSON.parse(raw || '[]');

    return issues.map((issue) => {
      const labels = issue.labels.map((l) => l.name);
      const partial = { title: issue.title, body: issue.body || '', labels, source: 'github-issue' as const };
      return {
        id: `issue-${issue.number}`,
        source: 'github-issue' as const,
        title: issue.title,
        body: issue.body || '',
        url: '',
        labels,
        author: issue.author?.login,
        createdAt: issue.updatedAt,
        priority: 0,
        type: classifyType(partial),
        status: 'queued' as const,
        confidence: 0,
        estimatedCost: 0,
        estimatedMinutes: 0,
      };
    });
  } catch {
    return [];
  }
}

function fetchGitHubPRs(): WorkItem[] {
  try {
    const raw = execSync(
      'gh pr list --json number,title,body,labels,author,updatedAt,reviewRequests --state open --limit 30',
      { encoding: 'utf-8', timeout: 30000 },
    ).trim();
    const prs: Array<{
      number: number;
      title: string;
      body: string;
      labels: Array<{ name: string }>;
      author: { login: string };
      updatedAt: string;
      reviewRequests: Array<{ login?: string }>;
    }> = JSON.parse(raw || '[]');

    // Only include PRs that have pending review requests
    const withReviews = prs.filter((pr) => pr.reviewRequests && pr.reviewRequests.length > 0);

    return withReviews.map((pr) => {
      const labels = pr.labels.map((l) => l.name);
      return {
        id: `pr-${pr.number}`,
        source: 'github-pr' as const,
        title: pr.title,
        body: pr.body || '',
        url: '',
        labels,
        author: pr.author?.login,
        createdAt: pr.updatedAt,
        priority: 0,
        type: 'review' as const,
        status: 'queued' as const,
        confidence: 0,
        estimatedCost: 0,
        estimatedMinutes: 0,
      };
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Work execution
// ---------------------------------------------------------------------------

async function processWorkItem(
  item: WorkItem,
  swarmDir: string,
  config: import('../types.js').SwarmConfig,
  triageConfig: TriageConfig,
): Promise<void> {
  const { agentManager, cleanup } = createContext(swarmDir, config);
  const cwd = process.cwd();

  item.status = 'running';
  item.startedAt = Date.now();

  try {
    const isHighConfidence = item.confidence >= triageConfig.confidenceThresholds.autoMerge;
    const isMedConfidence = item.confidence >= triageConfig.confidenceThresholds.autoWork;

    let prompt: string;
    if (!isMedConfidence) {
      // Low confidence — research only
      prompt = [
        `You are a research assistant. Analyze this work item and present findings. Do NOT make any code changes.`,
        '',
        `## Work Item: ${item.title}`,
        `Type: ${item.type} | Source: ${item.source} | Confidence: ${item.confidence}%`,
        '',
        item.body.slice(0, 3000),
        '',
        'Provide:',
        '1. Summary of the issue',
        '2. Affected files/areas (if determinable)',
        '3. Suggested approach',
        '4. Estimated effort',
        '5. Risks and unknowns',
      ].join('\n');
    } else {
      // Medium/high confidence — do the work
      prompt = [
        `You are a software engineer. Complete this work item by making the necessary code changes.`,
        '',
        `## Work Item: ${item.title}`,
        `Type: ${item.type} | Source: ${item.source}`,
        '',
        item.body.slice(0, 5000),
        '',
        'Requirements:',
        '- Create a branch named `swarm/inbox-${item.id}`',
        '- Make the necessary changes',
        '- Run tests to verify',
        '- Commit with a descriptive message',
        isHighConfidence
          ? '- If all tests pass, the changes will be auto-merged'
          : '- Create a PR for human review',
      ].join('\n');
    }

    const agent = await agentManager.spawn({
      name: `inbox-${item.id}`,
      persona: 'engineer',
      stack: config.stack,
      prompt,
      model: config.model,
      cwd,
      interactive: false,
      permissionMode: isMedConfidence ? 'auto' : 'plan',
    });

    await agentManager.waitForAgent(agent.id);

    const cost = agent.cost.totalUsd;
    item.result = { cost, duration: Date.now() - (item.startedAt || Date.now()) };

    // If medium+ confidence, try to create a PR
    if (isMedConfidence) {
      try {
        const prResult = execSync(
          `gh pr create --title "[swarm] ${item.title}" --body "Auto-generated by Swarm Inbox from ${item.source} ${item.id}.\n\nConfidence: ${item.confidence}%\nCost: $${cost.toFixed(2)}" --head swarm/inbox-${item.id} 2>&1`,
          { encoding: 'utf-8', cwd },
        ).trim();
        const prUrlMatch = prResult.match(/https:\/\/github\.com\/[^\s]+/);
        if (prUrlMatch) {
          item.result.prUrl = prUrlMatch[0];
        }
      } catch {
        // PR creation may fail if no changes were committed
      }
    }

    item.status = 'done';
  } catch (err) {
    item.status = 'failed';
    item.result = {
      ...item.result,
      error: err instanceof Error ? err.message : String(err),
      duration: Date.now() - (item.startedAt || Date.now()),
    };
  } finally {
    item.completedAt = Date.now();
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function printQueue(state: InboxState): void {
  const { queue, processed, stats } = state;

  console.log(chalk.bold('\nSwarm Inbox'));
  console.log(chalk.dim(`Status: ${state.running ? (state.paused ? 'Paused' : 'Running') : 'Stopped'} | Label: ${state.label} | Interval: ${state.pollInterval}min`));
  console.log(chalk.dim(`Budget: $${stats.dailySpent.toFixed(2)} / $${stats.dailyBudget.toFixed(2)} today\n`));

  if (queue.length === 0 && processed.length === 0) {
    console.log(chalk.dim('  Queue is empty. Use `swarm inbox start` to begin polling or `swarm inbox add <task>` to add items.\n'));
    return;
  }

  if (queue.length > 0) {
    console.log(chalk.cyan(`  Queued (${queue.length}):`));
    for (const item of queue) {
      const priorityBar = '|'.repeat(Math.round(item.priority / 10)).padEnd(10, ' ');
      const statusColor = item.status === 'running' ? chalk.blue : item.status === 'needs-human' ? chalk.yellow : chalk.dim;
      console.log(`    ${chalk.dim(item.id.padEnd(16))} ${statusColor(`[${item.status}]`.padEnd(14))} ${chalk.yellow(priorityBar)} ${item.confidence}% $${item.estimatedCost.toFixed(2).padStart(5)} ${item.title.slice(0, 50)}`);
    }
    console.log();
  }

  if (processed.length > 0) {
    console.log(chalk.dim(`  Processed (last 10 of ${processed.length}):`));
    for (const item of processed.slice(-10)) {
      const statusColor = item.status === 'done' ? chalk.green : item.status === 'failed' ? chalk.red : chalk.yellow;
      const cost = item.result?.cost != null ? `$${item.result.cost.toFixed(2)}` : '-';
      const pr = item.result?.prUrl ? chalk.dim(` → PR`) : '';
      console.log(`    ${chalk.dim(item.id.padEnd(16))} ${statusColor(`[${item.status}]`.padEnd(14))} ${cost.padStart(6)} ${item.title.slice(0, 50)}${pr}`);
    }
    console.log();
  }

  console.log(chalk.dim(`  Stats: ${stats.totalProcessed} processed | ${stats.successful} ok | ${stats.failed} failed | ${stats.skipped} skipped | $${stats.totalCost.toFixed(2)} total cost\n`));
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerInbox(program: Command): void {
  const cmd = program
    .command('inbox')
    .description('Self-directed work queue — aggregates and processes tasks from multiple sources')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }
      const state = loadInboxState(swarmDir);
      printQueue(state);
    });

  // ----- start -----
  cmd
    .command('start')
    .description('Start the inbox daemon')
    .option('-l, --label <label>', 'GitHub label to watch', 'swarm')
    .option('-i, --interval <minutes>', 'Poll interval in minutes', '10')
    .option('-b, --budget <amount>', 'Daily budget in USD', '25')
    .option('--max-concurrent <n>', 'Max concurrent work items', '1')
    .option('-m, --model <model>', 'Model for agents (e.g., sonnet, openai/gpt-4o, ollama/llama3)', 'sonnet')
    .option('--once', 'Run one cycle and exit')
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
      const label = opts.label as string;
      const interval = (parseInt(opts.interval) || 10) * 60000;
      const dailyBudget = parseFloat(opts.budget) || 25;
      const maxConcurrent = parseInt(opts.maxConcurrent) || 1;
      const once = opts.once ?? false;

      const state = loadInboxState(swarmDir);
      state.running = true;
      state.paused = false;
      state.label = label;
      state.pollInterval = parseInt(opts.interval) || 10;
      state.maxConcurrent = maxConcurrent;
      state.stats.dailyBudget = dailyBudget;
      saveInboxState(swarmDir, state);

      const triageConfig: TriageConfig = {
        ...DEFAULT_TRIAGE_CONFIG,
        dailyBudget,
        perItemBudget: Math.min(5, dailyBudget / 3),
      };

      console.log(chalk.bold('\nSwarm Inbox Daemon'));
      console.log(chalk.dim(`Label: ${label} | Interval: ${opts.interval}min | Budget: $${dailyBudget}/day | Concurrent: ${maxConcurrent} | Model: ${config.model}\n`));

      const pollCycle = async () => {
        const currentState = loadInboxState(swarmDir);

        if (currentState.paused) {
          console.log(chalk.dim(`${new Date().toLocaleTimeString()} — Inbox paused, skipping cycle.`));
          return;
        }

        if (currentState.stats.dailySpent >= dailyBudget) {
          console.log(chalk.yellow(`${new Date().toLocaleTimeString()} — Daily budget exhausted ($${currentState.stats.dailySpent.toFixed(2)} / $${dailyBudget}).`));
          return;
        }

        console.log(chalk.cyan(`${new Date().toLocaleTimeString()} — Polling for work items...`));

        // Fetch from sources
        const issues = fetchGitHubIssues(label);
        const prs = fetchGitHubPRs();
        const allItems = [...issues, ...prs];

        // Merge with existing queue (avoid duplicates)
        const existingIds = new Set([
          ...currentState.queue.map((i) => i.id),
          ...currentState.processed.map((i) => i.id),
        ]);
        const newItems = allItems.filter((i) => !existingIds.has(i.id));

        if (newItems.length > 0) {
          console.log(chalk.green(`  Found ${newItems.length} new item(s).`));
        } else {
          console.log(chalk.dim(`  No new items found.`));
        }

        // Triage all queued items (existing + new)
        const combined = [...currentState.queue.filter((i) => i.status === 'queued'), ...newItems];
        const triaged = triageWorkItems(combined, triageConfig);

        // Update queue
        currentState.queue = triaged
          .filter((r) => r.withinBudget)
          .map((r) => r.item);

        // Skip items that don't fit budget
        for (const r of triaged.filter((tr) => !tr.withinBudget)) {
          r.item.status = 'skipped';
          currentState.processed.push(r.item);
          currentState.stats.skipped++;
        }

        saveInboxState(swarmDir, currentState);

        // Process items up to maxConcurrent
        const runnable = currentState.queue.filter((i) => i.status === 'queued');
        const toProcess = runnable.slice(0, maxConcurrent);

        for (const item of toProcess) {
          if (currentState.stats.dailySpent >= dailyBudget) break;

          console.log(chalk.cyan(`  Processing: ${item.title} (${item.type}, confidence: ${item.confidence}%)`));

          if (item.confidence < triageConfig.confidenceThresholds.autoWork) {
            console.log(chalk.yellow(`    Low confidence (${item.confidence}%) — marking for human review.`));
            item.status = 'needs-human';
            saveInboxState(swarmDir, currentState);
            continue;
          }

          await processWorkItem(item, swarmDir, config, triageConfig);

          // Update stats
          currentState.queue = currentState.queue.filter((i) => i.id !== item.id);
          currentState.processed.push(item);
          currentState.stats.totalProcessed++;
          if (item.status === 'done') currentState.stats.successful++;
          if (item.status === 'failed') currentState.stats.failed++;
          if (item.result?.cost) {
            currentState.stats.totalCost += item.result.cost;
            currentState.stats.dailySpent += item.result.cost;
          }

          saveInboxState(swarmDir, currentState);

          const statusIcon = item.status === 'done' ? chalk.green('OK') : chalk.red('FAIL');
          const cost = item.result?.cost != null ? `$${item.result.cost.toFixed(2)}` : '-';
          console.log(`    ${statusIcon} — ${cost}${item.result?.prUrl ? ` → ${item.result.prUrl}` : ''}`);
        }
      };

      await pollCycle();

      if (!once) {
        console.log(chalk.dim(`\nNext poll in ${opts.interval} minutes... (Ctrl+C to stop)\n`));
        const timer = setInterval(pollCycle, interval);
        process.on('SIGINT', () => {
          clearInterval(timer);
          const finalState = loadInboxState(swarmDir);
          finalState.running = false;
          saveInboxState(swarmDir, finalState);
          console.log(chalk.yellow('\nInbox daemon stopped.'));
          process.exit(0);
        });
      } else {
        state.running = false;
        saveInboxState(swarmDir, state);
      }
    });

  // ----- stop -----
  cmd
    .command('stop')
    .description('Stop the inbox daemon')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found.'));
        process.exit(1);
      }
      const state = loadInboxState(swarmDir);
      state.running = false;
      saveInboxState(swarmDir, state);
      console.log(chalk.yellow('Inbox daemon marked as stopped.'));
      console.log(chalk.dim('If the daemon is running in another terminal, press Ctrl+C or: kill $(pgrep -f "swarm inbox")'));
    });

  // ----- pause -----
  cmd
    .command('pause')
    .description('Pause/unpause inbox processing')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found.'));
        process.exit(1);
      }
      const state = loadInboxState(swarmDir);
      state.paused = !state.paused;
      saveInboxState(swarmDir, state);
      console.log(state.paused ? chalk.yellow('Inbox paused.') : chalk.green('Inbox unpaused.'));
    });

  // ----- add -----
  cmd
    .command('add <task>')
    .description('Add a manual work item to the inbox')
    .option('-t, --type <type>', 'Work item type (bug-fix, feature, maintenance, incident, review)', 'feature')
    .option('-p, --priority <n>', 'Priority override (0-100)')
    .action((task: string, opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found.'));
        process.exit(1);
      }

      const state = loadInboxState(swarmDir);
      const id = `manual-${Date.now()}`;
      const item: WorkItem = {
        id,
        source: 'manual',
        title: task,
        body: task,
        labels: [],
        createdAt: new Date().toISOString(),
        priority: opts.priority ? parseInt(opts.priority) : 70,
        type: opts.type as WorkItem['type'],
        status: 'queued',
        confidence: 75,
        estimatedCost: 1,
        estimatedMinutes: 15,
      };
      state.queue.push(item);
      saveInboxState(swarmDir, state);
      console.log(chalk.green(`Added: ${id} — "${task}"`));
    });

  // ----- skip -----
  cmd
    .command('skip <id>')
    .description('Skip a work item')
    .action((id: string) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found.'));
        process.exit(1);
      }

      const state = loadInboxState(swarmDir);
      const idx = state.queue.findIndex((i) => i.id === id);
      if (idx === -1) {
        console.error(chalk.red(`Item "${id}" not found in queue.`));
        process.exit(1);
      }
      const [item] = state.queue.splice(idx, 1);
      item.status = 'skipped';
      state.processed.push(item);
      state.stats.skipped++;
      saveInboxState(swarmDir, state);
      console.log(chalk.yellow(`Skipped: ${id} — "${item.title}"`));
    });

  // ----- prioritize -----
  cmd
    .command('prioritize <id>')
    .description('Bump a work item to the top of the queue')
    .action((id: string) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found.'));
        process.exit(1);
      }

      const state = loadInboxState(swarmDir);
      const idx = state.queue.findIndex((i) => i.id === id);
      if (idx === -1) {
        console.error(chalk.red(`Item "${id}" not found in queue.`));
        process.exit(1);
      }
      const [item] = state.queue.splice(idx, 1);
      item.priority = 100;
      state.queue.unshift(item);
      saveInboxState(swarmDir, state);
      console.log(chalk.green(`Prioritized: ${id} — "${item.title}" moved to top.`));
    });

  // ----- config -----
  cmd
    .command('config')
    .description('Show current triage configuration')
    .action(() => {
      console.log(chalk.bold('\nTriage Configuration (defaults):\n'));
      console.log(chalk.cyan('Source Priority:'));
      for (const [source, score] of Object.entries(DEFAULT_TRIAGE_CONFIG.sourcePriority)) {
        console.log(`  ${source.padEnd(16)} ${chalk.yellow(String(score))}`);
      }
      console.log(chalk.cyan('\nLabel Priority:'));
      for (const [label, score] of Object.entries(DEFAULT_TRIAGE_CONFIG.labelPriority)) {
        console.log(`  ${label.padEnd(16)} ${chalk.yellow(String(score))}`);
      }
      console.log(chalk.cyan('\nConfidence Thresholds:'));
      console.log(`  Auto-merge:    ${chalk.green(String(DEFAULT_TRIAGE_CONFIG.confidenceThresholds.autoMerge))}%`);
      console.log(`  Auto-work:     ${chalk.yellow(String(DEFAULT_TRIAGE_CONFIG.confidenceThresholds.autoWork))}%`);
      console.log(chalk.cyan('\nBudget:'));
      console.log(`  Daily:         $${DEFAULT_TRIAGE_CONFIG.dailyBudget}`);
      console.log(`  Per item:      $${DEFAULT_TRIAGE_CONFIG.perItemBudget}`);
      console.log();
    });
}
