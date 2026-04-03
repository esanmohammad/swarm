import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import type { RoadmapData } from '../types.js';
import { loadConfig, requireSwarmDir } from '../core/config.js';
import { createContext } from './shared.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roadmapPath(swarmDir: string): string {
  return join(swarmDir, 'roadmap.json');
}

function loadRoadmap(swarmDir: string): RoadmapData | null {
  const p = roadmapPath(swarmDir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as RoadmapData;
  } catch {
    return null;
  }
}

function saveRoadmap(swarmDir: string, data: RoadmapData): void {
  if (!existsSync(swarmDir)) mkdirSync(swarmDir, { recursive: true });
  writeFileSync(roadmapPath(swarmDir), JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Compute the critical path through phases using their dependency graph.
 * Returns an ordered list of phase IDs on the longest weighted path.
 */
function computeCriticalPath(phases: RoadmapData['phases']): string[] {
  const byId = new Map(phases.map((p) => [p.id, p]));
  const memo = new Map<string, { cost: number; path: string[] }>();

  function longest(id: string): { cost: number; path: string[] } {
    if (memo.has(id)) return memo.get(id)!;
    const phase = byId.get(id);
    if (!phase) {
      memo.set(id, { cost: 0, path: [] });
      return memo.get(id)!;
    }
    let best = { cost: 0, path: [] as string[] };
    for (const dep of phase.dependencies) {
      const sub = longest(dep);
      if (sub.cost > best.cost) best = sub;
    }
    const result = { cost: best.cost + phase.estimatedWeeks, path: [...best.path, id] };
    memo.set(id, result);
    return result;
  }

  let criticalPath: { cost: number; path: string[] } = { cost: 0, path: [] };
  for (const phase of phases) {
    const candidate = longest(phase.id);
    if (candidate.cost > criticalPath.cost) criticalPath = candidate;
  }
  return criticalPath.path;
}

/**
 * Generate ROADMAP.md content from structured data.
 */
function generateRoadmapMd(data: RoadmapData): string {
  const lines: string[] = [];
  lines.push(`# Roadmap`, '');
  lines.push(`**Goal:** ${data.goal}`, '');
  lines.push(`**Status:** ${data.status} | **Est. total:** ${data.estimatedTotalWeeks} weeks`, '');

  // Timeline (Gantt-style ASCII)
  lines.push('## Timeline', '');
  let weekOffset = 0;
  const schedule: Array<{ id: string; name: string; start: number; end: number }> = [];
  const ordered = topologicalSort(data.phases);
  for (const phase of ordered) {
    const depEnd = phase.dependencies
      .map((d) => schedule.find((s) => s.id === d)?.end ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    const start = Math.max(weekOffset, depEnd);
    schedule.push({ id: phase.id, name: phase.name, start, end: start + phase.estimatedWeeks });
    weekOffset = start; // allow parallel where deps allow
  }
  const maxWeek = schedule.reduce((m, s) => Math.max(m, s.end), 0);
  const colWidth = Math.max(1, Math.min(2, Math.floor(60 / (maxWeek || 1))));

  lines.push('```');
  const header = 'Phase'.padEnd(20) + Array.from({ length: maxWeek }, (_, i) => `W${i + 1}`.padEnd(colWidth)).join('');
  lines.push(header);
  lines.push('-'.repeat(header.length));
  for (const s of schedule) {
    const bar = Array.from({ length: maxWeek }, (_, i) => (i >= s.start && i < s.end ? '#' : ' ').padEnd(colWidth)).join('');
    const label = s.name.length > 18 ? s.name.slice(0, 17) + '~' : s.name;
    lines.push(label.padEnd(20) + bar);
  }
  lines.push('```', '');

  // Critical path
  lines.push('## Critical Path', '');
  lines.push(data.criticalPath.map((id) => `\`${id}\``).join(' -> '), '');

  // Phases detail
  lines.push('## Phases', '');
  for (const phase of data.phases) {
    const statusIcon =
      phase.status === 'done' ? '[x]' : phase.status === 'in-progress' ? '[~]' : phase.status === 'blocked' ? '[!]' : '[ ]';
    lines.push(`### ${statusIcon} ${phase.id}: ${phase.name}`, '');
    lines.push(phase.description, '');
    lines.push(`- **Status:** ${phase.status} (${phase.progress}%)`);
    lines.push(`- **Estimated effort:** ${phase.estimatedWeeks} weeks${phase.actualWeeks != null ? ` (actual: ${phase.actualWeeks})` : ''}`);
    lines.push(`- **Risk:** ${phase.riskLevel}`);
    lines.push(`- **Dependencies:** ${phase.dependencies.length ? phase.dependencies.join(', ') : 'none'}`);
    lines.push(`- **Rollback:** ${phase.rollbackStrategy}`);
    lines.push(`- **Success metrics:**`);
    for (const m of phase.successMetrics) {
      lines.push(`  - ${m}`);
    }
    lines.push('');
  }

  // Risks summary
  const highRisk = data.phases.filter((p) => p.riskLevel === 'high');
  if (highRisk.length) {
    lines.push('## High-Risk Phases', '');
    for (const p of highRisk) {
      lines.push(`- **${p.id}** (${p.name}): ${p.rollbackStrategy}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function topologicalSort(phases: RoadmapData['phases']): RoadmapData['phases'] {
  const result: RoadmapData['phases'] = [];
  const visited = new Set<string>();
  const byId = new Map(phases.map((p) => [p.id, p]));

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const phase = byId.get(id);
    if (!phase) return;
    for (const dep of phase.dependencies) visit(dep);
    result.push(phase);
  }

  for (const p of phases) visit(p.id);
  return result;
}

function parseRoadmapFromOutput(goal: string, output: string): RoadmapData {
  // Try to extract JSON from agent output (between ```json ... ``` or raw JSON)
  const jsonMatch = output.match(/```json\s*([\s\S]*?)```/) || output.match(/(\{[\s\S]*"phases"[\s\S]*\})/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      // Validate / default-fill
      const phases = (parsed.phases || []).map((p: Record<string, unknown>, i: number) => ({
        id: (p.id as string) || `P-${String(i + 1).padStart(3, '0')}`,
        name: (p.name as string) || `Phase ${i + 1}`,
        description: (p.description as string) || '',
        status: 'pending' as const,
        progress: 0,
        estimatedWeeks: (p.estimatedWeeks as number) || (p.estimated_weeks as number) || 2,
        dependencies: (p.dependencies as string[]) || [],
        riskLevel: (p.riskLevel as 'low' | 'medium' | 'high') || (p.risk_level as 'low' | 'medium' | 'high') || 'medium',
        rollbackStrategy: (p.rollbackStrategy as string) || (p.rollback_strategy as string) || 'Revert commits for this phase',
        successMetrics: (p.successMetrics as string[]) || (p.success_metrics as string[]) || [],
      }));

      const cp = computeCriticalPath(phases);
      const totalWeeks = cp.reduce((sum, id) => {
        const phase = phases.find((ph: { id: string }) => ph.id === id);
        return sum + (phase?.estimatedWeeks ?? 0);
      }, 0);

      return {
        goal,
        phases,
        criticalPath: cp,
        estimatedTotalWeeks: totalWeeks,
        estimatedTotalCost: 0,
        status: 'planning',
      };
    } catch {
      // fall through to fallback
    }
  }

  // Fallback: single-phase plan
  return {
    goal,
    phases: [
      {
        id: 'P-001',
        name: 'Implementation',
        description: output.slice(0, 500),
        status: 'pending',
        progress: 0,
        estimatedWeeks: 4,
        dependencies: [],
        riskLevel: 'medium',
        rollbackStrategy: 'Revert all commits from this phase',
        successMetrics: ['Goal achieved'],
      },
    ],
    criticalPath: ['P-001'],
    estimatedTotalWeeks: 4,
    estimatedTotalCost: 0,
    status: 'planning',
  };
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerRoadmap(program: Command): void {
  const cmd = program
    .command('roadmap')
    .description('Long-term project planning — generate, review, adjust, and execute multi-phase roadmaps');

  // Default action: generate roadmap from a goal
  cmd
    .argument('[goal]', 'High-level goal to plan a roadmap for')
    .option('-m, --model <model>', 'Model override')
    .action(async (goal: string | undefined, opts) => {
      if (!goal) {
        cmd.help();
        return;
      }

      const swarmDir = requireSwarmDir();
      const config = loadConfig();
      if (opts.model) config.model = opts.model;

      const { agentManager, cleanup } = createContext(swarmDir, config);
      const spinner = ora('Generating roadmap...').start();

      try {
        const prompt = [
          'You are a strategic project planner. Analyze the codebase and create a detailed multi-phase roadmap.',
          '',
          `Goal: ${goal}`,
          '',
          'Instructions:',
          '1. Read and explore the codebase to understand its current state.',
          '2. Break the goal into sequential phases (3-8 phases typically).',
          '3. For each phase identify: files affected, dependencies on other phases, risk level, estimated effort in weeks, and rollback strategy.',
          '4. Output your plan as a JSON object with this exact structure:',
          '```json',
          '{',
          '  "phases": [',
          '    {',
          '      "id": "P-001",',
          '      "name": "Phase name",',
          '      "description": "What this phase accomplishes",',
          '      "estimatedWeeks": 2,',
          '      "dependencies": [],',
          '      "riskLevel": "low|medium|high",',
          '      "rollbackStrategy": "How to revert if needed",',
          '      "successMetrics": ["Metric 1", "Metric 2"]',
          '    }',
          '  ]',
          '}',
          '```',
          '5. Use phase IDs (P-001, P-002, ...) in the dependencies array.',
          '6. Be realistic about estimates. Consider testing, review, and integration time.',
          '7. Identify high-risk phases and provide concrete rollback strategies.',
        ].join('\n');

        const agent = await agentManager.spawn({
          name: 'roadmap-planner',
          persona: 'analyst',
          stack: config.stack,
          prompt,
          model: config.model,
          cwd: process.cwd(),
          interactive: false,
          permissionMode: 'auto',
          disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
        });

        await agentManager.waitForAgent(agent.id);

        if (agent.status !== 'done') {
          spinner.fail(`Roadmap generation failed: ${agent.error || 'Unknown error'}`);
          process.exit(1);
        }

        const output = agent.output;
        const roadmap = parseRoadmapFromOutput(goal, output);
        saveRoadmap(swarmDir, roadmap);

        // Write ROADMAP.md
        const mdContent = generateRoadmapMd(roadmap);
        writeFileSync(join(process.cwd(), 'ROADMAP.md'), mdContent, 'utf-8');

        spinner.succeed('Roadmap generated');
        console.log('');
        console.log(chalk.bold(`Goal: ${roadmap.goal}`));
        console.log(chalk.dim(`Phases: ${roadmap.phases.length} | Est. total: ${roadmap.estimatedTotalWeeks} weeks`));
        console.log(chalk.dim(`Critical path: ${roadmap.criticalPath.join(' -> ')}`));
        console.log('');

        for (const phase of roadmap.phases) {
          const risk = phase.riskLevel === 'high' ? chalk.red(phase.riskLevel) : phase.riskLevel === 'medium' ? chalk.yellow(phase.riskLevel) : chalk.green(phase.riskLevel);
          console.log(`  ${chalk.cyan(phase.id)} ${phase.name} ${chalk.dim(`(${phase.estimatedWeeks}w)`)} [${risk}]`);
        }

        console.log('');
        console.log(chalk.dim(`Saved: .swarm/roadmap.json + ROADMAP.md`));
        console.log(chalk.dim(`Cost: $${agent.cost.totalUsd.toFixed(2)}`));
      } catch (err) {
        spinner.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        cleanup();
      }
    });

  // -------------------------------------------------------------------------
  // review — show progress on active roadmap
  // -------------------------------------------------------------------------
  cmd
    .command('review')
    .description('Review progress on the active roadmap')
    .action(async () => {
      const swarmDir = requireSwarmDir();
      const roadmap = loadRoadmap(swarmDir);

      if (!roadmap) {
        console.error(chalk.red('No roadmap found. Run `hivemind roadmap "<goal>"` first.'));
        process.exit(1);
      }

      console.log(chalk.bold(`\nRoadmap: ${roadmap.goal}`));
      console.log(chalk.dim(`Status: ${roadmap.status} | Est. total: ${roadmap.estimatedTotalWeeks} weeks\n`));

      // Progress table
      const colId = 8;
      const colName = 28;
      const colStatus = 14;
      const colProgress = 10;
      const colEst = 8;
      const colRisk = 8;

      const header =
        'ID'.padEnd(colId) +
        'Name'.padEnd(colName) +
        'Status'.padEnd(colStatus) +
        'Progress'.padEnd(colProgress) +
        'Est(w)'.padEnd(colEst) +
        'Risk'.padEnd(colRisk);
      console.log(chalk.bold(header));
      console.log('-'.repeat(header.length));

      for (const phase of roadmap.phases) {
        const statusColor =
          phase.status === 'done' ? chalk.green : phase.status === 'in-progress' ? chalk.yellow : phase.status === 'blocked' ? chalk.red : chalk.dim;
        const riskColor =
          phase.riskLevel === 'high' ? chalk.red : phase.riskLevel === 'medium' ? chalk.yellow : chalk.green;

        const progressBar = `${phase.progress}%`;

        const row =
          chalk.cyan(phase.id.padEnd(colId)) +
          phase.name.slice(0, colName - 2).padEnd(colName) +
          statusColor(phase.status.padEnd(colStatus)) +
          progressBar.padEnd(colProgress) +
          String(phase.estimatedWeeks).padEnd(colEst) +
          riskColor(phase.riskLevel.padEnd(colRisk));
        console.log(row);
      }

      console.log('');
      console.log(chalk.dim(`Critical path: ${roadmap.criticalPath.join(' -> ')}`));

      // Overall progress
      const totalDone = roadmap.phases.filter((p) => p.status === 'done').length;
      const totalInProgress = roadmap.phases.filter((p) => p.status === 'in-progress').length;
      const overallProgress = roadmap.phases.length ? Math.round(roadmap.phases.reduce((s, p) => s + p.progress, 0) / roadmap.phases.length) : 0;
      console.log(chalk.dim(`Overall: ${overallProgress}% | ${totalDone} done, ${totalInProgress} in-progress, ${roadmap.phases.length - totalDone - totalInProgress} remaining`));
      console.log('');
    });

  // -------------------------------------------------------------------------
  // adjust — re-plan remaining phases based on actual progress
  // -------------------------------------------------------------------------
  cmd
    .command('adjust')
    .description('Re-plan remaining phases based on actual progress')
    .option('-m, --model <model>', 'Model override')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const config = loadConfig();
      if (opts.model) config.model = opts.model;

      const roadmap = loadRoadmap(swarmDir);
      if (!roadmap) {
        console.error(chalk.red('No roadmap found. Run `hivemind roadmap "<goal>"` first.'));
        process.exit(1);
      }

      const { agentManager, cleanup } = createContext(swarmDir, config);
      const spinner = ora('Re-evaluating roadmap...').start();

      try {
        const prompt = [
          'You are a project planner reviewing and adjusting an existing roadmap.',
          '',
          `Goal: ${roadmap.goal}`,
          '',
          'Current roadmap state:',
          '```json',
          JSON.stringify(roadmap, null, 2),
          '```',
          '',
          'Instructions:',
          '1. Review the codebase to understand actual progress.',
          '2. For phases marked "done", keep them as-is.',
          '3. For remaining phases, re-estimate effort based on what you see.',
          '4. Add new phases if the scope has grown, or remove phases that are no longer needed.',
          '5. Output the COMPLETE updated roadmap as a JSON object with the same structure.',
          '6. Preserve original phase IDs for existing phases. Use new IDs for any added phases.',
          '7. Update risk levels based on current state.',
        ].join('\n');

        const agent = await agentManager.spawn({
          name: 'roadmap-adjuster',
          persona: 'analyst',
          stack: config.stack,
          prompt,
          model: config.model,
          cwd: process.cwd(),
          interactive: false,
          permissionMode: 'auto',
          disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
        });

        await agentManager.waitForAgent(agent.id);

        if (agent.status !== 'done') {
          spinner.fail(`Roadmap adjustment failed: ${agent.error || 'Unknown error'}`);
          process.exit(1);
        }

        const output = agent.output;
        const updated = parseRoadmapFromOutput(roadmap.goal, output);

        // Preserve status of completed phases from original
        for (const orig of roadmap.phases) {
          if (orig.status === 'done' || orig.status === 'in-progress') {
            const match = updated.phases.find((p) => p.id === orig.id);
            if (match) {
              match.status = orig.status;
              match.progress = orig.progress;
              match.actualWeeks = orig.actualWeeks;
            }
          }
        }

        // Keep original metadata
        updated.startedAt = roadmap.startedAt;
        updated.status = roadmap.status;

        saveRoadmap(swarmDir, updated);

        const mdContent = generateRoadmapMd(updated);
        writeFileSync(join(process.cwd(), 'ROADMAP.md'), mdContent, 'utf-8');

        spinner.succeed('Roadmap adjusted');
        console.log(chalk.dim(`Phases: ${updated.phases.length} | Est. total: ${updated.estimatedTotalWeeks} weeks`));
        console.log(chalk.dim(`Cost: $${agent.cost.totalUsd.toFixed(2)}`));
      } catch (err) {
        spinner.fail(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        cleanup();
      }
    });

  // -------------------------------------------------------------------------
  // execute <phase> — start executing a specific phase
  // -------------------------------------------------------------------------
  cmd
    .command('execute <phase>')
    .description('Mark a phase as in-progress and create inbox items for it')
    .action(async (phaseId: string) => {
      const swarmDir = requireSwarmDir();
      const roadmap = loadRoadmap(swarmDir);

      if (!roadmap) {
        console.error(chalk.red('No roadmap found. Run `hivemind roadmap "<goal>"` first.'));
        process.exit(1);
      }

      const phase = roadmap.phases.find((p) => p.id === phaseId);
      if (!phase) {
        console.error(chalk.red(`Phase "${phaseId}" not found. Available: ${roadmap.phases.map((p) => p.id).join(', ')}`));
        process.exit(1);
      }

      // Check dependencies are satisfied
      const unmetDeps = phase.dependencies.filter((dep) => {
        const depPhase = roadmap.phases.find((p) => p.id === dep);
        return depPhase && depPhase.status !== 'done';
      });

      if (unmetDeps.length > 0) {
        console.error(chalk.red(`Cannot start ${phaseId} — unmet dependencies: ${unmetDeps.join(', ')}`));
        console.error(chalk.dim('Complete those phases first, or use `hivemind roadmap adjust` to re-plan.'));
        process.exit(1);
      }

      if (phase.status === 'done') {
        console.log(chalk.yellow(`Phase ${phaseId} is already done.`));
        return;
      }

      phase.status = 'in-progress';
      if (!roadmap.startedAt) roadmap.startedAt = Date.now();
      roadmap.status = 'executing';

      saveRoadmap(swarmDir, roadmap);

      // Write inbox items if inbox.json exists
      const inboxPath = join(swarmDir, 'inbox.json');
      try {
        const inboxItems: Array<Record<string, unknown>> = existsSync(inboxPath)
          ? JSON.parse(readFileSync(inboxPath, 'utf-8'))
          : [];

        inboxItems.push({
          id: `roadmap-${phaseId}`,
          type: 'roadmap-phase',
          title: `[Roadmap] ${phase.name}`,
          description: phase.description,
          priority: phase.riskLevel === 'high' ? 'high' : phase.riskLevel === 'medium' ? 'medium' : 'low',
          status: 'open',
          createdAt: Date.now(),
          metadata: { phaseId, goal: roadmap.goal, successMetrics: phase.successMetrics },
        });

        writeFileSync(inboxPath, JSON.stringify(inboxItems, null, 2), 'utf-8');
        console.log(chalk.green(`Phase ${phaseId} marked as in-progress.`));
        console.log(chalk.dim(`Inbox item created: [Roadmap] ${phase.name}`));
      } catch {
        // If inbox write fails, still proceed — the phase is marked
        console.log(chalk.green(`Phase ${phaseId} marked as in-progress.`));
      }

      // Update ROADMAP.md
      const mdContent = generateRoadmapMd(roadmap);
      writeFileSync(join(process.cwd(), 'ROADMAP.md'), mdContent, 'utf-8');
      console.log(chalk.dim('Updated ROADMAP.md'));
    });
}
