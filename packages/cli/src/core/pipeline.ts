import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { AgentManager } from './agent-manager.js';
import { StateManager } from './state.js';
import type { SwarmConfig, StageName, TechStack } from '../types.js';
import { STAGE_ARTIFACT_MAP } from '../types.js';

// Non-engineer personas: block dangerous tools (Bash, Edit, NotebookEdit)
// They can only use Read, Glob, Grep, Write. Filename is enforced via prompt + system prompt.
const NON_ENGINEER_DISALLOWED_TOOLS = ['Bash', 'Edit', 'NotebookEdit'];

// System-level enforcement appended via --append-system-prompt.
// This is a system instruction that takes highest priority — the agent cannot override it.
const ANALYST_SYSTEM_ENFORCEMENT = [
  'SYSTEM ENFORCEMENT: Your output file MUST be named exactly REQUIREMENTS.md.',
  'SYSTEM ENFORCEMENT: REQUIREMENTS.md MUST contain these sections in order: ## 0. Original Requirement, ## 1. Summary, ## 2. Scope, ## 3. Functional Requirements, ## 4. Data Requirements, ## 5. UI/UX, ## 6. Non-Functional Requirements, ## 7. Integration, ## 8. Testing, ## 9. Rollout, ## 10. Open Questions, ## 11. Change Tracking, ## 12. Appendix.',
  'SYSTEM ENFORCEMENT: Section 3 MUST contain user stories in "As a [user] I want [thing] So that [reason]" format with Given/When/Then acceptance criteria.',
  'SYSTEM ENFORCEMENT: Do NOT write migration plans, decision tables, or free-form documents. Follow the template exactly.',
].join('\n');

const ARCHITECT_SYSTEM_ENFORCEMENT = [
  'SYSTEM ENFORCEMENT: Your output file MUST be named exactly SPEC.md.',
  'SYSTEM ENFORCEMENT: SPEC.md MUST contain these sections: ## Overview, ## Requirements Summary, ## Architecture (with Mermaid diagrams), ## Architecture Decision Records, ## Component/Service Architecture, ## Data Model Design, ## API Specification, ## Performance Strategy, ## Testing Strategy, ## Security, ## Implementation Checklist, ## File Structure, ## Open Questions.',
  'SYSTEM ENFORCEMENT: Include ADR entries (ADR-1, ADR-2, etc.) and Mermaid diagrams. Follow the template exactly.',
].join('\n');

