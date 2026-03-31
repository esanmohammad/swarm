import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { AgentManager } from './agent-manager.js';
import { StateManager } from './state.js';
import type { SwarmConfig, StageName, TechStack, PlaywrightConfig, MaydayState } from '../types.js';
import { STAGE_ARTIFACT_MAP } from '../types.js';
import { parse as parseYaml } from 'yaml';

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
  'SYSTEM ENFORCEMENT: Organize into phases: Setup → Foundational (GATE) → User Stories (parallel after gate) → E2E Tests (after stories) → Polish.',
  'SYSTEM ENFORCEMENT: Do NOT write free-form documents. Follow the spec-kit task format exactly.',
].join('\n');

const TESTER_SYSTEM_ENFORCEMENT = [
  'SYSTEM ENFORCEMENT: Your output file MUST be named exactly TESTPLAN.md.',
  'SYSTEM ENFORCEMENT: TESTPLAN.md MUST contain these sections: ## Overview, ## Test Strategy, ## E2E Test Cases, ## Authentication, ## Test Data, ## Acceptance Criteria.',
  'SYSTEM ENFORCEMENT: Every E2E test case MUST have: ID (TC-001), title, user flow steps, expected assertions, and the target test file path under e2e/.',
  'SYSTEM ENFORCEMENT: Do NOT write implementation code. Do NOT modify application source. Only produce TESTPLAN.md.',
  'SYSTEM ENFORCEMENT: If Figma designs are provided, derive visual test cases (layout, responsiveness, component states) from the designs.',
].join('\n');

interface StageOpts {
  stack?: TechStack;
  interactive?: boolean;
  figmaUrl?: string;
  prompt?: string;
}

/** Non-interactive agents (dashboard/headless) need 'auto' permission — they can't prompt the user. */
function headlessPermission(interactive: boolean): 'auto' | undefined {
  return interactive ? undefined : 'auto';
}

export class Pipeline {
  private budgetExceeded = false;

  constructor(
    private agentManager: AgentManager,
    private state: StateManager,
    private config: SwarmConfig,
  ) {
    // Track budget exceeded so we can surface a clear error from waitForAgent rejections
    this.agentManager.on('budget-exceeded', () => {
      this.budgetExceeded = true;
    });
  }

  /**
   * Wraps agentManager.waitForAgent to surface a clear budget error
   * when agents are killed due to budget enforcement.
   */
  private async waitForAgentWithBudgetCheck(agentId: string): Promise<import('../types.js').Agent> {
    try {
      return await this.waitForAgentWithBudgetCheck(agentId);
    } catch (err) {
      if (this.budgetExceeded) {
        const budget = this.config.maxBudgetUsd ?? 0;
        throw new Error(
          `Budget limit of $${budget} exceeded. All agents killed. ` +
          `Use maxBudgetUsd in .swarm/config.yaml to adjust the limit.`
        );
      }
      throw err;
    }
  }

