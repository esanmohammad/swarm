import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import { createContext } from './shared.js';
import type { SwarmConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Workstream {
  id: string;
  name: string;
  tasks: string[];
  branch: string;
  worktreePath?: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'merging';
  cost: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  prUrl?: string;
  dependsOn: string[];
}

interface DelegateState {
  featureRequest: string;
  workstreams: Workstream[];
  totalBudget: number;
  totalCost: number;
  status: 'decomposing' | 'running' | 'merging' | 'done' | 'failed';
  startedAt: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATE_FILE = 'delegate-state.json';

function statePath(swarmDir: string): string {
  return join(swarmDir, STATE_FILE);
}

function loadDelegateState(swarmDir: string): DelegateState | null {
  const p = statePath(swarmDir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as DelegateState;
  } catch {
    return null;
  }
}

function saveDelegateState(swarmDir: string, state: DelegateState): void {
  writeFileSync(statePath(swarmDir), JSON.stringify(state, null, 2));
}

function gitExec(cmd: string, cwd?: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Git command failed: ${cmd}\n${message}`);
  }
}

function currentBranch(cwd?: string): string {
  return gitExec('git rev-parse --abbrev-ref HEAD', cwd);
}

/**
 * Parse TASKS.md into parallel workstream groups.
 * Groups are separated by "---" lines or tasks prefixed with [P] markers.
 * Each group becomes a workstream.
 */
function parseTaskGroups(tasksContent: string): Array<{ name: string; tasks: string[]; dependsOn: string[] }> {
  const lines = tasksContent.split('\n');
  const groups: Array<{ name: string; tasks: string[]; dependsOn: string[] }> = [];
  let currentGroup: { name: string; tasks: string[]; dependsOn: string[] } | null = null;
  let groupIndex = 0;

  for (const line of lines) {
    // Group separator
    if (/^---+\s*$/.test(line)) {
      if (currentGroup && currentGroup.tasks.length > 0) {
        groups.push(currentGroup);
      }
      groupIndex++;
      currentGroup = null;
      continue;
    }

    // Task line: matches "- [ ] FND-001: Description" or "[P] FND-001: Description"
    const taskMatch = line.match(/^(?:\s*-\s*\[[ x]\]\s*)?(?:\[P\]\s*)?([A-Z]+-\d+)\s*[:\-]\s*(.+)/);
    if (taskMatch) {
      const taskId = taskMatch[1];
      const taskDesc = taskMatch[2].trim();

      if (!currentGroup) {
        currentGroup = {
          name: `workstream-${groupIndex}`,
          tasks: [],
          dependsOn: groupIndex > 0 ? [`workstream-${groupIndex - 1}`] : [],
        };
      }
      currentGroup.tasks.push(`${taskId}: ${taskDesc}`);
    }

    // Named group header: "## Group: Feature Setup" or "### Parallel Group: API"
    const headerMatch = line.match(/^#{2,4}\s*(?:Parallel\s+)?Group\s*[:\-]\s*(.+)/i);
    if (headerMatch) {
      if (currentGroup && currentGroup.tasks.length > 0) {
        groups.push(currentGroup);
      }
      groupIndex = groups.length;
      const name = headerMatch[1].trim().toLowerCase().replace(/\s+/g, '-');
      currentGroup = {
        name,
        tasks: [],
        dependsOn: groupIndex > 0 ? [groups[groupIndex - 1]?.name ?? `workstream-${groupIndex - 1}`] : [],
      };
    }
  }

  // Push the last group
  if (currentGroup && currentGroup.tasks.length > 0) {
    groups.push(currentGroup);
  }

  // Fallback: if no groups found, create a single workstream
  if (groups.length === 0) {
    const allTasks: string[] = [];
    for (const line of lines) {
      const m = line.match(/^(?:\s*-\s*\[[ x]\]\s*)?([A-Z]+-\d+)\s*[:\-]\s*(.+)/);
      if (m) allTasks.push(`${m[1]}: ${m[2].trim()}`);
    }
    if (allTasks.length > 0) {
      groups.push({ name: 'workstream-0', tasks: allTasks, dependsOn: [] });
    }
  }

  return groups;
}

function formatDuration(startMs: number, endMs?: number): string {
  const elapsed = (endMs ?? Date.now()) - startMs;
  const mins = Math.floor(elapsed / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerDelegate(program: Command): void {
  const delegate = program
    .command('delegate')
    .description('Multi-agent task decomposition with parallel workstreams');

  // --- main command: decompose and run ---
  delegate
    .argument('[feature]', 'Large feature request to decompose')
    .option('--max-parallel <n>', 'Maximum parallel workstreams', '3')
    .option('--budget <amount>', 'Total budget in USD', '50')
    .option('--dry-run', 'Decompose only, do not execute workstreams')
    .action(async (feature: string | undefined, opts: { maxParallel: string; budget: string; dryRun?: boolean }) => {
      if (!feature) {
        console.log(chalk.yellow('Usage: swarm delegate "<feature request>" [--max-parallel <n>] [--budget <amount>] [--dry-run]'));
        return;
      }

      const swarmDir = requireSwarmDir();
      const config = loadConfig();
      const ctx = createContext(swarmDir, config);
      const maxParallel = parseInt(opts.maxParallel) || 3;
      const totalBudget = parseFloat(opts.budget) || 50;

      const delegateState: DelegateState = {
        featureRequest: feature,
        workstreams: [],
        totalBudget,
        totalCost: 0,
        status: 'decomposing',
        startedAt: Date.now(),
      };
      saveDelegateState(swarmDir, delegateState);

      try {
        // ---------------------------------------------------------------
        // Phase 1: Analyst + Architect + Lead — decompose the feature
        // ---------------------------------------------------------------
        console.log(chalk.cyan('\n  Phase 1: Decomposing feature request...\n'));

        // Run analyst stage
        console.log(chalk.dim('  Running analyst...'));
        await ctx.pipeline.runAnalyze(feature, { stack: config.stack, interactive: false });

        // Run architect stage
        console.log(chalk.dim('  Running architect...'));
        await ctx.pipeline.runArchitect({ stack: config.stack, interactive: false });

        // Run lead stage to produce TASKS.md
        console.log(chalk.dim('  Running lead...'));
        await ctx.pipeline.runPlan({ stack: config.stack, interactive: false });

        // Parse TASKS.md for parallel groups
        const tasksPath = join(process.cwd(), 'TASKS.md');
        if (!existsSync(tasksPath)) {
          console.error(chalk.red('  TASKS.md not found after planning stage. Cannot decompose.'));
          delegateState.status = 'failed';
          saveDelegateState(swarmDir, delegateState);
          ctx.cleanup();
          return;
        }

        const tasksContent = readFileSync(tasksPath, 'utf-8');
        const groups = parseTaskGroups(tasksContent);

        if (groups.length === 0) {
          console.error(chalk.red('  No task groups found in TASKS.md.'));
          delegateState.status = 'failed';
          saveDelegateState(swarmDir, delegateState);
          ctx.cleanup();
          return;
        }

        // Create workstreams from task groups
        const baseBranch = currentBranch();
        const workstreams: Workstream[] = groups.map((g, i) => ({
          id: `ws-${i}`,
          name: g.name,
          tasks: g.tasks,
          branch: `delegate/${g.name}`,
          status: 'pending' as const,
          cost: 0,
          dependsOn: g.dependsOn,
        }));

        delegateState.workstreams = workstreams;
        saveDelegateState(swarmDir, delegateState);

        console.log(chalk.green(`\n  Decomposed into ${workstreams.length} workstream(s):\n`));
        for (const ws of workstreams) {
          const deps = ws.dependsOn.length > 0 ? chalk.dim(` (depends on: ${ws.dependsOn.join(', ')})`) : '';
          console.log(`  ${chalk.bold(ws.name)}${deps}`);
          for (const t of ws.tasks) {
            console.log(`    ${chalk.dim('•')} ${t}`);
          }
        }

        if (opts.dryRun) {
          console.log(chalk.yellow('\n  --dry-run: stopping before execution.\n'));
          delegateState.status = 'done';
          saveDelegateState(swarmDir, delegateState);
          ctx.cleanup();
          return;
        }

        // ---------------------------------------------------------------
        // Phase 2: Execute workstreams in parallel (respecting maxParallel)
        // ---------------------------------------------------------------
        console.log(chalk.cyan(`\n  Phase 2: Executing workstreams (max ${maxParallel} parallel)...\n`));
        delegateState.status = 'running';
        saveDelegateState(swarmDir, delegateState);

        const completed = new Set<string>();

        while (completed.size < workstreams.length) {
          // Find workstreams that are ready to run
          const runnable = workstreams.filter(
            (ws) =>
              ws.status === 'pending' &&
              ws.dependsOn.every((dep) => {
                const depWs = workstreams.find((w) => w.name === dep || w.id === dep);
                return depWs ? depWs.status === 'done' : true;
              })
          );

          const currentlyRunning = workstreams.filter((ws) => ws.status === 'running').length;
          const slotsAvailable = maxParallel - currentlyRunning;

          if (slotsAvailable <= 0 && runnable.length > 0) {
            // Wait for a running workstream to finish
            await new Promise((resolve) => setTimeout(resolve, 2000));
            continue;
          }

          if (runnable.length === 0 && currentlyRunning === 0) {
            // Check if any pending workstreams have failed dependencies
            const stuck = workstreams.filter((ws) => ws.status === 'pending');
            if (stuck.length > 0) {
              console.log(chalk.yellow('  Some workstreams cannot run due to failed dependencies.'));
              for (const ws of stuck) {
                ws.status = 'failed';
                ws.error = 'Dependency failed';
              }
              saveDelegateState(swarmDir, delegateState);
            }
            break;
          }

          // Launch workstreams up to the limit
          const toLaunch = runnable.slice(0, slotsAvailable);
          const promises = toLaunch.map(async (ws) => {
            ws.status = 'running';
            ws.startedAt = Date.now();
            saveDelegateState(swarmDir, delegateState);

            console.log(chalk.blue(`  Starting workstream: ${ws.name} (branch: ${ws.branch})`));

            try {
              // Create git branch and worktree
              const worktreePath = join(process.cwd(), '.swarm', 'worktrees', ws.name);
              if (!existsSync(join(process.cwd(), '.swarm', 'worktrees'))) {
                mkdirSync(join(process.cwd(), '.swarm', 'worktrees'), { recursive: true });
              }

              gitExec(`git branch ${ws.branch} ${baseBranch} 2>/dev/null || true`);
              gitExec(`git worktree add "${worktreePath}" ${ws.branch}`);
              ws.worktreePath = worktreePath;
              saveDelegateState(swarmDir, delegateState);

              // Build the engineer prompt with the workstream tasks
              const taskList = ws.tasks.map((t) => `- ${t}`).join('\n');
              const engineerPrompt = `Implement the following tasks from the feature request:\n\n${taskList}\n\nContext: ${delegateState.featureRequest}\n\nRefer to REQUIREMENTS.md, SPEC.md, and TASKS.md for full context.`;

              // Run engineer stage in the worktree
              await ctx.pipeline.runBuild({ stack: config.stack });

              ws.status = 'done';
              ws.completedAt = Date.now();
              console.log(chalk.green(`  Workstream ${ws.name} completed (${formatDuration(ws.startedAt!)})`));
            } catch (err: unknown) {
              ws.status = 'failed';
              ws.completedAt = Date.now();
              ws.error = err instanceof Error ? err.message : String(err);
              console.error(chalk.red(`  Workstream ${ws.name} failed: ${ws.error}`));
            }

            // Update cost
            ws.cost = ctx.state.getState().totalCost.totalUsd;
            delegateState.totalCost = workstreams.reduce((sum, w) => sum + w.cost, 0);
            completed.add(ws.id);
            saveDelegateState(swarmDir, delegateState);
          });

          await Promise.all(promises);
        }

        // ---------------------------------------------------------------
        // Phase 3: Merge workstreams
        // ---------------------------------------------------------------
        const doneStreams = workstreams.filter((ws) => ws.status === 'done');
        if (doneStreams.length > 0) {
          console.log(chalk.cyan(`\n  Phase 3: Merging ${doneStreams.length} workstream(s)...\n`));
          delegateState.status = 'merging';
          saveDelegateState(swarmDir, delegateState);

          for (const ws of doneStreams) {
            ws.status = 'merging';
            saveDelegateState(swarmDir, delegateState);

            try {
              console.log(chalk.dim(`  Merging ${ws.branch} into ${baseBranch}...`));
              gitExec(`git checkout ${baseBranch}`);
              gitExec(`git merge ${ws.branch} --no-ff -m "delegate: merge workstream ${ws.name}"`);

              // Run tests after merge
              console.log(chalk.dim(`  Running tests after merging ${ws.name}...`));
              try {
                await ctx.pipeline.runTest({ stack: config.stack });
                console.log(chalk.green(`  Tests passed after merging ${ws.name}`));
              } catch {
                console.log(chalk.yellow(`  Tests failed after merging ${ws.name} — continuing`));
              }

              ws.status = 'done';

              // Clean up worktree
              if (ws.worktreePath) {
                try {
                  gitExec(`git worktree remove "${ws.worktreePath}" --force`);
                } catch {
                  // Worktree cleanup is best-effort
                }
              }
            } catch (err: unknown) {
              ws.status = 'failed';
              ws.error = `Merge conflict: ${err instanceof Error ? err.message : String(err)}`;
              console.error(chalk.red(`  Merge failed for ${ws.name}: ${ws.error}`));
              console.log(chalk.yellow('  Manual conflict resolution required.'));
            }

            saveDelegateState(swarmDir, delegateState);
          }
        }

        // Final status
        const failedCount = workstreams.filter((ws) => ws.status === 'failed').length;
        delegateState.status = failedCount > 0 ? 'failed' : 'done';
        delegateState.totalCost = workstreams.reduce((sum, w) => sum + w.cost, 0);
        saveDelegateState(swarmDir, delegateState);

        console.log('');
        if (delegateState.status === 'done') {
          console.log(chalk.green.bold('  Delegation complete!'));
        } else {
          console.log(chalk.yellow.bold(`  Delegation finished with ${failedCount} failed workstream(s).`));
        }
        console.log(chalk.dim(`  Total cost: $${delegateState.totalCost.toFixed(2)} / $${totalBudget}`));
        console.log(chalk.dim(`  Duration: ${formatDuration(delegateState.startedAt)}\n`));

        ctx.cleanup();
      } catch (err: unknown) {
        delegateState.status = 'failed';
        saveDelegateState(swarmDir, delegateState);
        console.error(chalk.red(`\n  Delegation failed: ${err instanceof Error ? err.message : String(err)}\n`));
        ctx.cleanup();
        process.exit(1);
      }
    });

  // --- status subcommand ---
  delegate
    .command('status')
    .description('Show all parallel workstreams and their status')
    .action(async () => {
      const swarmDir = requireSwarmDir();
      const state = loadDelegateState(swarmDir);

      if (!state) {
        console.log(chalk.yellow('  No delegate session found. Run `swarm delegate "<feature>"` first.'));
        return;
      }

      console.log('');
      console.log(chalk.bold(`  Feature: ${state.featureRequest}`));
      console.log(chalk.dim(`  Status: ${state.status} | Started: ${new Date(state.startedAt).toLocaleString()}`));
      console.log(chalk.dim(`  Budget: $${state.totalCost.toFixed(2)} / $${state.totalBudget}`));
      console.log('');

      if (state.workstreams.length === 0) {
        console.log(chalk.dim('  No workstreams created yet.'));
        return;
      }

      // Status icons
      const icons: Record<string, string> = {
        pending: chalk.dim('○'),
        running: chalk.blue('◉'),
        done: chalk.green('✓'),
        failed: chalk.red('✗'),
        merging: chalk.yellow('⟳'),
      };

      for (const ws of state.workstreams) {
        const icon = icons[ws.status] ?? chalk.dim('?');
        const duration = ws.startedAt ? formatDuration(ws.startedAt, ws.completedAt) : '-';
        const cost = ws.cost > 0 ? `$${ws.cost.toFixed(2)}` : '-';
        const deps = ws.dependsOn.length > 0 ? chalk.dim(` → ${ws.dependsOn.join(', ')}`) : '';

        console.log(`  ${icon} ${chalk.bold(ws.name)} ${chalk.dim(`[${ws.status}]`)} ${chalk.dim(duration)} ${chalk.dim(cost)}${deps}`);

        if (ws.branch) {
          console.log(`    ${chalk.dim('branch:')} ${ws.branch}`);
        }

        for (const t of ws.tasks) {
          console.log(`    ${chalk.dim('•')} ${t}`);
        }

        if (ws.error) {
          console.log(`    ${chalk.red('error:')} ${ws.error}`);
        }

        if (ws.prUrl) {
          console.log(`    ${chalk.cyan('PR:')} ${ws.prUrl}`);
        }

        console.log('');
      }
    });

  // --- merge subcommand ---
  delegate
    .command('merge')
    .description('Trigger merge of completed workstreams')
    .action(async () => {
      const swarmDir = requireSwarmDir();
      const config = loadConfig();
      const ctx = createContext(swarmDir, config);
      const state = loadDelegateState(swarmDir);

      if (!state) {
        console.log(chalk.yellow('  No delegate session found. Run `swarm delegate "<feature>"` first.'));
        ctx.cleanup();
        return;
      }

      const doneStreams = state.workstreams.filter((ws) => ws.status === 'done');

      if (doneStreams.length === 0) {
        console.log(chalk.yellow('  No completed workstreams to merge.'));
        ctx.cleanup();
        return;
      }

      const baseBranch = currentBranch();
      console.log(chalk.cyan(`\n  Merging ${doneStreams.length} workstream(s) into ${baseBranch}...\n`));
      state.status = 'merging';
      saveDelegateState(swarmDir, state);

      for (const ws of doneStreams) {
        ws.status = 'merging';
        saveDelegateState(swarmDir, state);

        try {
          console.log(chalk.dim(`  Merging ${ws.branch}...`));
          gitExec(`git merge ${ws.branch} --no-ff -m "delegate: merge workstream ${ws.name}"`);

          // Run tests after each merge
          console.log(chalk.dim(`  Running tests after merging ${ws.name}...`));
          try {
            await ctx.pipeline.runTest({ stack: config.stack });
            console.log(chalk.green(`  Tests passed after merging ${ws.name}`));
          } catch {
            console.log(chalk.yellow(`  Tests failed after merging ${ws.name} — continuing`));
          }

          ws.status = 'done';

          // Clean up worktree
          if (ws.worktreePath) {
            try {
              gitExec(`git worktree remove "${ws.worktreePath}" --force`);
            } catch {
              // Best-effort cleanup
            }
          }
        } catch (err: unknown) {
          ws.status = 'failed';
          ws.error = `Merge conflict: ${err instanceof Error ? err.message : String(err)}`;
          console.error(chalk.red(`  Merge failed for ${ws.name}: ${ws.error}`));
          console.log(chalk.yellow('  Manual conflict resolution required. Stopping merge.'));
          saveDelegateState(swarmDir, state);
          ctx.cleanup();
          return;
        }

        saveDelegateState(swarmDir, state);
      }

      const failedCount = state.workstreams.filter((ws) => ws.status === 'failed').length;
      state.status = failedCount > 0 ? 'failed' : 'done';
      saveDelegateState(swarmDir, state);

      console.log('');
      if (state.status === 'done') {
        console.log(chalk.green.bold('  All workstreams merged successfully!'));
      } else {
        console.log(chalk.yellow.bold(`  Merge completed with ${failedCount} failure(s).`));
      }
      console.log('');

      ctx.cleanup();
    });
}
