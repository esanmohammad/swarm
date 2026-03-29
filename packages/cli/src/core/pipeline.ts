import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { AgentManager } from './agent-manager.js';
import { StateManager } from './state.js';
import type { SwarmConfig, StageName, TechStack } from '../types.js';
import { STAGE_ARTIFACT_MAP } from '../types.js';

interface StageOpts {
  stack?: TechStack;
  interactive?: boolean;
}

export class Pipeline {
  constructor(
    private agentManager: AgentManager,
    private state: StateManager,
    private config: SwarmConfig,
  ) {}

  async runAnalyze(featureRequest: string, opts?: StageOpts): Promise<void> {
    const s = opts?.stack ?? this.config.stack;
    const interactive = opts?.interactive ?? true;

    const prompt = [
      `Feature request: ${featureRequest}`,
      '',
      'YOUR ROLE: You are the ANALYST. Your ONLY job is to clarify requirements and produce REQUIREMENTS.md.',
      'STRICT BOUNDARIES:',
      '- Ask clarifying questions to remove ambiguity',
      '- Write REQUIREMENTS.md with functional/non-functional requirements, scope, and constraints',
      '- DO NOT design architecture, write specs, create tasks, or write ANY code',
      '- DO NOT create or modify any files other than REQUIREMENTS.md',
      '- Once REQUIREMENTS.md is complete, STOP',
    ].join('\n');

    this.printStageHeader('analyze', s, interactive);

    const agent = await this.agentManager.spawn({
      name: `analyst-${s}`,
      persona: 'analyst',
      stack: s,
      prompt,
      cwd: process.cwd(),
      interactive,
    });

    this.state.updateStage('analyze', { status: 'running' });
    await this.agentManager.waitForAgent(agent.id);
    this.finishStage('analyze', 'REQUIREMENTS.md');
  }

  async runArchitect(opts?: StageOpts): Promise<void> {
    const s = opts?.stack ?? this.config.stack;
    const interactive = opts?.interactive ?? true;
    const reqPath = join(process.cwd(), 'REQUIREMENTS.md');

    if (!existsSync(reqPath)) {
      throw new Error('REQUIREMENTS.md not found. Run `swarm analyze` first.');
    }

    const requirements = readFileSync(reqPath, 'utf-8');
    const prompt = [
      'Read the REQUIREMENTS.md below and produce SPEC.md.',
      '',
      'YOUR ROLE: You are the ARCHITECT. Your ONLY job is to design the technical architecture and produce SPEC.md.',
      'STRICT BOUNDARIES:',
      '- Produce SPEC.md with: architecture decisions (ADRs), component design, API contracts, data models, diagrams',
      '- You may ask clarifying questions about requirements',
      '- DO NOT break work into tasks — that is the Lead\'s job',
      '- DO NOT write ANY implementation code — that is the Engineer\'s job',
      '- DO NOT create or modify any files other than SPEC.md',
      '- Once SPEC.md is complete, STOP',
      '',
      '---',
      '',
      requirements,
    ].join('\n');

    this.printStageHeader('architect', s, interactive);

    const agent = await this.agentManager.spawn({
      name: `architect-${s}`,
      persona: 'architect',
      stack: s,
      prompt,
      cwd: process.cwd(),
      interactive,
    });

    this.state.updateStage('architect', { status: 'running' });
    await this.agentManager.waitForAgent(agent.id);
    this.finishStage('architect', 'SPEC.md');
  }

  async runPlan(opts?: StageOpts): Promise<void> {
    const s = opts?.stack ?? this.config.stack;
    const interactive = opts?.interactive ?? true;
    const specPath = join(process.cwd(), 'SPEC.md');

    if (!existsSync(specPath)) {
      throw new Error('SPEC.md not found. Run `swarm architect` first.');
    }

    const spec = readFileSync(specPath, 'utf-8');
    const prompt = [
      'Read the SPEC.md below and produce TASKS.md.',
      '',
      'YOUR ROLE: You are the LEAD. Your ONLY job is to break the spec into atomic, parallelizable tasks and produce TASKS.md.',
      'STRICT BOUNDARIES:',
      '- Produce TASKS.md with task IDs (FND-001, SVC-001, etc.), dependencies, acceptance criteria, and parallel groups',
      '- You may ask clarifying questions about the architecture',
      '- DO NOT write ANY implementation code — that is the Engineer\'s job',
      '- DO NOT redesign the architecture — that is the Architect\'s job',
      '- DO NOT create or modify any files other than TASKS.md',
      '- Once TASKS.md is complete, STOP',
      '',
      '---',
      '',
      spec,
    ].join('\n');

    this.printStageHeader('plan', s, interactive);

    const agent = await this.agentManager.spawn({
      name: `lead-${s}`,
      persona: 'lead',
      stack: s,
      prompt,
      cwd: process.cwd(),
      interactive,
    });

    this.state.updateStage('plan', { status: 'running' });
    await this.agentManager.waitForAgent(agent.id);
    this.finishStage('plan', 'TASKS.md');
  }