const LEAD_SYSTEM_ENFORCEMENT = [
  'SYSTEM ENFORCEMENT: Your output file MUST be named exactly TASKS.md.',
  'SYSTEM ENFORCEMENT: Every task MUST follow this format: - [ ] T001 [P] [US1] Description — `file/path.ext`',
  'SYSTEM ENFORCEMENT: One task = one file. Every task has [P] if parallelizable, [USn] user story label, AC: acceptance criteria, and an exact file path.',
  'SYSTEM ENFORCEMENT: Organize into phases: Setup → Foundational (GATE) → User Stories (parallel after gate) → Polish.',
  'SYSTEM ENFORCEMENT: Do NOT write free-form documents. Follow the spec-kit task format exactly.',
].join('\n');

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
      '⚠️ CRITICAL CONSTRAINTS — VIOLATION WILL CAUSE PIPELINE FAILURE:',
      '- Your ONLY deliverable is REQUIREMENTS.md. Do NOT create any other file.',
      '- Do NOT write implementation code under ANY circumstances. No source files, no scripts.',
      '- Do NOT design architecture, write specs, or create task breakdowns.',
      '- Ask clarifying questions, then write REQUIREMENTS.md.',
      '- Once REQUIREMENTS.md is written, STOP IMMEDIATELY. Do not proceed to any other stage.',
      '',
      '⚠️ FILENAME — The file MUST be named exactly `REQUIREMENTS.md` in the project root.',
      '- Do NOT add suffixes, prefixes, or descriptions to the filename.',
      '- WRONG: REQUIREMENTS-migration.md, REQUIREMENTS-auth.md, requirements.md',
      '- CORRECT: REQUIREMENTS.md',
      '',
      '⚠️ OUTPUT FORMAT — REQUIREMENTS.md MUST follow the EXACT template from your system prompt:',
      '- Sections 0-12 in order: Original Requirement, Summary, Scope, Functional Requirements,',
      '  Data Requirements, UI/UX, Non-Functional Requirements, Integration, Testing, Rollout,',
      '  Open Questions, Change Tracking, Appendix.',
      '- Every user story MUST have Given/When/Then acceptance criteria.',
      '- Do NOT deviate from the template structure. Do NOT skip sections — write "N/A" if not applicable.',
      '- Do NOT write migration plans, decision tables, or free-form documents.',
      '- This is a REQUIREMENTS document with user stories and acceptance criteria, not a technical plan.',
    ].join('\n');

    this.printStageHeader('analyze', s, interactive);

    const agent = await this.agentManager.spawn({
      name: `analyst-${s}`,
      persona: 'analyst',
      stack: s,
      prompt,
      cwd: process.cwd(),
      interactive,
      disallowedTools: NON_ENGINEER_DISALLOWED_TOOLS,
      appendSystemPrompt: ANALYST_SYSTEM_ENFORCEMENT,
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
      '⚠️ CRITICAL CONSTRAINTS — VIOLATION WILL CAUSE PIPELINE FAILURE:',
      '- Your ONLY deliverable is SPEC.md. Do NOT create any other file.',
      '- Do NOT write implementation code under ANY circumstances. No source files, no scripts.',
      '- Do NOT break work into tasks — that is the Lead\'s job.',
      '- Code snippets in SPEC.md are for illustration only (interfaces, type signatures) — NOT implementation.',
      '- Once SPEC.md is written, STOP IMMEDIATELY. Do not proceed to any other stage.',
      '',
      '⚠️ FILENAME — The file MUST be named exactly `SPEC.md` in the project root.',
      '- Do NOT add suffixes or prefixes to the filename. WRONG: SPEC-auth.md. CORRECT: SPEC.md',
      '',
      '⚠️ OUTPUT FORMAT — SPEC.md MUST follow the EXACT template from your system prompt:',
      '- All required sections: Overview, Requirements Summary, Architecture Diagrams, ADRs,',
      '  Component/Service Architecture, Data Model, API Specification, Performance Strategy,',
      '  Testing Strategy, Security, Implementation Checklist, File Structure, Open Questions.',
      '- Include Mermaid diagrams. Include ADR entries (ADR-1, ADR-2, etc.).',
      '- Do NOT deviate from the template structure. Do NOT skip sections — write "N/A" if not applicable.',
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
      disallowedTools: NON_ENGINEER_DISALLOWED_TOOLS,
      appendSystemPrompt: ARCHITECT_SYSTEM_ENFORCEMENT,
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
      '⚠️ CRITICAL CONSTRAINTS — VIOLATION WILL CAUSE PIPELINE FAILURE:',
      '- Your ONLY deliverable is TASKS.md. Do NOT create any other file.',
      '- Do NOT write implementation code under ANY circumstances. No source files, no scripts.',
      '- Do NOT redesign the architecture — that is the Architect\'s job.',
      '- Once TASKS.md is written, STOP IMMEDIATELY. Do not proceed to any other stage.',
      '',
      '⚠️ FILENAME — The file MUST be named exactly `TASKS.md` in the project root.',
      '- Do NOT add suffixes or prefixes to the filename. WRONG: TASKS-migration.md. CORRECT: TASKS.md',
      '',
      '⚠️ OUTPUT FORMAT — TASKS.md MUST follow the EXACT template from your system prompt:',
      '- One task = one file. Every task touches exactly one file.',
      '- Format: `- [ ] T001 [P] [US1] Description — \\`file/path.ts\\``',
      '- [P] marker on every parallelizable task (different files, no blocking deps).',
      '- Phases: Setup → Foundational (GATE) → User Stories (parallel) → Polish.',
      '- Every task MUST have AC: acceptance criteria and an exact file path.',
      '- Do NOT deviate from the template structure.',
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
      disallowedTools: NON_ENGINEER_DISALLOWED_TOOLS,
      appendSystemPrompt: LEAD_SYSTEM_ENFORCEMENT,
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

    // Single task mode — no orchestrator needed
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
      const allTaskIds = groups.flatMap((g) => g.taskIds);

      // If only 1 task or no parseable groups, run a single engineer
      if (groups.length === 0 || allTaskIds.length <= 1) {
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
        // === Orchestrator pattern ===
        // 1. Spawn orchestrator engineer who plans and tracks sub-engineers
        const orchestratorPrompt = [
          'You are the ORCHESTRATOR ENGINEER. You coordinate parallel sub-engineers working on TASKS.md.',
          '',
          'Your responsibilities:',
          '1. Analyze TASKS.md and confirm the execution plan below',
          '2. You will receive status updates as sub-engineers complete their tasks',
          '3. After ALL sub-engineers finish, do a final integration review:',
          '   - Check for conflicts between parallel implementations',
          '   - Verify shared interfaces/types are consistent',
          '   - Fix any integration issues (imports, type mismatches, missing glue code)',
          '   - Run any available tests or linting',
          '4. Mark tasks as complete in TASKS.md',
          '',
          `Execution plan: ${groups.length} phase(s), max ${maxParallel} parallel engineers`,
          ...groups.map((g, i) => `  Phase ${i + 1}: ${g.name} — tasks: ${g.taskIds.join(', ')}`),
          '',
          'Acknowledge the plan. Sub-engineers will be spawned now. Wait for status updates before reviewing.',
          '',
          '---',
          '',
          tasks,
        ].join('\n');

        console.log(chalk.cyan(`\n[build] Spawning orchestrator engineer...\n`));

        const orchestrator = await this.agentManager.spawn({
          name: 'engineer-orchestrator',
          persona: 'engineer',
          stack: s,
          prompt: orchestratorPrompt,
          cwd: process.cwd(),
          interactive: false,
        });

        // Wait for orchestrator to acknowledge the plan
        await this.agentManager.waitForAgent(orchestrator.id);
        console.log(chalk.green(`[build] Orchestrator ready. Spawning sub-engineers...\n`));

        // 2. Spawn sub-engineers phase by phase
        const completedTasks: Array<{ taskId: string; status: string; cost: string }> = [];
        const failedTasks: Array<{ taskId: string; error: string }> = [];

        for (let i = 0; i < groups.length; i++) {
          const group = groups[i];
          console.log(chalk.cyan(`[build] Phase ${i + 1}/${groups.length}: ${group.name} (${group.taskIds.length} tasks, max ${maxParallel} parallel)\n`));

          const batches = this.chunk(group.taskIds, maxParallel);

          for (const batch of batches) {
            // Spawn batch of sub-engineers
            const subEngineers = await Promise.all(
              batch.map((taskId) =>
                this.agentManager.spawn({
                  name: `engineer-${taskId}`,
                  persona: 'engineer',
                  stack: s,
                  prompt: [
                    `You are a SUB-ENGINEER. Implement ONLY task ${taskId}. Do not touch other tasks.`,
                    `Focus exclusively on ${taskId}. When complete, stop.`,
                    '',
                    'TASKS.md:',
                    tasks,
                  ].join('\n'),
                  cwd: process.cwd(),
                  interactive: false,
                  parentId: orchestrator.id,
                }),
              ),
            );

            // Link children to orchestrator
            for (const sub of subEngineers) {
              this.agentManager.addChild(orchestrator.id, sub.id);
            }

            // Wait for batch to complete
            const results = await Promise.allSettled(
              subEngineers.map((a) => this.agentManager.waitForAgent(a.id)),
            );

            // Collect results
            for (let j = 0; j < results.length; j++) {
              const taskId = batch[j];
              const result = results[j];
              if (result.status === 'fulfilled') {
                completedTasks.push({
                  taskId,
                  status: 'done',
                  cost: `$${result.value.cost.totalUsd.toFixed(4)}`,
                });
                console.log(chalk.green(`  ✓ ${taskId} complete ($${result.value.cost.totalUsd.toFixed(4)})`));
              } else {
                failedTasks.push({ taskId, error: result.reason?.message || 'Unknown error' });
                console.log(chalk.red(`  ✗ ${taskId} failed: ${result.reason?.message}`));
              }
            }
          }

          // Send phase completion update to orchestrator
          const phaseReport = [
            `Phase ${i + 1}/${groups.length} "${group.name}" complete.`,
            `Tasks done: ${completedTasks.filter((t) => group.taskIds.includes(t.taskId)).map((t) => t.taskId).join(', ')}`,
            failedTasks.filter((t) => group.taskIds.includes(t.taskId)).length > 0
              ? `Tasks failed: ${failedTasks.filter((t) => group.taskIds.includes(t.taskId)).map((t) => `${t.taskId}: ${t.error}`).join(', ')}`
              : '',
            i < groups.length - 1
              ? `Next phase: ${groups[i + 1].name} (${groups[i + 1].taskIds.join(', ')})`
              : 'All phases complete. Please do final integration review now.',
          ].filter(Boolean).join('\n');

          await this.agentManager.sendInput(orchestrator.id, phaseReport);

          console.log(chalk.green(`  Phase ${i + 1} complete.\n`));
        }

        // 3. Wait for orchestrator to finish integration review
        console.log(chalk.cyan(`[build] Waiting for orchestrator integration review...\n`));

        // Send final summary if orchestrator is still running
        const finalSummary = [
          'ALL SUB-ENGINEERS COMPLETE. Final summary:',
          `Total tasks: ${allTaskIds.length} | Done: ${completedTasks.length} | Failed: ${failedTasks.length}`,
          '',
          'Completed:',
          ...completedTasks.map((t) => `  ✓ ${t.taskId} (${t.cost})`),
          ...(failedTasks.length > 0 ? [
            '',
            'Failed:',
            ...failedTasks.map((t) => `  ✗ ${t.taskId}: ${t.error}`),
          ] : []),
          '',
          'Now do your final integration review:',
          '1. Check for conflicts between parallel implementations',
          '2. Verify shared interfaces/types are consistent across tasks',
          '3. Fix any integration issues (imports, type mismatches, missing glue code)',
          '4. Run tests/linting if available',
          '5. Update TASKS.md to mark completed tasks',
        ].join('\n');

        await this.agentManager.sendInput(orchestrator.id, finalSummary);
        await this.agentManager.waitForAgent(orchestrator.id);

        console.log(chalk.green(`[build] Orchestrator integration review complete.`));

        if (failedTasks.length > 0) {
          console.log(chalk.yellow(`\n[build] Warning: ${failedTasks.length} task(s) failed:`));
          for (const t of failedTasks) {
            console.log(chalk.yellow(`  - ${t.taskId}: ${t.error}`));
          }
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

  /**
   * Parse TASKS.md into execution groups. Supports two formats:
   *
   * 1. Spec-kit format (preferred): `- [ ] T001 [P] [US1] description — \`file.ts\``
   *    Tasks with [P] marker are parallelizable. Phases become groups.
   *
   * 2. Legacy format: `## Phase N` / `### Parallel Group` headings with `- [ ] **FND-001** ...`
   */
  private parseTaskGroups(tasksContent: string): Array<{ name: string; taskIds: string[] }> {
    // Detect format: if we find T001-style IDs, use spec-kit parser
    const hasSpecKitFormat = /^-\s+\[\s*\]\s+T\d{3}/m.test(tasksContent);

    if (hasSpecKitFormat) {
      return this.parseSpecKitTasks(tasksContent);
    }
    return this.parseLegacyTasks(tasksContent);
  }

  /**
   * Spec-kit format: phases are sequential gates, tasks with [P] run in parallel.
   * Groups adjacent [P] tasks within each phase into parallel batches.
   */
  private parseSpecKitTasks(content: string): Array<{ name: string; taskIds: string[] }> {
    const groups: Array<{ name: string; taskIds: string[] }> = [];
    let currentPhase = '';
    let parallelBatch: string[] = [];
    let sequentialBatch: string[] = [];

    const flushBatches = () => {
      if (parallelBatch.length > 0) {
        groups.push({ name: `${currentPhase} (parallel)`, taskIds: [...parallelBatch] });
        parallelBatch = [];
      }
      if (sequentialBatch.length > 0) {
        // Sequential tasks become individual groups of 1 (run one at a time)
        for (const id of sequentialBatch) {
          groups.push({ name: `${currentPhase} (sequential)`, taskIds: [id] });
        }
        sequentialBatch = [];
      }
    };

    for (const line of content.split('\n')) {
      // Detect phase headings
      const phaseMatch = line.match(/^#{2,3}\s+(?:Phase\s+\d+[:\s]*)?(.+)/i);
      if (phaseMatch) {
        flushBatches();
        currentPhase = phaseMatch[1].trim();
        continue;
      }

      // Match spec-kit task: - [ ] T001 [P] [US1] description
      const taskMatch = line.match(/^-\s+\[\s*\]\s+(T\d{3})\s*/);
      if (taskMatch) {
        const taskId = taskMatch[1];
        const isParallel = /\[P\]/.test(line);

        if (isParallel) {
          // Flush any pending sequential before starting parallel
          if (sequentialBatch.length > 0) {
            for (const id of sequentialBatch) {
              groups.push({ name: `${currentPhase} (sequential)`, taskIds: [id] });
            }
            sequentialBatch = [];
          }
          parallelBatch.push(taskId);
        } else {
          // Flush any pending parallel before starting sequential
          if (parallelBatch.length > 0) {
            groups.push({ name: `${currentPhase} (parallel)`, taskIds: [...parallelBatch] });
            parallelBatch = [];
          }
          sequentialBatch.push(taskId);
        }
        continue;
      }

      // Also match legacy FND-001 style within spec-kit files
      const legacyMatch = line.match(/^-\s+\[\s*\]\s+\**([A-Z]{2,4}-\d{3})\**/);
      if (legacyMatch) {
        const taskId = legacyMatch[1];
        const isParallel = /\[P\]/.test(line);
        if (isParallel) {
          parallelBatch.push(taskId);
        } else {
          sequentialBatch.push(taskId);
        }
      }
    }

    flushBatches();
    return groups;
  }

  /** Legacy format: ## Phase headings with ### Parallel Group sub-headings */
  private parseLegacyTasks(content: string): Array<{ name: string; taskIds: string[] }> {
    const groups: Array<{ name: string; taskIds: string[] }> = [];
    let currentGroup: { name: string; taskIds: string[] } | null = null;

    for (const line of content.split('\n')) {
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