  async runAnalyze(featureRequest: string, opts?: StageOpts): Promise<void> {
    const s = opts?.stack ?? this.config.stack;
    const interactive = opts?.interactive ?? true;

    const figmaUrl = opts?.figmaUrl;
    const promptParts = [
      `Feature request: ${featureRequest}`,
      '',
      '⚠️ CRITICAL CONSTRAINTS — VIOLATION WILL CAUSE PIPELINE FAILURE:',
      '- Your ONLY deliverable is REQUIREMENTS.md. Do NOT create any other file.',
      '- Do NOT write implementation code under ANY circumstances. No source files, no scripts.',
      '- Do NOT design architecture, write specs, or create task breakdowns.',
      ...(interactive
        ? ['- Ask clarifying questions, then write REQUIREMENTS.md.']
        : ['- Do NOT ask clarifying questions. You have all the context needed.',
           '- Proceed DIRECTLY to writing REQUIREMENTS.md based on the information provided.',
           '- Make reasonable assumptions where details are missing — document them in Section 10 (Open Questions).']),
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
    ];

    if (figmaUrl) {
      promptParts.push(
        '',
        `Figma design URL: ${figmaUrl}`,
        'Use Figma MCP tools (get_design_context, get_screenshot) to extract UI details.',
        'Include design insights in Section 5 (UI/UX) and derive E2E scenarios for Section 8 (Testing).',
      );
    }

    const prompt = promptParts.join('\n');

    this.printStageHeader('analyze', s, interactive);

    const agent = await this.agentManager.spawn({
      name: `analyst-${s}`,
      persona: 'analyst',
      stack: s,
      prompt,
      cwd: process.cwd(),
      interactive,
      permissionMode: headlessPermission(interactive),
      disallowedTools: figmaUrl ? undefined : NON_ENGINEER_DISALLOWED_TOOLS,
      appendSystemPrompt: ANALYST_SYSTEM_ENFORCEMENT,
    });

    this.state.updateStage('analyze', { status: 'running' });
    await this.waitForAgentWithBudgetCheck(agent.id);
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
      permissionMode: headlessPermission(interactive),
      disallowedTools: NON_ENGINEER_DISALLOWED_TOOLS,
      appendSystemPrompt: ARCHITECT_SYSTEM_ENFORCEMENT,
    });

    this.state.updateStage('architect', { status: 'running' });
    await this.waitForAgentWithBudgetCheck(agent.id);
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
    const userGuidance = opts?.prompt;
    const prompt = [
      'Read the SPEC.md below and produce TASKS.md.',
      '',
      ...(userGuidance ? [`User guidance: ${userGuidance}`, ''] : []),
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
      '- Phases: Setup → Foundational (GATE) → User Stories (parallel) → E2E Tests (after stories) → Polish.',
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
      permissionMode: headlessPermission(interactive),
      disallowedTools: NON_ENGINEER_DISALLOWED_TOOLS,
      appendSystemPrompt: LEAD_SYSTEM_ENFORCEMENT,
    });

    this.state.updateStage('plan', { status: 'running' });
    await this.waitForAgentWithBudgetCheck(agent.id);
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
        permissionMode: 'auto',
      });

      await this.waitForAgentWithBudgetCheck(agent.id);
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
          permissionMode: 'auto',
        });

        await this.waitForAgentWithBudgetCheck(agent.id);
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
          permissionMode: 'auto',
        });

        // Wait for orchestrator to acknowledge the plan
        await this.waitForAgentWithBudgetCheck(orchestrator.id);
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
                  permissionMode: 'auto',
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
              subEngineers.map((a) => this.waitForAgentWithBudgetCheck(a.id)),
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
        await this.waitForAgentWithBudgetCheck(orchestrator.id);

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

  async runTest(opts: { parallel?: number; stack?: TechStack; figmaUrl?: string; interactive?: boolean } = {}): Promise<void> {
    const s = opts.stack ?? this.config.stack;
    const interactive = opts.interactive ?? false;

    this.state.updateStage('test', { status: 'running' });

    const testplanPath = join(process.cwd(), 'TESTPLAN.md');
    const pwConfig = this.buildPlaywrightContext();
    let testerCost = 0;

    // ── Phase 1: Tester persona → generate TESTPLAN.md (skip if already exists) ──
    if (existsSync(testplanPath)) {
      console.log(chalk.green(`\n[test] TESTPLAN.md already exists — skipping Phase 1, proceeding to test runner.\n`));
    } else {
      console.log(chalk.cyan(`\n[test] Phase 1: Generating test plan...\n`));

      const contextParts: string[] = [];

      // Gather all available artifacts
      const reqPath = join(process.cwd(), 'REQUIREMENTS.md');
      const specPath = join(process.cwd(), 'SPEC.md');
      const tasksPath = join(process.cwd(), 'TASKS.md');

      if (existsSync(reqPath)) {
        contextParts.push('--- REQUIREMENTS.md ---', readFileSync(reqPath, 'utf-8'), '');
      }
      if (existsSync(specPath)) {
        contextParts.push('--- SPEC.md ---', readFileSync(specPath, 'utf-8'), '');
      }
      if (existsSync(tasksPath)) {
        contextParts.push('--- TASKS.md ---', readFileSync(tasksPath, 'utf-8'), '');
      }

      if (contextParts.length === 0) {
        throw new Error('No pipeline artifacts found. Run at least `swarm analyze` first.');
      }

      const testerPromptParts = [
        'Read the pipeline artifacts below and produce TESTPLAN.md — a comprehensive E2E test plan.',
        '',
        '⚠️ CRITICAL CONSTRAINTS — VIOLATION WILL CAUSE PIPELINE FAILURE:',
        '- Your ONLY deliverable is TESTPLAN.md. Do NOT create any other file.',
        '- Do NOT write implementation code — no test files, no scripts, no source changes.',
        '- Do NOT modify existing artifacts (REQUIREMENTS.md, SPEC.md, TASKS.md).',
        '- Once TESTPLAN.md is written, STOP IMMEDIATELY.',
        '',
        '⚠️ FILENAME — The file MUST be named exactly `TESTPLAN.md` in the project root.',
        '',
        '⚠️ OUTPUT FORMAT — TESTPLAN.md MUST follow this structure:',
        '- ## Overview — what is being tested, scope',
        '- ## Test Strategy — approach (Playwright E2E), browsers, environments',
        '- ## Authentication — login method, storageState pattern, global setup needs',
        '- ## Test Data — required fixtures, seed data, mock APIs',
        '- ## E2E Test Cases — each test case with:',
        '  - **ID**: TC-001, TC-002, etc.',
        '  - **Title**: descriptive name',
        '  - **User Story**: which US-n / user flow this covers',
        '  - **Preconditions**: auth required, data needed',
        '  - **Steps**: numbered user actions (navigate, click, fill, etc.)',
        '  - **Expected**: specific assertions (element visible, text matches, URL changes, etc.)',
        '  - **File**: target test file path (e.g. `e2e/user-login.spec.ts`)',
        '- ## Acceptance Criteria — overall pass/fail criteria for the test suite',
        '',
        `Playwright config: testDir=${pwConfig.testDir}`,
      ];

      if (pwConfig.baseUrl) {
        testerPromptParts.push(`Base URL: ${pwConfig.baseUrl}`);
      }
      if (pwConfig.authStorageState) {
        testerPromptParts.push(`Auth storageState path: ${pwConfig.authStorageState}`);
      }

      const figmaUrl = opts.figmaUrl;
      if (figmaUrl) {
        testerPromptParts.push(
          '',
          `Figma design URL: ${figmaUrl}`,
          'Use Figma MCP tools (get_design_context, get_screenshot) to extract UI details.',
          'Derive visual E2E test cases from the designs: verify layout, component states,',
          'responsiveness, and visual accuracy. Reference Figma frames/nodes in test cases.',
        );
      }

      testerPromptParts.push('', '---', '', ...contextParts);

      if (interactive) {
        this.printStageHeader('test', s, true);
      }

      const testerAgent = await this.agentManager.spawn({
        name: `tester-${s}`,
        persona: 'tester',
        stack: s,
        prompt: testerPromptParts.join('\n'),
        cwd: process.cwd(),
        interactive,
        permissionMode: headlessPermission(interactive),
        disallowedTools: opts.figmaUrl ? undefined : NON_ENGINEER_DISALLOWED_TOOLS,
        appendSystemPrompt: TESTER_SYSTEM_ENFORCEMENT,
      });

      await this.waitForAgentWithBudgetCheck(testerAgent.id);
      testerCost = testerAgent.cost.totalUsd;

      if (existsSync(testplanPath)) {
        console.log(chalk.green(`\n[test] Phase 1 complete. TESTPLAN.md created.`));
      } else {
        console.log(chalk.yellow(`\n[test] Phase 1 complete. TESTPLAN.md not found — skipping execution phase.`));
        this.finishStage('test', 'TESTPLAN.md');
        return;
      }
    }

    // ── Phase 2: Engineer → implement and run Playwright tests ──
    console.log(chalk.cyan(`\n[test] Phase 2: Implementing and running E2E tests...\n`));

    const testplan = readFileSync(testplanPath, 'utf-8');
    const runnerPromptParts = [
      'You are a TEST ENGINEER. Implement and run Playwright E2E tests based on TESTPLAN.md.',
      '',
      '⚠️ CRITICAL CONSTRAINTS:',
      '- Do NOT modify application source code. Only create/modify test files.',
      '- If a test fails, fix the TEST, not the application.',
      '- If Playwright is not installed, install it first: `npm init playwright@latest` or `npx playwright install`.',
      '',
      'Your job:',
      '1. Read TESTPLAN.md and implement each test case as a Playwright spec file',
      `2. Place test files in the \`${pwConfig.testDir}/\` directory with \`.spec.ts\` extension`,
      '3. Create playwright.config.ts if it does not exist',
    ];

    if (pwConfig.baseUrl) {
      runnerPromptParts.push(`4. Set baseURL to: ${pwConfig.baseUrl}`);
    }
    if (pwConfig.authStorageState) {
      runnerPromptParts.push(`5. Configure storageState: ${pwConfig.authStorageState}`);
      runnerPromptParts.push('   If storageState file does not exist, create a global setup script that performs login.');
    }
    if (pwConfig.globalSetupScript) {
      runnerPromptParts.push(`6. Use global setup script: ${pwConfig.globalSetupScript}`);
    }

    runnerPromptParts.push(
      '',
      'After implementing all tests:',
      '- Run `npx playwright test` to execute the full suite',
      '- If any test fails, read the error, fix the test, and re-run',
      '- Keep iterating until all tests pass or you have exhausted debugging',
      '- Report final results summary',
      '',
      '---',
      '',
      testplan,
    );

    const runnerAgent = await this.agentManager.spawn({
      name: `test-runner-${s}`,
      persona: 'engineer',
      stack: s,
      prompt: runnerPromptParts.join('\n'),
      cwd: process.cwd(),
      interactive: false,
      permissionMode: 'auto',
    });

    await this.waitForAgentWithBudgetCheck(runnerAgent.id);

    this.finishStage('test', 'TESTPLAN.md');
    console.log(chalk.green(`\n[test] E2E tests complete. Cost: $${(testerCost + runnerAgent.cost.totalUsd).toFixed(4)}`));
  }

  async runFull(featureRequest: string, opts?: StageOpts): Promise<void> {
    const stack = opts?.stack;
    await this.runAnalyze(featureRequest, { stack, interactive: opts?.interactive ?? true, figmaUrl: opts?.figmaUrl });
    await this.runArchitect({ stack, interactive: opts?.interactive ?? true });
    await this.runPlan({ stack, interactive: opts?.interactive ?? true });
    await this.runBuild({ stack });
    await this.runTest({ stack, figmaUrl: opts?.figmaUrl });
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

  private buildPlaywrightContext(): Required<Pick<PlaywrightConfig, 'testDir'>> & PlaywrightConfig {
    const defaults = { testDir: 'e2e' };

    // Check .swarm/playwright.config.yaml
    const configPath = join(process.cwd(), '.swarm', 'playwright.config.yaml');
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf-8');
        const parsed = parseYaml(raw) as PlaywrightConfig | null;
        if (parsed) {
          return { ...defaults, ...parsed };
        }
      } catch {
        // Ignore invalid YAML
      }
    }

    // Check SwarmConfig
    if (this.config.playwright) {
      return { ...defaults, ...this.config.playwright };
    }

    return defaults;
  }

  // ═══════════════════════════════════════════════════════════════════
  // MayDay — autonomous end-to-end pipeline with fix-retest loop
  // ═══════════════════════════════════════════════════════════════════

  async runMayday(featureRequest: string, opts: {
    stack?: TechStack;
    maxIterations?: number;
    figmaUrl?: string;
    parallel?: number;
    model?: string;
    maxFixBudgetUsd?: number | null;
  } = {}): Promise<void> {
    const stack = opts.stack ?? this.config.stack;
    const maxIterations = opts.maxIterations ?? 5;

    // Apply model override for the entire mayday run
    if (opts.model) {
      this.config.model = opts.model;
    }

    const mayday: MaydayState = {
      active: true,
      featureRequest,
      currentStage: 'analyze',
      fixIteration: 0,
      maxFixIterations: maxIterations,
      lastTestOutput: null,
      lastTestPassed: null,
      failureCount: null,
      fixAgentIds: [],
      userMessages: [],
      startedAt: Date.now(),
      pausedAt: null,
      error: null,
      figmaUrl: opts.figmaUrl,
      maxFixBudgetUsd: opts.maxFixBudgetUsd !== undefined ? opts.maxFixBudgetUsd : 15,
    };

    this.state.setMayday(mayday);

    console.log(chalk.red.bold(`\n🚨 MAYDAY — Autonomous pipeline engaged`));
    console.log(chalk.dim(`Feature: ${featureRequest}`));
    console.log(chalk.dim(`Max fix iterations: ${maxIterations}\n`));

    try {
      await this.executeMaydayPipeline(stack, opts.parallel);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.state.updateMayday({ active: false, error: errMsg });
      throw err;
    }
  }

  async resumeMayday(opts: { parallel?: number } = {}): Promise<void> {
    const mayday = this.state.getMayday();
    if (!mayday || !mayday.active) {
      throw new Error('No active MayDay session to resume.');
    }

    const stack = this.state.getState().stack;
    this.state.updateMayday({ pausedAt: null });

    console.log(chalk.red.bold(`\n🚨 MAYDAY — Resuming from ${mayday.currentStage}`));
    if (mayday.currentStage === 'fix-loop') {
      console.log(chalk.dim(`Fix iteration: ${mayday.fixIteration}/${mayday.maxFixIterations}`));
    }
    console.log('');

    try {
      await this.executeMaydayPipeline(stack, opts.parallel);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.state.updateMayday({ active: false, error: errMsg });
      throw err;
    }
  }

  private async executeMaydayPipeline(stack: TechStack, parallel?: number): Promise<void> {
    const mayday = this.state.getMayday()!;
    const stageOpts: StageOpts = { stack, interactive: false, figmaUrl: mayday.figmaUrl };

    // Pipeline stages in order — resume from currentStage
    const stages: StageName[] = ['analyze', 'architect', 'plan', 'build', 'test'];
    const startIdx = stages.indexOf(mayday.currentStage as StageName);

    // Run pipeline stages (or resume from where we left off)
    if (startIdx >= 0) {
      for (let i = startIdx; i < stages.length; i++) {
        const stage = stages[i];

        // Check if mayday was stopped
        if (!this.state.getMayday()?.active) {
          console.log(chalk.yellow(`\n[mayday] Stopped by user.`));
          return;
        }

        // Consume any queued user messages and log them
        const userMsgs = this.state.consumeMaydayMessages();
        if (userMsgs.length > 0) {
          console.log(chalk.magenta(`[mayday] User guidance received: ${userMsgs.join(' | ')}`));
        }

        this.state.updateMayday({ currentStage: stage });
        console.log(chalk.red(`[mayday] ▸ ${stage}`));

        switch (stage) {
          case 'analyze':
            await this.runAnalyze(mayday.featureRequest, stageOpts);
            break;
          case 'architect':
            await this.runArchitect(stageOpts);
            break;
          case 'plan': {
            const guidance = userMsgs.length > 0 ? userMsgs.join('\n') : undefined;
            await this.runPlan({ ...stageOpts, prompt: guidance });
            break;
          }
          case 'build':
            await this.runBuild({ stack, parallel: parallel ?? 3 });
            break;
          case 'test':
            await this.runTest({ stack, figmaUrl: mayday.figmaUrl });
            break;
        }
      }
    }

    // After initial pipeline, enter the fix-retest loop
    await this.maydayFixLoop(stack, parallel);
  }

  private async maydayFixLoop(stack: TechStack, parallel?: number): Promise<void> {
    // Evaluate initial test results
    let testResults = this.evaluateTestResults();
    this.state.updateMayday({
      currentStage: 'fix-loop',
      lastTestPassed: testResults.passed,
      lastTestOutput: testResults.output,
      failureCount: testResults.failureCount,
    });

    if (testResults.passed) {
      console.log(chalk.green.bold(`\n[mayday] ✓ All tests passed on first run!`));
      this.state.updateMayday({ active: false, currentStage: 'complete' });
      return;
    }

    const mayday = this.state.getMayday()!;
    const maxIter = mayday.maxFixIterations;

    for (let iteration = mayday.fixIteration + 1; iteration <= maxIter; iteration++) {
      // Check if stopped
      if (!this.state.getMayday()?.active) {
        console.log(chalk.yellow(`\n[mayday] Stopped by user.`));
        return;
      }

      // Check cumulative cost before each fix iteration
      const totalCost = this.state.getState().totalCost.totalUsd;
      const maxFixBudget = this.state.getMayday()?.maxFixBudgetUsd;
      if (maxFixBudget !== null && maxFixBudget !== undefined && totalCost >= maxFixBudget) {
        console.log(chalk.red.bold(`\n[mayday] Fix budget exhausted ($${totalCost.toFixed(2)} >= $${maxFixBudget}). Stopping.`));
        this.state.updateMayday({ active: false, error: `Fix budget limit reached: $${totalCost.toFixed(2)}` });
        return;
      }

      this.state.updateMayday({ fixIteration: iteration, currentStage: 'fix-loop' });

      console.log(chalk.red(`\n[mayday] Fix iteration ${iteration}/${maxIter} — ${testResults.failureCount} failure(s)`));

      // Consume user messages for guidance
      const userMsgs = this.state.consumeMaydayMessages();

      // Spawn fix engineer
      const fixPrompt = this.buildFixPrompt(testResults, userMsgs);

      const fixAgent = await this.agentManager.spawn({
        name: `fix-engineer-${iteration}`,
        persona: 'engineer',
        stack,
        prompt: fixPrompt,
        cwd: process.cwd(),
        interactive: false,
        permissionMode: 'auto',
      });

      this.state.updateMayday({
        fixAgentIds: [...(this.state.getMayday()?.fixAgentIds ?? []), fixAgent.id],
      });

      await this.waitForAgentWithBudgetCheck(fixAgent.id);
      console.log(chalk.green(`[mayday] Fix engineer done. Cost: $${fixAgent.cost.totalUsd.toFixed(4)}`));

      // Re-run tests (phase 2 only — TESTPLAN.md already exists)
      console.log(chalk.red(`[mayday] Re-running tests...`));
      this.state.updateStage('test', { status: 'pending' });
      await this.runTest({ stack });

      // Evaluate results
      testResults = this.evaluateTestResults();
      this.state.updateMayday({
        lastTestPassed: testResults.passed,
        lastTestOutput: testResults.output,
        failureCount: testResults.failureCount,
      });

      if (testResults.passed) {
        console.log(chalk.green.bold(`\n[mayday] ✓ All tests passed after ${iteration} fix iteration(s)!`));
        this.state.updateMayday({ active: false, currentStage: 'complete' });
        return;
      }
    }

    // Max iterations reached
    console.log(chalk.yellow.bold(`\n[mayday] Max iterations (${maxIter}) reached. ${testResults.failureCount} test(s) still failing.`));
    this.state.updateMayday({
      active: false,
      currentStage: 'complete',
      error: `Max fix iterations reached. ${testResults.failureCount} test(s) still failing.`,
    });
  }

  private buildFixPrompt(testResults: TestEvaluation, userMessages: string[]): string {
    const parts = [
      'You are a BUG FIX ENGINEER. Tests are failing after a build. Fix the bugs.',
      '',
      '## Test Failures (from last run):',
      '```',
      testResults.output?.slice(-3000) ?? 'No test output captured.',
      '```',
      '',
      `Summary: ${testResults.summary}`,
    ];

    if (userMessages.length > 0) {
      parts.push(
        '',
        '## User Guidance:',
        ...userMessages.map((m) => `- ${m}`),
      );
    }

    parts.push(
      '',
      '## Rules:',
      '- Read the failing test files to understand what is expected',
      '- Read the application code to find the bug',
      '- Fix the APPLICATION code (not the tests, unless the test itself is clearly wrong)',
      '- Do NOT break passing tests',
      '- Run `npx playwright test` after fixing to verify your changes',
      '- If you cannot fix a bug, document why in a code comment',
      '- Focus only on the failures. Do not refactor unrelated code.',
    );

    return parts.join('\n');
  }

  private evaluateTestResults(): TestEvaluation {
    // Find the most recent test-runner agent output
    const agents = this.state.getState().agents;
    const testRunner = [...agents]
      .reverse()
      .find((a) => a.name.startsWith('test-runner-'));

    if (!testRunner) {
      return { passed: false, failureCount: null, summary: 'No test runner output found.', output: null };
    }

    const output = testRunner.output;
    return this.parseTestOutput(output);
  }

  private parseTestOutput(output: string): TestEvaluation {
    if (!output) {
      return { passed: false, failureCount: null, summary: 'Empty test output.', output: null };
    }

    // Playwright patterns
    const passedMatch = output.match(/(\d+)\s+passed/);
    const failedMatch = output.match(/(\d+)\s+failed/);

    const passedCount = passedMatch ? parseInt(passedMatch[1], 10) : 0;
    const failedCount = failedMatch ? parseInt(failedMatch[1], 10) : 0;

    // Also check for generic failure indicators
    const hasGenericFail = /(?:FAIL|Error:|✗|AssertionError|expect\(.*\)\.to)/i.test(output);

    const passed = failedCount === 0 && !hasGenericFail && passedCount > 0;

    const summary = passedCount > 0 || failedCount > 0
      ? `${passedCount} passed, ${failedCount} failed`
      : hasGenericFail
        ? 'Test failures detected (non-Playwright output)'
        : 'Could not parse test results';

    // Truncate output for storage
    const truncated = output.length > 5000 ? output.slice(-5000) : output;

    return { passed, failureCount: failedCount || (hasGenericFail ? -1 : 0), summary, output: truncated };
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}

interface TestEvaluation {
  passed: boolean;
  failureCount: number | null;
  summary: string;
  output: string | null;
}