  async runBuild(opts: { parallel?: number; taskId?: string; stack?: TechStack } = {}): Promise<void> {
    const s = opts.stack ?? this.config.stack;
    const tasksPath = join(process.cwd(), 'TASKS.md');

    if (!existsSync(tasksPath)) {
      throw new Error('TASKS.md not found. Run `swarm plan` first.');
    }

    const tasks = readFileSync(tasksPath, 'utf-8');
    const maxParallel = opts.parallel ?? 3;

    this.state.updateStage('build', { status: 'running' });

    if (opts.taskId) {
      const prompt = `Read TASKS.md and implement ONLY task ${opts.taskId}. Mark it complete when done.\n\nTASKS.md:\n${tasks}`;
      console.log(chalk.cyan(`\n[build] Running task ${opts.taskId}...\n`));

      const agent = await this.agentManager.spawn({
        name: `engineer-${opts.taskId}`,
        persona: 'engineer',
        stack: s,
        prompt,
        cwd: process.cwd(),
        interactive: false,
      });

      await this.agentManager.waitForAgent(agent.id);
      console.log(chalk.green(`\n[build] Task ${opts.taskId} complete. Cost: $${agent.cost.totalUsd.toFixed(4)}`));
    } else {
      const groups = this.parseTaskGroups(tasks);

      if (groups.length === 0) {
        const prompt = `Read TASKS.md and implement all pending tasks. Mark each complete when done.\n\nTASKS.md:\n${tasks}`;
        console.log(chalk.cyan(`\n[build] Running all tasks with single engineer...\n`));

        const agent = await this.agentManager.spawn({
          name: `engineer-${s}`,
          persona: 'engineer',
          stack: s,
          prompt,
          cwd: process.cwd(),
          interactive: false,
        });

        await this.agentManager.waitForAgent(agent.id);
        console.log(chalk.green(`\n[build] Complete. Cost: $${agent.cost.totalUsd.toFixed(4)}`));
      } else {
        for (let i = 0; i < groups.length; i++) {
          const group = groups[i];
          console.log(chalk.cyan(`\n[build] Phase ${i + 1}/${groups.length}: ${group.name} (${group.taskIds.length} tasks, max ${maxParallel} parallel)\n`));

          const batches = this.chunk(group.taskIds, maxParallel);

          for (const batch of batches) {
            const agents = await Promise.all(
              batch.map((taskId) =>
                this.agentManager.spawn({
                  name: `engineer-${taskId}`,
                  persona: 'engineer',
                  stack: s,
                  prompt: `Read TASKS.md and implement task ${taskId}. Mark it complete when done.\n\nTASKS.md:\n${tasks}`,
                  cwd: process.cwd(),
                  interactive: false,
                }),
              ),
            );

            await Promise.allSettled(
              agents.map((a) => this.agentManager.waitForAgent(a.id)),
            );
          }

          console.log(chalk.green(`  Phase ${i + 1} complete.`));
        }
      }
    }

    this.state.updateStage('build', { status: 'done' });
    console.log(chalk.green(`\n[build] All tasks complete.`));
  }

  async runFull(featureRequest: string, opts?: StageOpts): Promise<void> {
    const stack = opts?.stack;
    await this.runAnalyze(featureRequest, { stack, interactive: opts?.interactive ?? true });
    await this.runArchitect({ stack, interactive: opts?.interactive ?? true });
    await this.runPlan({ stack, interactive: opts?.interactive ?? true });
    await this.runBuild({ stack });
  }

  private printStageHeader(stage: string, stack: TechStack, interactive: boolean): void {
    if (interactive) {
      console.log(chalk.cyan(`\n[${stage}] Starting interactive session (${stack})...`));
      console.log(chalk.dim('You can converse with the agent. It will produce the artifact and exit when done.\n'));
    } else {
      console.log(chalk.cyan(`\n[${stage}] Starting agent (${stack})...\n`));
    }
  }

  private finishStage(stage: StageName, expectedArtifact: string): void {
    const artifact = existsSync(join(process.cwd(), expectedArtifact)) ? expectedArtifact : null;
    this.state.updateStage(stage, { status: 'done', artifact });
    if (artifact) {
      console.log(chalk.green(`\n[${stage}] Complete. ${expectedArtifact} created.`));
    } else {
      console.log(chalk.green(`\n[${stage}] Session complete.`));
    }
  }

  private parseTaskGroups(tasksContent: string): Array<{ name: string; taskIds: string[] }> {
    const groups: Array<{ name: string; taskIds: string[] }> = [];
    let currentGroup: { name: string; taskIds: string[] } | null = null;

    for (const line of tasksContent.split('\n')) {
      const groupMatch = line.match(/^#{2,3}\s+(?:Phase\s+\d+[:\s]*|Parallel Group[:\s]*)?(.+)/i);
      if (groupMatch) {
        if (currentGroup && currentGroup.taskIds.length > 0) {
          groups.push(currentGroup);
        }
        currentGroup = { name: groupMatch[1].trim(), taskIds: [] };
        continue;
      }

      const taskMatch = line.match(/^-\s+\[\s*\]\s+\**([A-Z]{2,4}-\d{3})\**/);
      if (taskMatch && currentGroup) {
        currentGroup.taskIds.push(taskMatch[1]);
      }
    }

    if (currentGroup && currentGroup.taskIds.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
