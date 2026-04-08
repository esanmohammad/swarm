import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { v4 as uuid } from 'uuid';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { AgentManager } from './agent-manager.js';
import { StateManager } from './state.js';
import type { SwarmConfig, StageName, TechStack, PlaywrightConfig, MaydayState, TestFrameworkConfig, TestFrameworkKind } from '../types.js';
import { STAGE_ARTIFACT_MAP } from '../types.js';
import { parse as parseYaml } from 'yaml';
import { isGhInstalled, createPR, buildPRBody, getCurrentBranch, hasUncommittedChanges } from './git.js';
import { stageTransitionPause, fixLoopPause, InputListener } from './input-listener.js';
import { WebhookManager } from './webhooks.js';
import type { WebhookConfig } from './webhooks.js';
import { QualityScorer } from './quality.js';
import { GuardrailsEngine } from './guardrails.js';
import { scanCodebase } from './codebase-scanner.js';
import { loadConventions } from '../commands/learn.js';
import { MemoryStore, recordPipelineSuccess, recordPipelineFailure, recordFlakyTest } from './memory-store.js';
import { loadPipelineDefinition, getDefaultPipelineDefinition, stageNameForDefinition } from './pipeline-loader.js';
import type { PipelineDefinition, PipelineStageDefinition } from './pipeline-loader.js';

// Plugin integration point: custom stages from PluginLoader.getCustomStages()
// can be injected into the pipeline by converting CustomStagePlugin entries
// into PipelineStageDefinition objects and merging them based on their
// before/after positioning. The PluginLoader is instantiated in the command
// layer (see commands/plugin.ts) and can be wired here when ready.
// Plugin type used by PluginLoader (see ./plugins.ts)
// import type { CustomStagePlugin } from './plugins.js';

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
  /** When true, skip all interactive pauses (for CI/automation/dashboard) */
  headless?: boolean;
}

/** Non-interactive agents (dashboard/headless) need 'auto' permission — they can't prompt the user. */
function headlessPermission(interactive: boolean): 'auto' | undefined {
  return interactive ? undefined : 'auto';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Default test framework configurations per stack */
const TEST_FRAMEWORKS: Record<string, TestFrameworkConfig> = {
  // Frontend stacks → Playwright E2E + Vitest unit
  'react-e2e': {
    kind: 'playwright', name: 'Playwright', testDir: 'e2e', testFilePattern: '*.spec.ts',
    installCmd: 'npm init playwright@latest -- --quiet',
    runCmd: 'PLAYWRIGHT_JSON_OUTPUT_NAME=.swarm/test-results.json npx playwright test --reporter=json,list',
    runCmdHuman: 'npx playwright test',
    category: 'e2e',
  },
  'react-unit': {
    kind: 'vitest', name: 'Vitest', testDir: 'src/__tests__', testFilePattern: '*.test.ts{,x}',
    installCmd: 'npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom',
    runCmd: 'npx vitest run --reporter=json --outputFile=.swarm/test-results.json',
    runCmdHuman: 'npx vitest run',
    category: 'unit',
  },
  // Node backend → Vitest unit/integration
  'node-unit': {
    kind: 'vitest', name: 'Vitest', testDir: 'src/__tests__', testFilePattern: '*.test.ts',
    installCmd: 'npm install -D vitest',
    runCmd: 'npx vitest run --reporter=json --outputFile=.swarm/test-results.json',
    runCmdHuman: 'npx vitest run',
    category: 'integration',
  },
  'node-api': {
    kind: 'vitest', name: 'Vitest + Supertest', testDir: 'test', testFilePattern: '*.test.ts',
    installCmd: 'npm install -D vitest supertest @types/supertest',
    runCmd: 'npx vitest run --reporter=json --outputFile=.swarm/test-results.json',
    runCmdHuman: 'npx vitest run',
    category: 'api',
  },
  // Go → go test
  'go-unit': {
    kind: 'go-test', name: 'go test', testDir: '.', testFilePattern: '*_test.go',
    installCmd: '', // go test is built-in
    runCmd: 'go test -json ./... > .swarm/test-results.json 2>&1',
    runCmdHuman: 'go test -v ./...',
    category: 'unit',
  },
  // Python → pytest
  'python-unit': {
    kind: 'pytest', name: 'pytest', testDir: 'tests', testFilePattern: 'test_*.py',
    installCmd: 'pip install pytest pytest-json-report',
    runCmd: 'pytest --json-report --json-report-file=.swarm/test-results.json -v',
    runCmdHuman: 'pytest -v',
    category: 'unit',
  },
  // Rust → cargo test
  'rust-unit': {
    kind: 'cargo-test', name: 'cargo test', testDir: 'src', testFilePattern: '*.rs',
    installCmd: '', // built-in
    runCmd: 'cargo test -- -Z unstable-options --format json > .swarm/test-results.json 2>&1 || cargo test 2>&1 | tee .swarm/test-results.txt',
    runCmdHuman: 'cargo test',
    category: 'unit',
  },
  // Swift → swift test
  'swift-unit': {
    kind: 'swift-test', name: 'swift test', testDir: 'Tests', testFilePattern: '*Tests.swift',
    installCmd: '', // built-in
    runCmd: 'swift test 2>&1 | tee .swarm/test-results.txt',
    runCmdHuman: 'swift test',
    category: 'unit',
  },
};

/** Resolve which test frameworks to use for a given stack */
function getTestFrameworks(stack: TechStack): TestFrameworkConfig[] {
  switch (stack) {
    case 'react':
      return [TEST_FRAMEWORKS['react-unit'], TEST_FRAMEWORKS['react-e2e']];
    case 'node':
      return [TEST_FRAMEWORKS['node-unit'], TEST_FRAMEWORKS['node-api']];
    case 'go':
      return [TEST_FRAMEWORKS['go-unit']];
    case 'python':
      return [TEST_FRAMEWORKS['python-unit']];
    case 'rust':
      return [TEST_FRAMEWORKS['rust-unit']];
    case 'swift':
      return [TEST_FRAMEWORKS['swift-unit']];
    case 'custom':
      // Default to vitest for custom stacks
      return [TEST_FRAMEWORKS['node-unit']];
    default:
      return [TEST_FRAMEWORKS['react-e2e']];
  }
}

export class Pipeline {
  private budgetExceeded = false;
  gitEnabled = true;
  autoPR = true;
  private webhooks: WebhookManager;
  private quality: QualityScorer;
  private guardrails: GuardrailsEngine;
  private _codebaseContext: string | null = null;
  private _conventionPrompt: string | null = null;
  private _memoryContext: string | null = null;
  private memoryStore: MemoryStore;

  constructor(
    private agentManager: AgentManager,
    private state: StateManager,
    private config: SwarmConfig,
  ) {
    this.webhooks = new WebhookManager((config.webhooks ?? []) as WebhookConfig[]);
    this.quality = new QualityScorer();
    this.guardrails = new GuardrailsEngine(join(this.state.getProjectCwd(), '.swarm'));
    this.memoryStore = new MemoryStore(join(this.state.getProjectCwd(), '.swarm'));
    // Track budget exceeded so we can surface a clear error from waitForAgent rejections
    this.agentManager.on('budget-exceeded', () => {
      this.budgetExceeded = true;
    });

    // Graceful budget degradation: downgrade models when budget is running low
    const costTracker = agentManager.getCostTracker?.();
    if (costTracker) {
      costTracker.on('budget-warning', (info: { level: number; remaining: number }) => {
        if (info.level >= 90 && this.config.model !== 'haiku') {
          console.log(chalk.yellow(`[budget] 90% budget used — switching all remaining agents to haiku`));
          this.config.model = 'haiku';
          this.config.models = { analyst: 'haiku', architect: 'haiku', lead: 'haiku', engineer: 'haiku', tester: 'haiku' };
        } else if (info.level >= 80 && this.config.model === 'opus') {
          console.log(chalk.yellow(`[budget] 80% budget used — downgrading from opus to sonnet`));
          this.config.model = 'sonnet';
          if (this.config.models?.engineer === 'opus') this.config.models.engineer = 'sonnet';
        }
      });
    }
  }

  /**
   * Get the working directory for the current pipeline.
   * Uses worktree path if available, otherwise falls back to this.projectCwd.
   */
  get projectCwd(): string {
    return this.state.getProjectCwd();
  }

  /** Scan and cache the codebase context for injecting into stage prompts. */
  private getCodebaseContext(): string {
    if (this._codebaseContext === null) {
      this._codebaseContext = scanCodebase(this.projectCwd, this.config.packages);
    }
    return this._codebaseContext;
  }

  /** Load and cache project conventions for injection into all agent system prompts. */
  private getConventionPrompt(): string {
    if (this._conventionPrompt === null) {
      const swarmDir = join(this.projectCwd, '.swarm');
      this._conventionPrompt = loadConventions(swarmDir);
    }
    return this._conventionPrompt;
  }

  /** Load and cache cross-run memory context for injection into agent prompts. */
  private getMemoryContext(tags: string[] = []): string {
    if (this._memoryContext === null) {
      this._memoryContext = this.memoryStore.buildMemoryContext(tags);
    }
    return this._memoryContext;
  }

  /** Build the full appendSystemPrompt for an agent: enforcement rules + conventions + memory. */
  private buildAppendSystemPrompt(enforcement: string): string {
    const parts = [enforcement];
    const conventions = this.getConventionPrompt();
    if (conventions) parts.push(conventions);
    const memory = this.getMemoryContext();
    if (memory) parts.push(memory);
    return parts.join('\n\n');
  }

  /** Get conventions + memory system prompt for engineers (no enforcement rules needed). */
  private getEngineerConventions(): string | undefined {
    const parts: string[] = [
      'SYSTEM ENFORCEMENT: Do NOT write tests, test files, or test code. Do NOT run test commands (vitest, jest, playwright, pytest, etc.). Testing is handled by a separate validation step. Focus exclusively on implementing the feature code.',
    ];
    const conventions = this.getConventionPrompt();
    if (conventions) parts.push(conventions);
    const memory = this.getMemoryContext();
    if (memory) parts.push(memory);
    return parts.join('\n\n');
  }

  /**
   * Wraps agentManager.waitForAgent to surface a clear budget error
   * when agents are killed due to budget enforcement.
   */
  private async waitForAgentWithBudgetCheck(agentId: string): Promise<import('../types.js').Agent> {
    try {
      return await this.agentManager.waitForAgent(agentId);
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

  /** Resolve model for a persona — checks per-persona overrides, then falls back to default */
  private modelFor(persona: import('../types.js').Persona): string {
    return this.config.models?.[persona] ?? this.config.model;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  private createFeatureBranch(featureRequest: string): void {
    if (!this.gitEnabled) return;
    const slug = this.slugify(featureRequest);
    const branch = `swarm/${slug}`;
    try {
      execSync(`git checkout -b ${branch}`, { stdio: 'pipe', cwd: this.projectCwd });
      console.log(chalk.dim(`[git] Created branch: ${branch}`));
    } catch {
      // Branch may already exist — try checking it out
      try {
        execSync(`git checkout ${branch}`, { stdio: 'pipe', cwd: this.projectCwd });
        console.log(chalk.dim(`[git] Switched to existing branch: ${branch}`));
      } catch {
        console.log(chalk.dim(`[git] Could not create/switch branch: ${branch} — continuing on current branch`));
      }
    }
  }

  private autoCommitStage(stage: StageName, _artifact: string | null): void {
    if (!this.gitEnabled) return;
    const messages: Record<StageName, string> = {
      analyze: 'Generated REQUIREMENTS.md',
      architect: 'Generated SPEC.md',
      plan: 'Generated TASKS.md',
      build: 'Built implementation',
      test: 'Generated TESTPLAN.md',
      evaluate: 'Completed evaluation',
      validate: 'Validated build',
      ship: 'Shipped to production',
    };
    const msg = messages[stage] ?? `Completed ${stage}`;
    try {
      execSync('git add -A', { stdio: 'pipe', cwd: this.projectCwd });
      execSync(`git commit -m "[swarm:${stage}] ${msg}"`, { stdio: 'pipe', cwd: this.projectCwd });
      console.log(chalk.dim(`[git] Committed: [swarm:${stage}] ${msg}`));
    } catch {
      // Nothing to commit is OK
    }
  }

  /**
   * Attempt to auto-create a GitHub PR after a successful MayDay run.
   * Failures are logged as warnings — they never crash the pipeline.
   */
  private attemptAutoCreatePR(): void {
    if (!this.autoPR || !this.gitEnabled) return;

    try {
      if (!isGhInstalled()) {
        console.log(chalk.dim('[pr] gh CLI not found — skipping PR creation'));
        return;
      }

      const branch = getCurrentBranch();
      if (branch === 'main' || branch === 'master') {
        console.log(chalk.dim(`[pr] On ${branch} branch — skipping PR creation`));
        return;
      }

      // Auto-commit any remaining uncommitted changes
      if (hasUncommittedChanges()) {
        try {
          execSync('git add -A', { stdio: 'pipe', cwd: this.projectCwd });
          execSync('git commit -m "[swarm] Final changes before PR"', { stdio: 'pipe', cwd: this.projectCwd });
          console.log(chalk.dim('[git] Committed remaining changes'));
        } catch {
          // Nothing to commit or commit failed — continue anyway
        }
      }

      // Push the branch
      try {
        execSync(`git push -u origin ${branch}`, { stdio: 'pipe', cwd: this.projectCwd });
        console.log(chalk.dim(`[git] Pushed branch: ${branch}`));
      } catch {
        console.log(chalk.yellow('[pr] Could not push branch — skipping PR creation'));
        return;
      }

      const pipelineState = this.state.getState();
      const mayday = pipelineState.mayday;
      const featureRequest = mayday?.featureRequest ?? 'Swarm pipeline run';
      const truncatedTitle = featureRequest.length > 50
        ? featureRequest.slice(0, 50).trim() + '...'
        : featureRequest;
      const title = `feat: ${truncatedTitle}`;
      const body = buildPRBody(pipelineState);

      const prUrl = createPR({ title, body });
      console.log(chalk.green.bold(`[pr] Pull request created: ${prUrl}`));

      // Persist the PR URL in mayday state
      if (mayday) {
        this.state.updateMayday({ prUrl } as Partial<MaydayState>);
      }
    } catch (err) {
      console.log(chalk.yellow(`[pr] Could not create PR: ${err instanceof Error ? err.message : err}`));
    }
  }

  async runAnalyze(featureRequest: string, opts?: StageOpts): Promise<void> {
    if (this.state.getState().stages.analyze?.status === 'running') {
      throw new Error('Stage "analyze" is already running');
    }

    // Skip if REQUIREMENTS.md already exists and stage is done
    if (existsSync(join(this.projectCwd, 'REQUIREMENTS.md')) && this.state.getState().stages.analyze?.status === 'done') {
      console.log(chalk.green(`\n[analyze] REQUIREMENTS.md already exists — skipping.\n`));
      return;
    }

    const s = opts?.stack ?? this.config.stack;
    const interactive = opts?.interactive ?? true;

    const figmaUrl = opts?.figmaUrl;
    const codebaseCtx = this.getCodebaseContext();
    const promptParts = [
      ...(codebaseCtx ? [codebaseCtx, ''] : []),
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
      model: this.modelFor('analyst'),
      cwd: this.projectCwd,
      interactive,
      permissionMode: headlessPermission(interactive),
      disallowedTools: figmaUrl ? undefined : NON_ENGINEER_DISALLOWED_TOOLS,
      appendSystemPrompt: this.buildAppendSystemPrompt(ANALYST_SYSTEM_ENFORCEMENT),
    });

    this.state.updateStage('analyze', { status: 'running', startedAt: Date.now() });
    await this.waitForAgentWithBudgetCheck(agent.id);
    await this.finishStage('analyze', 'REQUIREMENTS.md');
  }

  async runArchitect(opts?: StageOpts): Promise<void> {
    if (this.state.getState().stages.architect?.status === 'running') {
      throw new Error('Stage "architect" is already running');
    }

    // Skip if SPEC.md already exists and stage is done
    if (existsSync(join(this.projectCwd, 'SPEC.md')) && this.state.getState().stages.architect?.status === 'done') {
      console.log(chalk.green(`\n[architect] SPEC.md already exists — skipping.\n`));
      return;
    }

    const s = opts?.stack ?? this.config.stack;
    const interactive = opts?.interactive ?? true;
    const reqPath = join(this.projectCwd, 'REQUIREMENTS.md');

    if (!existsSync(reqPath)) {
      throw new Error('REQUIREMENTS.md not found. Run `hivemind analyze` first.');
    }

    const requirements = readFileSync(reqPath, 'utf-8');
    const codebaseCtx = this.getCodebaseContext();
    const prompt = [
      ...(codebaseCtx ? [codebaseCtx, '', 'Do NOT redesign existing architecture. Extend it.', ''] : []),
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
      model: this.modelFor('architect'),
      cwd: this.projectCwd,
      interactive,
      permissionMode: headlessPermission(interactive),
      disallowedTools: NON_ENGINEER_DISALLOWED_TOOLS,
      appendSystemPrompt: this.buildAppendSystemPrompt(ARCHITECT_SYSTEM_ENFORCEMENT),
    });

    this.state.updateStage('architect', { status: 'running', startedAt: Date.now() });
    await this.waitForAgentWithBudgetCheck(agent.id);
    await this.finishStage('architect', 'SPEC.md');
  }

  async runPlan(opts?: StageOpts): Promise<void> {
    if (this.state.getState().stages.plan?.status === 'running') {
      throw new Error('Stage "plan" is already running');
    }

    // Skip if TASKS.md already exists and stage is done
    if (existsSync(join(this.projectCwd, 'TASKS.md')) && this.state.getState().stages.plan?.status === 'done') {
      console.log(chalk.green(`\n[plan] TASKS.md already exists — skipping.\n`));
      return;
    }

    const s = opts?.stack ?? this.config.stack;
    const interactive = opts?.interactive ?? true;
    const specPath = join(this.projectCwd, 'SPEC.md');

    if (!existsSync(specPath)) {
      throw new Error('SPEC.md not found. Run `hivemind architect` first.');
    }

    const spec = readFileSync(specPath, 'utf-8');
    const userGuidance = opts?.prompt;
    const codebaseCtx = this.getCodebaseContext();
    const prompt = [
      ...(codebaseCtx ? [codebaseCtx, '', 'Reference existing files when assigning task file paths.', ''] : []),
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
      model: this.modelFor('lead'),
      cwd: this.projectCwd,
      interactive,
      permissionMode: headlessPermission(interactive),
      disallowedTools: NON_ENGINEER_DISALLOWED_TOOLS,
      appendSystemPrompt: this.buildAppendSystemPrompt(LEAD_SYSTEM_ENFORCEMENT),
    });

    this.state.updateStage('plan', { status: 'running', startedAt: Date.now() });
    await this.waitForAgentWithBudgetCheck(agent.id);
    await this.finishStage('plan', 'TASKS.md');
  }

  async runBuild(opts: { parallel?: number; taskId?: string; stack?: TechStack } = {}): Promise<void> {
    if (this.state.getState().stages.build?.status === 'running') {
      throw new Error('Stage "build" is already running');
    }

    const s = opts.stack ?? this.config.stack;
    const tasksPath = join(this.projectCwd, 'TASKS.md');

    if (!existsSync(tasksPath)) {
      throw new Error('TASKS.md not found. Run `hivemind plan` first.');
    }

    const tasks = readFileSync(tasksPath, 'utf-8');
    const maxParallel = opts.parallel ?? 3;

    // Check if all tasks are already completed (all checkboxes checked)
    const uncheckedTasks = tasks.match(/^-\s+\[\s\]\s+/gm);
    const checkedTasks = tasks.match(/^-\s+\[x\]\s+/gim);
    if (!uncheckedTasks && checkedTasks && checkedTasks.length > 0) {
      console.log(chalk.green(`\n[build] All ${checkedTasks.length} tasks already completed — skipping build.\n`));
      this.state.updateStage('build', { status: 'done', finishedAt: Date.now() });
      return;
    }

    this.state.updateStage('build', { status: 'running', startedAt: Date.now() });

    // Single task mode — no orchestrator needed
    if (opts.taskId) {
      const prompt = `Read TASKS.md and implement ONLY task ${opts.taskId}. Mark it complete when done.\n\nTASKS.md:\n${tasks}`;
      console.log(chalk.cyan(`\n[build] Running task ${opts.taskId}...\n`));

      const agent = await this.agentManager.spawn({
        name: `engineer-${opts.taskId}`,
        persona: 'engineer',
        stack: s,
        prompt,
        model: this.modelFor('engineer'),
        cwd: this.projectCwd,
        interactive: false,
        permissionMode: 'auto',
        appendSystemPrompt: this.getEngineerConventions(),
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
          model: this.modelFor('engineer'),
          cwd: this.projectCwd,
          interactive: false,
          permissionMode: 'auto',
          appendSystemPrompt: this.getEngineerConventions(),
        });

        await this.waitForAgentWithBudgetCheck(agent.id);
        console.log(chalk.green(`\n[build] Complete. Cost: $${agent.cost.totalUsd.toFixed(4)}`));
      } else {
        // === Phase-by-phase pattern (no orchestrator) ===
        // Spawn sub-engineers phase by phase, then done.
        const completedTasks: Array<{ taskId: string; status: string; cost: string }> = [];
        const failedTasks: Array<{ taskId: string; error: string }> = [];

        console.log(chalk.cyan(`\n[build] ${groups.length} phase(s), max ${maxParallel} parallel engineers\n`));

        for (let i = 0; i < groups.length; i++) {
          const group = groups[i];
          console.log(chalk.cyan(`[build] Phase ${i + 1}/${groups.length}: ${group.name} (${group.taskIds.length} tasks)\n`));

          const batches = this.chunk(group.taskIds, maxParallel);

          for (const batch of batches) {
            const subEngineers = await Promise.all(
              batch.map((taskId) =>
                this.agentManager.spawn({
                  name: `engineer-${taskId}`,
                  persona: 'engineer',
                  stack: s,
                  model: this.modelFor('engineer'),
                  prompt: [
                    `You are a SUB-ENGINEER. Implement ONLY task ${taskId}. Do not touch other tasks.`,
                    `Focus exclusively on ${taskId}. When complete, stop.`,
                    '',
                    'TASKS.md:',
                    tasks,
                  ].join('\n'),
                  cwd: this.projectCwd,
                  interactive: false,
                  permissionMode: 'auto',
                  appendSystemPrompt: this.getEngineerConventions(),
                }),
              ),
            );

            const results = await Promise.allSettled(
              subEngineers.map((a) => this.waitForAgentWithBudgetCheck(a.id)),
            );

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

          console.log(chalk.green(`  Phase ${i + 1} complete.\n`));
        }

        console.log(chalk.green(`[build] All phases done.`));

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
    if (this.state.getState().stages.test?.status === 'running') {
      throw new Error('Stage "test" is already running');
    }

    const s = opts.stack ?? this.config.stack;
    const interactive = opts.interactive ?? false;
    const frameworks = getTestFrameworks(s);
    const primaryFramework = frameworks[0];

    this.state.updateStage('test', { status: 'running', startedAt: Date.now() });

    const testplanPath = join(this.projectCwd, 'TESTPLAN.md');
    const pwConfig = this.buildPlaywrightContext();
    let testerCost = 0;

    console.log(chalk.dim(`[test] Stack: ${s} → frameworks: ${frameworks.map(f => f.name).join(', ')}`));

    // ── Phase 1: Tester persona → generate TESTPLAN.md (skip if already exists) ──
    if (existsSync(testplanPath)) {
      console.log(chalk.green(`\n[test] TESTPLAN.md already exists — skipping Phase 1, proceeding to test runner.\n`));
    } else {
      console.log(chalk.cyan(`\n[test] Phase 1: Generating test plan...\n`));

      const contextParts: string[] = [];

      const reqPath = join(this.projectCwd, 'REQUIREMENTS.md');
      const specPath = join(this.projectCwd, 'SPEC.md');
      const tasksPath = join(this.projectCwd, 'TASKS.md');

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
        throw new Error('No pipeline artifacts found. Run at least `hivemind analyze` first.');
      }

      const testerPromptParts = this.buildTesterPrompt(s, frameworks, pwConfig, opts.figmaUrl);
      testerPromptParts.push('', '---', '', ...contextParts);

      if (interactive) {
        this.printStageHeader('test', s, true);
      }

      const testerAgent = await this.agentManager.spawn({
        name: `tester-${s}`,
        persona: 'tester',
        stack: s,
        prompt: testerPromptParts.join('\n'),
        model: this.modelFor('tester'),
        cwd: this.projectCwd,
        interactive,
        permissionMode: headlessPermission(interactive),
        disallowedTools: opts.figmaUrl ? undefined : NON_ENGINEER_DISALLOWED_TOOLS,
        appendSystemPrompt: this.buildAppendSystemPrompt(TESTER_SYSTEM_ENFORCEMENT),
      });

      await this.waitForAgentWithBudgetCheck(testerAgent.id);
      testerCost = testerAgent.cost.totalUsd;

      if (existsSync(testplanPath)) {
        console.log(chalk.green(`\n[test] Phase 1 complete. TESTPLAN.md created.`));
      } else {
        console.log(chalk.yellow(`\n[test] Phase 1 complete. TESTPLAN.md not found — skipping execution phase.`));
        await this.finishStage('test', 'TESTPLAN.md');
        return;
      }
    }

    // ── Phase 2: Engineer → implement and run tests ──
    const testplan = readFileSync(testplanPath, 'utf-8');

    if (frameworks.length > 1) {
      // Parallel test execution: spawn one agent per framework
      console.log(chalk.cyan(`\n[test] Phase 2: Running ${frameworks.length} test frameworks in parallel...\n`));
      const runners = await Promise.all(
        frameworks.map((fw, idx) => {
          const fwPrompt = this.buildRunnerPrompt(s, [fw], pwConfig, testplan);
          return this.agentManager.spawn({
            name: `test-runner-${fw.kind}-${idx}`,
            persona: 'engineer',
            stack: s,
            prompt: fwPrompt.join('\n'),
            model: this.modelFor('engineer'),
            cwd: this.projectCwd,
            interactive: false,
            permissionMode: 'auto',
            appendSystemPrompt: this.getEngineerConventions(),
          });
        }),
      );
      await Promise.allSettled(runners.map(a => this.waitForAgentWithBudgetCheck(a.id)));
      const runnerCost = runners.reduce((sum, a) => sum + a.cost.totalUsd, 0);
      await this.finishStage('test', 'TESTPLAN.md');
      console.log(chalk.green(`\n[test] ${frameworks.length} test suites complete. Cost: $${(testerCost + runnerCost).toFixed(4)}`));
    } else {
      // Single framework: original behavior
      console.log(chalk.cyan(`\n[test] Phase 2: Implementing and running ${primaryFramework.name} tests...\n`));
      const runnerPromptParts = this.buildRunnerPrompt(s, frameworks, pwConfig, testplan);
      const runnerAgent = await this.agentManager.spawn({
        name: `test-runner-${s}`,
        persona: 'engineer',
        stack: s,
        prompt: runnerPromptParts.join('\n'),
        model: this.modelFor('engineer'),
        cwd: this.projectCwd,
        interactive: false,
        permissionMode: 'auto',
        appendSystemPrompt: this.getEngineerConventions(),
      });
      await this.waitForAgentWithBudgetCheck(runnerAgent.id);
      await this.finishStage('test', 'TESTPLAN.md');
      console.log(chalk.green(`\n[test] Tests complete. Cost: $${(testerCost + runnerAgent.cost.totalUsd).toFixed(4)}`));
    }
  }

  /** Build the Phase 1 tester prompt — framework-aware */
  private buildTesterPrompt(
    stack: TechStack,
    frameworks: TestFrameworkConfig[],
    pwConfig: Required<Pick<PlaywrightConfig, 'testDir'>> & PlaywrightConfig,
    figmaUrl?: string,
  ): string[] {
    const primary = frameworks[0];
    const isE2E = primary.category === 'e2e';
    const parts = [
      `Read the pipeline artifacts below and produce TESTPLAN.md — a comprehensive test plan for a ${stack} project.`,
      '',
      `## Test Frameworks`,
      ...frameworks.map((f, i) => `${i + 1}. **${f.name}** (${f.category}) — test dir: \`${f.testDir}/\`, pattern: \`${f.testFilePattern}\``),
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
      '- ## Overview — what is being tested, scope, tech stack',
      `- ## Test Strategy — frameworks: ${frameworks.map(f => f.name).join(', ')}; categories: ${frameworks.map(f => f.category).join(', ')}`,
    ];

    if (isE2E) {
      parts.push(
        '- ## Authentication — login method, storageState pattern, global setup needs',
      );
    }

    parts.push(
      '- ## Test Data — required fixtures, seed data, mock APIs',
      '- ## Test Cases — each test case with:',
      '  - **ID**: TC-001, TC-002, etc.',
      '  - **Title**: descriptive name',
      `  - **Framework**: which framework (${frameworks.map(f => f.name).join(' / ')})`,
      '  - **Category**: unit / integration / api / e2e',
      '  - **User Story**: which US-n / user flow this covers',
      '  - **Preconditions**: setup needed',
    );

    if (isE2E) {
      parts.push(
        '  - **Steps**: numbered user actions (navigate, click, fill, etc.)',
        '  - **Expected**: specific assertions (element visible, text matches, URL changes, etc.)',
      );
    } else {
      parts.push(
        '  - **Input**: function/endpoint being tested with input data',
        '  - **Expected**: expected return value, status code, side effects, or error',
      );
    }

    parts.push(
      `  - **File**: target test file path (e.g. \`${primary.testDir}/example${primary.testFilePattern.replace('*', '')}\`)`,
      '- ## Acceptance Criteria — overall pass/fail criteria for the test suite',
    );

    // Stack-specific guidance
    switch (stack) {
      case 'node':
        parts.push(
          '',
          '## Node.js-Specific Guidance:',
          '- Test API endpoints with Supertest (HTTP assertions)',
          '- Test service/business logic with unit tests',
          '- Mock external dependencies (databases, third-party APIs)',
          '- Test error handling and edge cases (invalid input, auth failures)',
          '- Test middleware (auth, validation, rate limiting)',
        );
        break;
      case 'go':
        parts.push(
          '',
          '## Go-Specific Guidance:',
          '- Use table-driven tests for multiple input/output cases',
          '- Test HTTP handlers with httptest.NewServer or httptest.NewRecorder',
          '- Use testify/assert for cleaner assertions (if available)',
          '- Test error paths and edge cases',
          '- Test interfaces with mock implementations',
        );
        break;
      case 'python':
        parts.push(
          '',
          '## Python-Specific Guidance:',
          '- Use pytest fixtures for test setup/teardown',
          '- Test API endpoints with the test client (FastAPI: TestClient, Django: Client, Flask: test_client)',
          '- Use unittest.mock or pytest-mock for mocking external services',
          '- Test edge cases, error handling, and validation',
          '- Parametrize tests for multiple input scenarios',
        );
        break;
      case 'rust':
        parts.push(
          '',
          '## Rust-Specific Guidance:',
          '- Use #[test] functions in the same file or in a tests/ directory',
          '- Use assert!, assert_eq!, assert_ne! macros',
          '- Test error types with Result and matches! macro',
          '- Test async code with #[tokio::test] if using tokio',
        );
        break;
    }

    if (isE2E) {
      parts.push('', `Playwright config: testDir=${pwConfig.testDir}`);
      if (pwConfig.baseUrl) parts.push(`Base URL: ${pwConfig.baseUrl}`);
      if (pwConfig.authStorageState) parts.push(`Auth storageState path: ${pwConfig.authStorageState}`);
    }

    if (figmaUrl) {
      parts.push(
        '',
        `Figma design URL: ${figmaUrl}`,
        'Use Figma MCP tools (get_design_context, get_screenshot) to extract UI details.',
        'Derive visual E2E test cases from the designs: verify layout, component states,',
        'responsiveness, and visual accuracy.',
      );
    }

    return parts;
  }

  /** Build the Phase 2 runner prompt — framework-aware */
  private buildRunnerPrompt(
    stack: TechStack,
    frameworks: TestFrameworkConfig[],
    pwConfig: Required<Pick<PlaywrightConfig, 'testDir'>> & PlaywrightConfig,
    testplan: string,
  ): string[] {
    const primary = frameworks[0];
    const isE2E = primary.category === 'e2e';

    const parts = [
      `You are a TEST ENGINEER. Implement and run tests based on TESTPLAN.md for a ${stack} project.`,
      '',
      '## Test Frameworks to Use:',
      ...frameworks.map((f, i) => [
        `### ${i + 1}. ${f.name} (${f.category})`,
        `- Test dir: \`${f.testDir}/\``,
        `- File pattern: \`${f.testFilePattern}\``,
        f.installCmd ? `- Install: \`${f.installCmd}\`` : '- (built-in, no install needed)',
        `- Run: \`${f.runCmd}\``,
      ].join('\n')),
      '',
      '⚠️ CRITICAL CONSTRAINTS:',
      '- Do NOT modify application source code. Only create/modify test files and test config.',
      '- If a test fails, fix the TEST, not the application.',
    ];

    if (isE2E) {
      parts.push(
        `- If Playwright is not installed, run: \`${primary.installCmd}\``,
      );
      if (pwConfig.baseUrl) {
        parts.push(`- Set baseURL to: ${pwConfig.baseUrl}`);
      }
      if (pwConfig.authStorageState) {
        parts.push(
          `- Configure storageState: ${pwConfig.authStorageState}`,
          '  If storageState file does not exist, create a global setup script that performs login.',
        );
      }
    }

    parts.push(
      '',
      'Your job:',
      '1. Read TESTPLAN.md and implement each test case',
      `2. Place test files in the correct directories (${frameworks.map(f => `\`${f.testDir}/\` for ${f.name}`).join(', ')})`,
      `3. Create/update test config files as needed`,
      '',
      'After implementing all tests:',
      ...frameworks.map(f =>
        `- Run ${f.name} tests: \`${f.runCmd}\``
      ),
      '- If any test fails, read the error, fix the test, and re-run',
      '- Keep iterating until all tests pass or you have exhausted debugging',
      '- Always re-run with JSON output so structured results are captured in `.swarm/test-results.json`',
      '- Report final results summary',
      '',
      '---',
      '',
      testplan,
    );

    return parts;
  }

  async runFull(featureRequest: string, opts?: StageOpts): Promise<void> {
    const stack = opts?.stack;
    await this.runAnalyze(featureRequest, { stack, interactive: opts?.interactive ?? true, figmaUrl: opts?.figmaUrl });
    await this.runArchitect({ stack, interactive: opts?.interactive ?? true });
    await this.runPlan({ stack, interactive: opts?.interactive ?? true });
    await this.runBuild({ stack });
    await this.runValidate();
    await this.runShip();
  }

  /**
   * Create a virtual agent for stages that don't spawn Claude processes (validate, ship).
   * This lets the dashboard show output in the panel.
   */
  private createStageAgent(stage: import('../types.js').StageName, name: string): { agentId: string; emit: (line: string) => void; done: () => void; fail: (err: string) => void } {
    const agentId = uuid();
    const agent: import('../types.js').Agent = {
      id: agentId,
      name,
      persona: 'engineer',
      stack: this.config.stack,
      status: 'running',
      pid: null,
      sessionId: agentId,
      model: 'system',
      permissionMode: 'auto',
      startedAt: Date.now(),
      finishedAt: null,
      cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 0 },
      output: '',
      error: null,
      parentId: null,
      childIds: [],
    };
    this.state.addAgent(agent);
    this.state.updateStage(stage, { agentIds: [agentId] });

    const emit = (line: string) => {
      agent.output += line + '\n';
      this.agentManager.emit('agent-output', { agentId, chunk: line + '\n' });
    };
    const done = () => {
      agent.status = 'done';
      agent.finishedAt = Date.now();
      this.state.updateAgent(agent);
      this.agentManager.emit('agent-done', agent);
    };
    const fail = (err: string) => {
      agent.status = 'error';
      agent.error = err;
      agent.finishedAt = Date.now();
      this.state.updateAgent(agent);
      this.agentManager.emit('agent-error', agent);
    };

    return { agentId, emit, done, fail };
  }

  /** Detect the package manager / build system for the project */
  private detectRunner(): { type: string; run: (s: string) => string; exec: (b: string) => string } {
    const cwd = this.projectCwd;
    if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock')))
      return { type: 'bun', run: (s) => `bun run ${s}`, exec: (b) => `bunx ${b}` };
    if (existsSync(join(cwd, 'pnpm-lock.yaml')))
      return { type: 'pnpm', run: (s) => `pnpm run ${s}`, exec: (b) => `pnpm exec ${b}` };
    if (existsSync(join(cwd, 'yarn.lock')))
      return { type: 'yarn', run: (s) => `yarn ${s}`, exec: (b) => `yarn ${b}` };
    if (existsSync(join(cwd, 'package-lock.json')) || existsSync(join(cwd, 'package.json')))
      return { type: 'npm', run: (s) => `npm run ${s}`, exec: (b) => `npx ${b}` };
    if (existsSync(join(cwd, 'go.mod')))
      return { type: 'go', run: (s) => `go ${s}`, exec: (b) => b };
    if (existsSync(join(cwd, 'Cargo.toml')))
      return { type: 'cargo', run: (s) => `cargo ${s}`, exec: (b) => b };
    if (existsSync(join(cwd, 'pyproject.toml')) || existsSync(join(cwd, 'setup.py')) || existsSync(join(cwd, 'requirements.txt')))
      return { type: 'python', run: (s) => s, exec: (b) => b };
    if (existsSync(join(cwd, 'Package.swift')))
      return { type: 'swift', run: (s) => `swift ${s}`, exec: (b) => b };
    return { type: 'npm', run: (s) => `npm run ${s}`, exec: (b) => `npx ${b}` };
  }

  /** Run the validate stage: type-check, lint, build compilation check */
  async runValidate(): Promise<void> {
    this.state.updateStage('validate', { status: 'running', startedAt: Date.now() });
    const cwd = this.projectCwd;
    const runner = this.detectRunner();
    let hasFailure = false;
    const va = this.createStageAgent('validate', 'validate');

    const log = (msg: string) => { console.log(msg); va.emit(msg.replace(/\x1b\[[0-9;]*m/g, '')); };

    log(`[validate] Running build validation (${runner.type})...\n`);

    // Type-check
    try {
      if (runner.type === 'go') {
        execSync('go vet ./...', { cwd, stdio: 'pipe', timeout: 60000 });
        log('  ✓ Type-check (go vet)');
      } else if (runner.type === 'cargo') {
        execSync('cargo check', { cwd, stdio: 'pipe', timeout: 120000 });
        log('  ✓ Type-check (cargo check)');
      } else if (existsSync(join(cwd, 'tsconfig.json'))) {
        execSync(`${runner.exec('tsc')} --noEmit`, { cwd, stdio: 'pipe', timeout: 60000 });
        log('  ✓ Type-check (tsc)');
      } else {
        log('  - Type-check skipped');
      }
    } catch (err: any) {
      const output = err.stderr?.toString() || err.stdout?.toString() || '';
      log('  ✗ Type-check failed');
      if (output) log(output.slice(0, 1000));
      hasFailure = true;
    }

    // Lint (auto-fix on failure, then re-check)
    try {
      if (runner.type === 'go') {
        try {
          execSync('golangci-lint run ./...', { cwd, stdio: 'pipe', timeout: 60000 });
          log('  ✓ Lint (golangci-lint)');
        } catch {
          try {
            log('  ⟳ Lint failed — attempting auto-fix...');
            execSync('golangci-lint run --fix ./...', { cwd, stdio: 'pipe', timeout: 60000 });
            execSync('golangci-lint run ./...', { cwd, stdio: 'pipe', timeout: 60000 });
            log('  ✓ Lint fixed (golangci-lint --fix)');
          } catch { log('  - Lint skipped (no golangci-lint or unfixable)'); }
        }
      } else if (runner.type === 'cargo') {
        try {
          execSync('cargo clippy -- -D warnings', { cwd, stdio: 'pipe', timeout: 60000 });
          log('  ✓ Lint (clippy)');
        } catch {
          log('  ⟳ Lint failed — attempting auto-fix...');
          execSync('cargo clippy --fix --allow-dirty -- -D warnings', { cwd, stdio: 'pipe', timeout: 60000 });
          execSync('cargo clippy -- -D warnings', { cwd, stdio: 'pipe', timeout: 60000 });
          log('  ✓ Lint fixed (clippy --fix)');
        }
      } else if (runner.type === 'python') {
        try {
          execSync('ruff check .', { cwd, stdio: 'pipe', timeout: 60000 });
          log('  ✓ Lint (ruff)');
        } catch {
          try {
            log('  ⟳ Lint failed — attempting auto-fix...');
            execSync('ruff check --fix .', { cwd, stdio: 'pipe', timeout: 60000 });
            execSync('ruff check .', { cwd, stdio: 'pipe', timeout: 60000 });
            log('  ✓ Lint fixed (ruff --fix)');
          } catch { log('  - Lint skipped (no ruff or unfixable)'); }
        }
      } else {
        const pkgPath = join(cwd, 'package.json');
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
          if (pkg.scripts?.lint) {
            try {
              execSync(runner.run('lint'), { cwd, stdio: 'pipe', timeout: 60000 });
              log('  ✓ Lint');
            } catch {
              const fixScript = pkg.scripts['lint:fix'] ? 'lint:fix' : null;
              if (fixScript) {
                log('  ⟳ Lint failed — running lint:fix...');
                execSync(runner.run(fixScript), { cwd, stdio: 'pipe', timeout: 60000 });
              } else {
                log('  ⟳ Lint failed — attempting --fix...');
                try {
                  execSync(runner.run('lint') + ' -- --fix', { cwd, stdio: 'pipe', timeout: 60000 });
                } catch {
                  try {
                    execSync(`${runner.exec('eslint')} . --fix`, { cwd, stdio: 'pipe', timeout: 60000 });
                  } catch { /* best effort */ }
                }
              }
              try {
                execSync(runner.run('lint'), { cwd, stdio: 'pipe', timeout: 60000 });
                log('  ✓ Lint fixed');
              } catch (e: any) {
                const out = e.stderr?.toString() || e.stdout?.toString() || '';
                log('  ✗ Lint still failing after auto-fix');
                if (out) log(out.slice(0, 1000));
                hasFailure = true;
              }
            }
          } else {
            log('  - Lint skipped (no lint script)');
          }
        }
      }
    } catch (err: any) {
      const output = err.stderr?.toString() || err.stdout?.toString() || '';
      log('  ✗ Lint failed');
      if (output) log(output.slice(0, 1000));
      hasFailure = true;
    }

    // Build
    try {
      if (runner.type === 'go') {
        execSync('go build ./...', { cwd, stdio: 'pipe', timeout: 120000 });
        log('  ✓ Build (go build)');
      } else if (runner.type === 'cargo') {
        execSync('cargo build', { cwd, stdio: 'pipe', timeout: 120000 });
        log('  ✓ Build (cargo build)');
      } else if (runner.type === 'swift') {
        execSync('swift build', { cwd, stdio: 'pipe', timeout: 120000 });
        log('  ✓ Build (swift build)');
      } else {
        const pkgPath = join(cwd, 'package.json');
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
          if (pkg.scripts?.build) {
            execSync(runner.run('build'), { cwd, stdio: 'pipe', timeout: 120000 });
            log('  ✓ Build');
          } else {
            log('  - Build skipped (no build script)');
          }
        }
      }
    } catch (err: any) {
      const output = err.stderr?.toString() || err.stdout?.toString() || '';
      log('  ✗ Build failed');
      if (output) log(output.slice(0, 1000));
      hasFailure = true;
    }

    if (hasFailure) {
      va.fail('Validation failed');
      this.state.updateStage('validate', { status: 'error', finishedAt: Date.now() });
      throw new Error('Validation failed. Fix errors before shipping.');
    }
    va.emit('\n✓ All checks passed.');
    va.done();
    this.state.updateStage('validate', { status: 'done', finishedAt: Date.now() });
    console.log(chalk.green('\n[validate] All checks passed.\n'));
  }

  /** Deploy to Nexus sandbox via API */
  private async nexusDeploy(name: string, githubUrl: string, label: string): Promise<{ url: string; version: number }> {
    const apiUrl = process.env.NEXUS_API_URL || 'http://localhost:8080';
    const token = process.env.NEXUS_TOKEN || 'valid-token';
    const headers: Record<string, string> = { 'Authorization': `Bearer ${token}` };

    // Check if sandbox exists
    const listRes = await fetch(`${apiUrl}/api/sandboxes`, { headers });
    if (!listRes.ok) throw new Error(`Nexus API error: ${listRes.statusText}`);
    const listData = await listRes.json() as any;
    const sandboxes = listData.sandboxes || listData;
    const existing = Array.isArray(sandboxes) ? sandboxes.find((s: any) => s.name === name) : null;

    if (existing) {
      // Deploy new version to existing sandbox
      console.log(chalk.dim(`    Sandbox "${name}" exists — deploying new version...`));
      const res = await fetch(`${apiUrl}/api/sandboxes/${existing.id}/versions`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ github_url: githubUrl, label }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Nexus deploy failed: ${res.statusText} — ${body.slice(0, 300)}`);
      }
      const result = await res.json() as any;
      const version = result.current_version || result.number || (existing.current_version || 1) + 1;
      const url = existing.cloud_run_url || existing.url || `https://${name}.nexus.app`;
      return { url, version };
    } else {
      // Create new sandbox
      console.log(chalk.dim(`    Creating new sandbox "${name}"...`));
      const res = await fetch(`${apiUrl}/api/sandboxes`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, github_url: githubUrl, label }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Nexus create failed: ${res.statusText} — ${body.slice(0, 300)}`);
      }
      const result = await res.json() as any;
      const url = result.cloud_run_url || `https://${name}.nexus.app`;
      return { url, version: 1 };
    }
  }

  /** Run the ship stage: push to git and deploy via Nexus */
  async runShip(): Promise<void> {
    this.state.updateStage('ship', { status: 'running', startedAt: Date.now() });
    const cwd = this.projectCwd;
    const sa = this.createStageAgent('ship', 'ship');
    const log = (msg: string) => { console.log(msg); sa.emit(msg.replace(/\x1b\[[0-9;]*m/g, '')); };

    log('[ship] Pushing and deploying...\n');

    try {
      // Commit any uncommitted changes
      const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8' }).trim();
      if (status) {
        execSync('git add -A', { cwd, stdio: 'pipe' });
        execSync('git commit -m "chore: pre-ship commit"', { cwd, stdio: 'pipe' });
        log('  Committed changes');
      }

      const branch = execSync('git branch --show-current', { cwd, encoding: 'utf-8' }).trim();

      // Push feature branch
      execSync(`git push -u origin ${branch}`, { cwd, stdio: 'pipe', timeout: 60000 });
      log(`  ✓ Pushed to origin/${branch}`);

      // Merge to main
      const mainBranch = (() => {
        try {
          // Check if 'main' exists, otherwise try 'master'
          execSync('git rev-parse --verify main', { cwd, stdio: 'pipe' });
          return 'main';
        } catch {
          try {
            execSync('git rev-parse --verify master', { cwd, stdio: 'pipe' });
            return 'master';
          } catch {
            return null;
          }
        }
      })();

      if (mainBranch && branch !== mainBranch) {
        log(`  Merging ${branch} → ${mainBranch}...`);
        execSync(`git checkout ${mainBranch}`, { cwd, stdio: 'pipe' });
        execSync(`git pull origin ${mainBranch}`, { cwd, stdio: 'pipe', timeout: 60000 });
        execSync(`git merge ${branch} --no-edit`, { cwd, stdio: 'pipe' });
        execSync(`git push origin ${mainBranch}`, { cwd, stdio: 'pipe', timeout: 60000 });
        log(`  ✓ Merged to ${mainBranch} and pushed`);
        // Switch back to feature branch
        execSync(`git checkout ${branch}`, { cwd, stdio: 'pipe' });
      } else if (branch === mainBranch) {
        log(`  Already on ${mainBranch} — no merge needed`);
      } else {
        log('  No main/master branch found — skipping merge');
      }

      // Deploy to Nexus
      let githubUrl = '';
      try {
        const remote = execSync('git remote get-url origin', { cwd, encoding: 'utf-8' }).trim();
        githubUrl = remote.replace(/https:\/\/[^@]+@/, 'https://');
      } catch {
        // No remote
      }

      if (githubUrl) {
        const projectName = this.config.projectName || cwd.split('/').pop() || 'app';
        const safeName = projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
        const label = `ship-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`;

        log(`  Deploying "${safeName}" to Nexus...`);
        try {
          const { url, version } = await this.nexusDeploy(safeName, githubUrl, label);
          log(`  ✓ Deployed to Nexus`);
          log(`    Sandbox: ${safeName}`);
          log(`    Version: v${version}`);
          log(`    URL: ${url}`);
        } catch (err: any) {
          log(`  ⚠ Nexus deploy failed: ${err.message}`);
          log(`    Git push succeeded — deploy manually or check Nexus server`);
        }
      } else {
        log('  No git remote — skipping Nexus deploy');
      }

      sa.done();
      this.state.updateStage('ship', { status: 'done', finishedAt: Date.now() });
      log('\n[ship] Ship complete.');
    } catch (err: any) {
      const output = err.stderr?.toString() || err.stdout?.toString() || err.message;
      log(`  ✗ Ship failed: ${output.slice(0, 500)}`);
      sa.fail('Ship failed');
      this.state.updateStage('ship', { status: 'error', finishedAt: Date.now() });
      throw new Error('Ship failed.');
    }
  }

  /**
   * Run a custom pipeline defined by a PipelineDefinition.
   * Iterates through stages respecting dependsOn and condition fields.
   */
  async runCustomPipeline(
    definition: PipelineDefinition,
    featureRequest: string,
    opts: StageOpts & { parallel?: number } = {},
  ): Promise<void> {
    const stack = opts.stack ?? this.config.stack;
    const stageOpts: StageOpts = {
      stack,
      interactive: opts.interactive ?? false,
      figmaUrl: opts.figmaUrl,
    };

    const completed = new Set<string>();
    const stageMap = new Map<string, PipelineStageDefinition>();
    for (const s of definition.stages) {
      stageMap.set(s.name, s);
    }

    console.log(chalk.cyan(`\n[pipeline] Running custom pipeline (${definition.stages.length} stages)\n`));

    for (const stageDef of definition.stages) {
      // Check if mayday was stopped (if running within mayday)
      if (this.state.getMayday()?.active === false) {
        console.log(chalk.yellow(`\n[pipeline] Stopped by user.`));
        return;
      }

      // Check dependencies
      if (stageDef.dependsOn) {
        const unmet = stageDef.dependsOn.filter(dep => !completed.has(dep));
        if (unmet.length > 0) {
          console.log(chalk.yellow(`[pipeline] Skipping "${stageDef.name}": unmet dependencies: ${unmet.join(', ')}`));
          const mappedStage = stageNameForDefinition(stageDef);
          this.state.updateStage(mappedStage, { status: 'skipped' });
          continue;
        }
      }

      // Check condition
      if (stageDef.condition) {
        const skip = this.evaluateCondition(stageDef.condition);
        if (skip) {
          console.log(chalk.yellow(`[pipeline] Skipping "${stageDef.name}": condition not met (${stageDef.condition})`));
          const mappedStage = stageNameForDefinition(stageDef);
          this.state.updateStage(mappedStage, { status: 'skipped' });
          completed.add(stageDef.name); // Treat as completed for dependency resolution
          continue;
        }
      }

      // Dispatch to the appropriate run method based on persona
      const customPrompt = stageDef.prompt;
      const stageOptsWithPrompt: StageOpts = { ...stageOpts, prompt: customPrompt ?? opts.prompt };

      console.log(chalk.cyan(`[pipeline] ▸ ${stageDef.name} (${stageDef.persona})`));

      try {
        switch (stageDef.persona) {
          case 'analyst':
            await this.runAnalyze(featureRequest, stageOptsWithPrompt);
            break;
          case 'architect':
            await this.runArchitect(stageOptsWithPrompt);
            break;
          case 'lead':
            await this.runPlan(stageOptsWithPrompt);
            break;
          case 'engineer':
            await this.runBuild({ stack, parallel: opts.parallel ?? 3 });
            break;
          case 'tester':
            await this.runTest({ stack, figmaUrl: opts.figmaUrl });
            break;
        }

        // Auto-commit after each stage
        const mappedStage = stageNameForDefinition(stageDef);
        if (stageDef.artifact) {
          this.autoCommitStage(mappedStage, stageDef.artifact);
        }

        completed.add(stageDef.name);
      } catch (err) {
        const mappedStage = stageNameForDefinition(stageDef);
        this.state.updateStage(mappedStage, { status: 'error' });
        throw err;
      }
    }

    console.log(chalk.green(`\n[pipeline] Custom pipeline complete (${completed.size}/${definition.stages.length} stages).`));
  }

  /**
   * Run a stage with retry. On first failure: log, wait 5s, retry.
   * On second failure: throw (caller decides whether to abort or skip).
   */
  /** Tracks failure reasons per stage so downstream stages can reference them */
  private stageFailureContext = new Map<string, string>();

  /** Get failure context from a previous stage attempt (for backward context flow) */
  getStageFailureContext(stage: StageName): string | undefined {
    return this.stageFailureContext.get(stage);
  }

  private async runStageWithRetry(
    stage: StageName,
    fn: () => Promise<void>,
    maxAttempts = 2,
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await fn();
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Record failure context for backward flow
        this.stageFailureContext.set(stage, `Stage "${stage}" failed (attempt ${attempt}): ${msg}`);
        if (attempt < maxAttempts) {
          console.log(chalk.yellow(`[mayday] Stage "${stage}" failed (attempt ${attempt}/${maxAttempts}): ${msg}`));
          console.log(chalk.yellow(`[mayday] Retrying in 5s with failure context...`));
          // Reset stage status for retry
          this.state.updateStage(stage, { status: 'pending' });
          await sleep(5000);
        } else {
          throw err;
        }
      }
    }
  }

  /**
   * Evaluate a stage condition. Returns true if the stage should be SKIPPED.
   */
  private evaluateCondition(condition: string): boolean {
    if (condition.startsWith('file-exists:')) {
      const filename = condition.slice('file-exists:'.length).trim();
      const filePath = join(this.projectCwd, filename);
      // Skip if file does NOT exist
      return !existsSync(filePath);
    }
    // Unknown condition type — don't skip
    return false;
  }

  private printStageHeader(stage: string, stack: TechStack, interactive: boolean): void {
    if (interactive) {
      console.log(chalk.cyan(`\n[${stage}] Starting interactive session (${stack})...`));
      console.log(chalk.dim('You can converse with the agent. It will produce the artifact and exit when done.\n'));
    } else {
      console.log(chalk.cyan(`\n[${stage}] Starting agent (${stack})...\n`));
    }
  }

  /**
   * Generate a concise context summary from an artifact file (~500 chars).
   * Extracts key structural info depending on artifact type.
   */
  private generateContextSummary(artifactPath: string, stage: StageName): string {
    try {
      const content = readFileSync(artifactPath, 'utf-8');
      const headings = content.match(/^##\s+.+$/gm) || [];

      switch (stage) {
        case 'analyze':
          // Extract section headings from REQUIREMENTS.md
          return `Sections: ${headings.map(h => h.replace(/^##\s+/, '')).join(', ')}`.slice(0, 500);
        case 'architect':
          // Extract ADR titles from SPEC.md
          const adrs = content.match(/^###\s+ADR-\d+.+$/gm) || [];
          return `Architecture: ${headings.length} sections. ADRs: ${adrs.map(a => a.replace(/^###\s+/, '')).join('; ')}`.slice(0, 500);
        case 'plan': {
          // Count tasks from TASKS.md
          const tasks = content.match(/^- \[[ x]\] T\d+/gm) || [];
          const parallel = content.match(/\[P\]/g) || [];
          return `Tasks: ${tasks.length} total, ${parallel.length} parallelizable. ${headings.map(h => h.replace(/^##\s+/, '')).join(', ')}`.slice(0, 500);
        }
        case 'test':
          // Count test cases from TESTPLAN.md
          const testCases = content.match(/^###?\s+TC-\d+/gm) || [];
          return `Test plan: ${testCases.length} test cases. ${headings.map(h => h.replace(/^##\s+/, '')).join(', ')}`.slice(0, 500);
        default:
          return headings.map(h => h.replace(/^##\s+/, '')).join(', ').slice(0, 500);
      }
    } catch {
      return '';
    }
  }

  private async finishStage(stage: StageName, expectedArtifact: string): Promise<void> {
    const artifactFullPath = join(this.projectCwd, expectedArtifact);
    const artifact = existsSync(artifactFullPath) ? expectedArtifact : null;

    // Find the primary agent's sessionId for this stage
    const stageState = this.state.getState().stages[stage];
    const primaryAgentId = stageState.agentIds[0];
    const primaryAgent = primaryAgentId ? this.state.getAgent(primaryAgentId) : undefined;

    // Generate context summary from the artifact
    const contextSummary = artifact ? this.generateContextSummary(artifactFullPath, stage) : undefined;

    this.state.updateStage(stage, {
      status: 'done',
      artifact,
      sessionId: primaryAgent?.sessionId,
      contextSummary,
      finishedAt: Date.now(),
    });

    if (artifact) {
      console.log(chalk.green(`\n[${stage}] Complete. ${expectedArtifact} created.`));
    } else {
      console.log(chalk.green(`\n[${stage}] Session complete.`));
    }

    // Run blocking guardrails on the artifact
    if (artifact) {
      const violations = this.guardrails.evaluateArtifact(this.projectCwd, expectedArtifact);
      const errors = violations.filter(v => v.severity === 'error');
      const warnings = violations.filter(v => v.severity === 'warning');

      // Persist violations in state for dashboard
      const pipelineState = this.state.getState();
      pipelineState.violations = [...(pipelineState.violations || []), ...violations];
      this.state.scheduleSavePublic();

      if (warnings.length > 0) {
        for (const w of warnings) {
          console.log(chalk.yellow(`[guardrail] warning: ${w.message}`));
        }
      }

      if (errors.length > 0) {
        for (const e of errors) {
          console.log(chalk.red(`[guardrail] error: ${e.message}`));
        }
        console.log(chalk.red(`[guardrail] ${errors.length} error(s) in ${expectedArtifact} — stage will be retried.`));
        // Mark stage as error so runStageWithRetry can retry it
        this.state.updateStage(stage, { status: 'error' });
        throw new Error(`Guardrail errors in ${expectedArtifact}: ${errors.map(e => e.message).join('; ')}`);
      }
    }

    // Run quality scoring on the artifact
    const score = this.quality.scoreArtifact(this.projectCwd, stage);
    if (score) {
      const pipelineState = this.state.getState();
      const scores = pipelineState.qualityScores ?? [];
      // Replace existing score for this stage
      const filtered = scores.filter(s => s.stage !== stage);
      filtered.push(score);
      pipelineState.qualityScores = filtered;
      this.state.scheduleSavePublic();

      const color = score.overall >= 80 ? chalk.green : score.overall >= 50 ? chalk.yellow : chalk.red;
      console.log(color(`[quality] ${expectedArtifact}: ${score.overall}/100`));
      for (const d of score.dimensions) {
        console.log(chalk.dim(`  ${d.name}: ${d.score}/100 — ${d.detail}`));
      }

      // LLM-powered quality gate (optional, runs haiku for semantic evaluation)
      if (this.config.llmQualityGate && artifact) {
        const threshold = this.config.llmQualityThreshold ?? 60;
        try {
          const llmDimension = await this.quality.scoreLLM(this.projectCwd, expectedArtifact, 'haiku');
          if (llmDimension) {
            // Blend heuristic + LLM: 40% heuristic, 60% LLM
            const blendedScore = Math.round(score.overall * 0.4 + llmDimension.score * 0.6);
            const llmColor = llmDimension.score >= 80 ? chalk.green : llmDimension.score >= 50 ? chalk.yellow : chalk.red;
            console.log(llmColor(`[quality:llm] ${expectedArtifact}: ${llmDimension.score}/100 — ${llmDimension.detail}`));
            console.log(chalk.dim(`[quality] Blended: ${blendedScore}/100 (heuristic: ${score.overall}, llm: ${llmDimension.score})`));

            if (blendedScore < threshold) {
              console.log(chalk.red(`[quality] Blended score ${blendedScore} below threshold ${threshold} — stage will be retried.`));
              this.state.updateStage(stage, { status: 'error' });
              throw new Error(`Quality gate failed for ${expectedArtifact}: blended score ${blendedScore}/${threshold}`);
            }
          }
        } catch (err) {
          // Only re-throw quality gate failures, not LLM errors
          if (err instanceof Error && err.message.includes('Quality gate failed')) throw err;
          // LLM eval failed — non-critical, continue with heuristic only
        }
      }
    }

    this.webhooks.stageComplete(this.config.projectName, stage, this.state.getState().totalCost).catch(() => {});
  }

  /**
   * Generate FAILURE-REPORT.md when MayDay fails, preserving what was attempted and what succeeded.
   */
  private generateFailureReport(): void {
    try {
      const pipelineState = this.state.getState();
      const mayday = pipelineState.mayday;
      if (!mayday) return;

      const stages: StageName[] = ['analyze', 'architect', 'plan', 'build'];
      const stageLines: string[] = [];
      for (const stage of stages) {
        const s = pipelineState.stages[stage];
        const status = s.status === 'done' ? 'done' : s.status === 'skipped' ? 'skipped' : s.status === 'error' ? 'FAILED' : s.status;
        const artifact = s.artifact ? `(${s.artifact})` : '';
        stageLines.push(`| ${stage} | ${status} | ${artifact} |`);
      }

      const fixHistoryLines: string[] = [];
      if (mayday.fixHistory && mayday.fixHistory.length > 0) {
        for (const entry of mayday.fixHistory) {
          fixHistoryLines.push(`### Iteration ${entry.iteration}`);
          fixHistoryLines.push(`- **Approach:** ${entry.approach}`);
          fixHistoryLines.push(`- **Failed tests:** ${entry.failedTests.length} — ${entry.failedTests.slice(0, 5).join(', ')}${entry.failedTests.length > 5 ? '...' : ''}`);
          fixHistoryLines.push(`- **Fixed:** ${entry.fixedTests.length > 0 ? entry.fixedTests.join(', ') : 'none'}`);
          fixHistoryLines.push(`- **New regressions:** ${entry.newFailures.length > 0 ? entry.newFailures.join(', ') : 'none'}`);
          fixHistoryLines.push(`- **Cost:** $${entry.cost.toFixed(2)}`);
          fixHistoryLines.push('');
        }
      }

      const artifactsProduced: string[] = [];
      for (const stage of stages) {
        const artifact = STAGE_ARTIFACT_MAP[stage];
        if (artifact && existsSync(join(this.projectCwd, artifact))) {
          artifactsProduced.push(`- ${artifact}`);
        }
      }

      const report = [
        '# Failure Report',
        '',
        `**Feature:** ${mayday.featureRequest}`,
        `**Error:** ${mayday.error || 'Unknown error'}`,
        `**Total cost:** $${pipelineState.totalCost.totalUsd.toFixed(2)}`,
        `**Duration:** ${mayday.startedAt ? ((Date.now() - mayday.startedAt) / 60000).toFixed(1) + 'm' : 'unknown'}`,
        '',
        '## Stage Results',
        '',
        '| Stage | Status | Artifact |',
        '|-------|--------|----------|',
        ...stageLines,
        '',
        '## Artifacts Produced',
        '',
        artifactsProduced.length > 0 ? artifactsProduced.join('\n') : '_No artifacts produced._',
        '',
        ...(fixHistoryLines.length > 0
          ? ['## Fix Loop History', '', ...fixHistoryLines]
          : []),
        ...(mayday.lastTestOutput
          ? ['## Last Test Output', '', '```', mayday.lastTestOutput.slice(0, 5000), '```', '']
          : []),
        '## Suggested Next Steps',
        '',
        mayday.error?.includes('Stuck')
          ? '1. Review the failing tests manually — the fix loop tried the same approach repeatedly.\n2. Consider a different implementation approach.\n3. Run `hivemind mayday --resume --from build` after making manual fixes.'
          : mayday.error?.includes('Budget')
            ? '1. Increase budget: `hivemind mayday --resume --budget 50`\n2. Or use lean mode: `hivemind mayday --lean --resume`'
            : mayday.error?.includes('Max fix iterations')
              ? '1. Review test failures and fix manually.\n2. Resume with more iterations: `hivemind mayday --resume --max-iterations 10`'
              : '1. Check the error above and the stage that failed.\n2. Fix the issue manually, then `hivemind mayday --resume`.',
        '',
      ].join('\n');

      const reportPath = join(this.projectCwd, 'FAILURE-REPORT.md');
      writeFileSync(reportPath, report);
      console.log(chalk.yellow(`[mayday] Failure report saved to FAILURE-REPORT.md`));
    } catch {
      // Non-critical — don't crash on report generation failure
    }
  }

  /**
   * Validate that required artifacts exist when skipping stages via --from.
   * Each stage depends on artifacts from prior stages.
   */
  private validateSkippedArtifacts(fromStage: StageName): void {
    const stages: StageName[] = ['analyze', 'architect', 'plan', 'build'];
    const fromIdx = stages.indexOf(fromStage);

    // Check that all artifacts from stages before fromStage exist
    for (let i = 0; i < fromIdx; i++) {
      const stage = stages[i];
      const artifact = STAGE_ARTIFACT_MAP[stage];
      if (artifact && !existsSync(join(this.projectCwd, artifact))) {
        throw new Error(
          `Cannot skip to "${fromStage}": required artifact "${artifact}" from "${stage}" stage not found. ` +
          `Run the earlier stages first or provide the artifact manually.`
        );
      }
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
    const configPath = join(this.projectCwd, '.swarm', 'playwright.config.yaml');
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
    fromStage?: StageName;
    approvalRequired?: boolean;
    /** When true, skip all interactive pauses (for CI/automation/dashboard) */
    headless?: boolean;
  } = {}): Promise<void> {
    if (this.state.getMayday()?.active) {
      throw new Error('MayDay pipeline is already running. Use --resume to continue or stop it first.');
    }

    const stack = opts.stack ?? this.config.stack;
    const maxIterations = opts.maxIterations ?? 5;

    // Apply model override for the entire mayday run
    if (opts.model) {
      this.config.model = opts.model;
    }

    // Validate fromStage if provided
    const fromStage = opts.fromStage;
    if (fromStage) {
      const validStages: StageName[] = ['analyze', 'architect', 'plan', 'build', 'validate', 'ship'];
      if (!validStages.includes(fromStage)) {
        throw new Error(`Invalid --from stage: "${fromStage}". Must be one of: ${validStages.join(', ')}`);
      }
      // Validate that required artifacts exist for skipped stages
      this.validateSkippedArtifacts(fromStage);
    }

    const mayday: MaydayState = {
      active: true,
      featureRequest,
      currentStage: fromStage ?? 'analyze',
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
      approvalRequired: opts.approvalRequired ?? false,
      pendingApproval: null,
    };

    this.state.setMayday(mayday);

    // Mark skipped stages
    if (fromStage) {
      const stages: StageName[] = ['analyze', 'architect', 'plan', 'build', 'validate', 'ship'];
      const fromIdx = stages.indexOf(fromStage);
      for (let i = 0; i < fromIdx; i++) {
        this.state.updateStage(stages[i], { status: 'skipped' });
      }
      console.log(chalk.dim(`Skipping stages before "${fromStage}"`));
    }

    console.log(chalk.bold(`\nSwarm Pipeline — building your feature`));
    console.log(chalk.dim(`Feature: ${featureRequest}`));
    console.log(chalk.dim(`Model: ${this.config.model} | Budget: ${this.config.maxBudgetUsd ? '$' + this.config.maxBudgetUsd : 'unlimited'} | Max fix iterations: ${maxIterations}\n`));

    const pipelineStart = Date.now();

    const headless = opts.headless ?? false;

    try {
      await this.executeMaydayPipeline(stack, opts.parallel, headless);
      this.state.archiveRun();
      this.attemptAutoCreatePR();
      this.webhooks.maydayComplete(this.config.projectName, this.state.getState()).catch(() => {});
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.state.updateMayday({ active: false, error: errMsg });
      this.generateFailureReport();
      this.state.archiveRun();
      this.webhooks.maydayError(this.config.projectName, errMsg).catch(() => {});
      throw err;
    }

    // Print summary
    const totalElapsed = Date.now() - pipelineStart;
    const pipelineState = this.state.getState();
    const totalCost = pipelineState.totalCost.totalUsd;
    const elapsedMin = (totalElapsed / 60000).toFixed(1);
    console.log(chalk.bold(`\nPipeline complete`));
    console.log(chalk.dim(`  Total time: ${elapsedMin}m | Total cost: $${totalCost.toFixed(2)}`));

    // Quality scores summary
    const scores = pipelineState.qualityScores ?? [];
    if (scores.length > 0) {
      const avgScore = Math.round(scores.reduce((sum, s) => sum + s.overall, 0) / scores.length);
      const color = avgScore >= 80 ? chalk.green : avgScore >= 50 ? chalk.yellow : chalk.red;
      console.log(`  Quality: ${color(`${avgScore}/100`)}` + chalk.dim(` (${scores.map(s => `${s.artifact}: ${s.overall}`).join(', ')})`));
    }

    console.log(chalk.dim(`  Run ${chalk.bold('hivemind status')} to see details or ${chalk.bold('hivemind dashboard')} to view in browser\n`));
  }

  async resumeMayday(opts: { parallel?: number; headless?: boolean } = {}): Promise<void> {
    const mayday = this.state.getMayday();
    if (!mayday || !mayday.active) {
      throw new Error('No active MayDay session to resume.');
    }

    const stack = this.state.getState().stack;
    this.state.updateMayday({ pausedAt: null });

    console.log(chalk.bold(`\nSwarm Pipeline — resuming from ${mayday.currentStage}`));
    if (mayday.currentStage === 'fix-loop') {
      console.log(chalk.dim(`Fix iteration: ${mayday.fixIteration}/${mayday.maxFixIterations}`));
    }
    console.log('');

    try {
      await this.executeMaydayPipeline(stack, opts.parallel, opts.headless ?? false);
      this.state.archiveRun();
      this.attemptAutoCreatePR();
      this.webhooks.maydayComplete(this.config.projectName, this.state.getState()).catch(() => {});
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.state.updateMayday({ active: false, error: errMsg });
      this.state.archiveRun();
      this.webhooks.maydayError(this.config.projectName, errMsg).catch(() => {});
      throw err;
    }
  }

  private async executeMaydayPipeline(stack: TechStack, parallel?: number, headless = false): Promise<void> {
    const mayday = this.state.getMayday()!;
    const stageOpts: StageOpts = { stack, interactive: false, figmaUrl: mayday.figmaUrl, headless };

    // Create a feature branch for this mayday run
    this.createFeatureBranch(mayday.featureRequest);

    // Check for custom pipeline definition
    const swarmDir = join(this.projectCwd, '.swarm');
    const customDef = loadPipelineDefinition(swarmDir);

    if (customDef) {
      console.log(chalk.cyan(`[mayday] Using custom pipeline definition (${customDef.stages.length} stages)`));
      await this.runCustomPipeline(customDef, mayday.featureRequest, {
        stack,
        interactive: false,
        figmaUrl: mayday.figmaUrl,
        parallel,
      });
      // After custom pipeline, enter fix loop
      await this.maydayFixLoop(stack, parallel, headless);
      return;
    }

    // Pipeline stages in order — resume from currentStage
    const stages: StageName[] = ['analyze', 'architect', 'plan', 'build', 'validate', 'ship'];
    const startIdx = stages.indexOf(mayday.currentStage as StageName);

    const STAGE_LABELS: Record<string, string> = {
      analyze: 'Analyzing requirements',
      architect: 'Designing architecture',
      plan: 'Planning tasks',
      build: 'Building code',
      validate: 'Validating build',
      ship: 'Shipping to production',
    };

    // Run pipeline stages (or resume from where we left off)
    if (startIdx >= 0) {
      for (let i = startIdx; i < stages.length; i++) {
        const stage = stages[i];

        // Check if mayday was stopped
        if (!this.state.getMayday()?.active) {
          console.log(chalk.yellow(`\nStopped by user.`));
          return;
        }

        // Skip already-completed stages (preserved across restarts)
        const existingStage = this.state.getState().stages[stage];
        if (existingStage.status === 'done') {
          console.log(chalk.dim(`  [${i + 1}/${stages.length}] ${STAGE_LABELS[stage] || stage}... (preserved)`));
          continue;
        }

        // Try to resume interrupted stage via session if available
        const canResume = existingStage.status === 'error'
          && existingStage.sessionId
          && existingStage.finishedAt
          && (Date.now() - existingStage.finishedAt) < 24 * 60 * 60 * 1000; // < 24h old

        // Consume any queued user messages and log them
        const userMsgs = this.state.consumeMaydayMessages();
        if (userMsgs.length > 0) {
          console.log(chalk.magenta(`  User guidance: ${userMsgs.join(' | ')}`));
        }

        this.state.updateMayday({ currentStage: stage });
        const stageNum = i + 1;
        const stageLabel = STAGE_LABELS[stage] || stage;
        const costBefore = this.state.getState().totalCost.totalUsd;
        const stageStart = Date.now();

        if (canResume) {
          process.stdout.write(chalk.cyan(`  [${stageNum}/${stages.length}] ${stageLabel} (resuming session)...`));
          // Prepend context from prior stages to the resume prompt
          const resumeContext = this.state.getResumeContext(stage);
          const resumePrompt = resumeContext
            ? `${resumeContext}\nPlease continue where you left off.`
            : 'Please continue where you left off.';

          const resumed = await this.agentManager.resumeSession({
            sessionId: existingStage.sessionId!,
            name: `${stage}-resume`,
            persona: stage === 'analyze' ? 'analyst' : stage === 'architect' ? 'architect' : stage === 'plan' ? 'lead' : 'engineer',
            stack,
            prompt: resumePrompt,
            cwd: this.projectCwd,
            permissionMode: 'auto',
          });

          if (resumed && resumed.status === 'done') {
            // Resume succeeded — mark stage done
            const artifact = STAGE_ARTIFACT_MAP[stage];
            if (artifact && existsSync(join(this.projectCwd, artifact))) {
              await this.finishStage(stage, artifact);
            } else {
              this.state.updateStage(stage, { status: 'done', finishedAt: Date.now() });
            }
            const stageElapsed = Date.now() - stageStart;
            const stageCost = this.state.getState().totalCost.totalUsd - costBefore;
            this.state.updateStage(stage, { stageCost });
            console.log(chalk.dim(` (${(stageElapsed / 1000).toFixed(0)}s, $${stageCost.toFixed(2)})`));
            continue;
          }
          // Resume failed — fall through to fresh start
          console.log(chalk.yellow(` session expired, starting fresh...`));
        }

        process.stdout.write(chalk.cyan(`  [${stageNum}/${stages.length}] ${stageLabel}...`));

        // Prepend context summaries from completed prior stages to fresh-start prompts
        const priorContext = this.state.getResumeContext(stage);

        // Backward context flow: collect failure reasons from downstream stages
        const failureCtx = Array.from(this.stageFailureContext.entries())
          .map(([s, msg]) => `[${s}] ${msg}`)
          .join('\n');
        const backwardContext = failureCtx ? `\n\n## Prior Failure Context (avoid these issues):\n${failureCtx}` : '';

        await this.runStageWithRetry(stage, async () => {
          switch (stage) {
            case 'analyze':
              await this.runAnalyze(mayday.featureRequest, stageOpts);
              break;
            case 'architect':
              await this.runArchitect({ ...stageOpts, prompt: backwardContext || undefined });
              break;
            case 'plan': {
              const guidance = userMsgs.length > 0 ? userMsgs.join('\n') : undefined;
              const combined = [priorContext, guidance, backwardContext].filter(Boolean).join('\n');
              await this.runPlan({ ...stageOpts, prompt: combined || undefined });
              break;
            }
            case 'build':
              await this.runBuild({ stack, parallel: parallel ?? 3 });
              break;
            case 'validate':
              await this.runValidate();
              break;
            case 'ship':
              await this.runShip();
              break;
          }
        });

        // Log stage completion with elapsed time and cost
        const stageElapsed = Date.now() - stageStart;
        const stageCost = this.state.getState().totalCost.totalUsd - costBefore;
        this.state.updateStage(stage, { stageCost });
        const elapsedStr = stageElapsed < 60000
          ? `${(stageElapsed / 1000).toFixed(0)}s`
          : `${(stageElapsed / 60000).toFixed(1)}m`;
        console.log(chalk.green(` done`) + chalk.dim(` (${elapsedStr}, $${stageCost.toFixed(2)})`));

        // Auto-commit after each stage completes
        this.autoCommitStage(stage, STAGE_ARTIFACT_MAP[stage]);

        // Stage transition pause — let user review and optionally send feedback
        if (!headless && i < stages.length - 1) {
          const nextStage = stages[i + 1];
          const feedback = await stageTransitionPause(stage, nextStage, STAGE_ARTIFACT_MAP[stage]);
          if (feedback) {
            // Inject user feedback as a message for the next stage
            this.state.pushMaydayMessage(feedback);
            console.log(chalk.magenta(`  Feedback noted — will be included in ${nextStage} stage.`));
          }
        }

        // Approval gate: pause and wait for user approval before proceeding
        const currentMayday = this.state.getMayday();
        if (currentMayday?.approvalRequired && i < stages.length - 1) {
          this.state.updateMayday({
            pendingApproval: { stage, requestedAt: Date.now() },
          });
          console.log(chalk.yellow(`[mayday] Waiting for approval to proceed past ${stage}...`));

          // Poll until pendingApproval is cleared or mayday becomes inactive
          while (true) {
            await sleep(500);
            const m = this.state.getMayday();
            if (!m?.active) {
              console.log(chalk.yellow(`\n[mayday] Rejected or stopped during approval.`));
              return;
            }
            if (!m.pendingApproval) {
              console.log(chalk.green(`[mayday] Approval granted — continuing pipeline.`));
              break;
            }
          }
        }
      }
    }

    // After initial pipeline, enter the fix-retest loop
    await this.maydayFixLoop(stack, parallel, headless);
  }

  private async maydayFixLoop(stack: TechStack, _parallel?: number, headless = false): Promise<void> {
    // Resolve test framework run command for this stack
    const frameworks = getTestFrameworks(stack);
    const testRunCmd = frameworks[0]?.runCmd ?? 'npx playwright test';

    // Evaluate initial test results
    let testResults = this.evaluateTestResults();
    const fixHistory: import('../types.js').FixHistoryEntry[] =
      this.state.getMayday()?.fixHistory ?? [];

    this.state.updateMayday({
      currentStage: 'fix-loop',
      lastTestPassed: testResults.passed,
      lastTestOutput: testResults.output,
      failureCount: testResults.failureCount,
      fixHistory,
    });

    if (testResults.passed) {
      console.log(chalk.green.bold(`\n  All tests passed on first run!`));
      this.state.updateMayday({ active: false, currentStage: 'complete' });
      this.recordSuccessMemory(0);
      return;
    }

    const mayday = this.state.getMayday()!;
    const maxIter = mayday.maxFixIterations;
    let previousFailedTests = testResults.failures.map(f => f.testName);
    let stuckCount = 0;

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
        this.generateFailureReport();
        return;
      }

      this.state.updateMayday({ fixIteration: iteration, currentStage: 'fix-loop' });

      console.log(chalk.red(`\n[mayday] Fix iteration ${iteration}/${maxIter} — ${testResults.failureCount} failure(s)`));

      // Interactive pause — let user guide the fix or skip
      if (!headless) {
        const fixPause = await fixLoopPause(iteration, maxIter, testResults.failureCount ?? 0);
        if (fixPause.action === 'skip') {
          console.log(chalk.yellow(`[mayday] Skipping remaining fix iterations.`));
          break;
        }
        if (fixPause.feedback) {
          this.state.pushMaydayMessage(fixPause.feedback);
        }
      }

      // Consume user messages for guidance
      const userMsgs = this.state.consumeMaydayMessages();

      // Group failures by file for targeted fixing (I1)
      const failureGroups = this.groupFailuresByFile(testResults.failures);

      // Determine approach via strategy escalation (I2 — stuck detection)
      let approach = 'standard';
      if (stuckCount >= 4) {
        approach = 'simplify';
        console.log(chalk.yellow(`[mayday] Stuck for ${stuckCount} iterations — escalating to SIMPLIFY (reduce scope to pass tests)`));
      } else if (stuckCount >= 3) {
        approach = 'rewrite';
        console.log(chalk.yellow(`[mayday] Stuck for ${stuckCount} iterations — escalating to REWRITE affected components`));
      } else if (stuckCount >= 2) {
        approach = 'broader-context';
        console.log(chalk.yellow(`[mayday] Stuck on same failures for ${stuckCount} iterations — trying broader context approach`));
      }

      // Spawn fix agents — one per failure group if multiple, or one for all
      const fixAgentIds: string[] = [];
      if (failureGroups.length > 1 && approach === 'standard') {
        console.log(chalk.cyan(`[mayday] Spawning ${failureGroups.length} targeted fix agents...`));
        const fixAgents = await Promise.all(
          failureGroups.map((group, idx) =>
            this.agentManager.spawn({
              name: `fix-engineer-${iteration}-g${idx + 1}`,
              persona: 'engineer',
              stack,
              prompt: this.buildTargetedFixPrompt(group, fixHistory, userMsgs, testRunCmd),
              model: this.modelFor('engineer'),
              cwd: this.projectCwd,
              interactive: false,
              permissionMode: 'auto',
              appendSystemPrompt: this.getEngineerConventions(),
            }),
          ),
        );

        for (const a of fixAgents) fixAgentIds.push(a.id);
        await Promise.allSettled(fixAgents.map(a => this.waitForAgentWithBudgetCheck(a.id)));

        const totalFixCost = fixAgents.reduce((sum, a) => sum + a.cost.totalUsd, 0);
        console.log(chalk.green(`[mayday] ${fixAgents.length} fix agents done. Cost: $${totalFixCost.toFixed(4)}`));
      } else {
        // Single fix agent for all failures
        const fixPrompt = this.buildFixPrompt(testResults, userMsgs, fixHistory, approach, testRunCmd);
        const fixAgent = await this.agentManager.spawn({
          name: `fix-engineer-${iteration}`,
          persona: 'engineer',
          stack,
          prompt: fixPrompt,
          model: this.modelFor('engineer'),
          cwd: this.projectCwd,
          interactive: false,
          permissionMode: 'auto',
          appendSystemPrompt: this.getEngineerConventions(),
        });

        fixAgentIds.push(fixAgent.id);
        await this.waitForAgentWithBudgetCheck(fixAgent.id);
        console.log(chalk.green(`[mayday] Fix engineer done. Cost: $${fixAgent.cost.totalUsd.toFixed(4)}`));
      }

      this.state.updateMayday({
        fixAgentIds: [...(this.state.getMayday()?.fixAgentIds ?? []), ...fixAgentIds],
      });

      // Re-run tests
      console.log(chalk.red(`[mayday] Re-running tests...`));
      this.state.updateStage('test', { status: 'pending' });
      await this.runTest({ stack });

      // Evaluate results
      const newTestResults = this.evaluateTestResults();
      const currentFailedTests = newTestResults.failures.map(f => f.testName);

      // I2: Regression detection
      const fixedTests = previousFailedTests.filter(t => !currentFailedTests.includes(t));
      const newFailures = currentFailedTests.filter(t => !previousFailedTests.includes(t));
      const sameFailures = currentFailedTests.filter(t => previousFailedTests.includes(t));

      if (newFailures.length > 0) {
        console.log(chalk.yellow(`[mayday] ⚠ Regressions detected: ${newFailures.length} new failure(s)`));
      }
      if (fixedTests.length > 0) {
        console.log(chalk.green(`[mayday] Fixed: ${fixedTests.length} test(s)`));
      }
      if (sameFailures.length > 0 && sameFailures.length === previousFailedTests.length) {
        stuckCount++;
        console.log(chalk.yellow(`[mayday] Same failures persisting (stuck count: ${stuckCount})`));
      } else {
        stuckCount = 0; // Reset if any progress
      }

      // I3: Record fix history
      const historyEntry: import('../types.js').FixHistoryEntry = {
        iteration,
        failedTests: previousFailedTests,
        fixedTests,
        newFailures,
        approach,
        agentId: fixAgentIds[0],
        cost: this.state.getState().agents
          .filter(a => fixAgentIds.includes(a.id))
          .reduce((sum, a) => sum + a.cost.totalUsd, 0),
        timestamp: Date.now(),
      };
      fixHistory.push(historyEntry);

      testResults = newTestResults;
      previousFailedTests = currentFailedTests;

      this.state.updateMayday({
        lastTestPassed: testResults.passed,
        lastTestOutput: testResults.output,
        failureCount: testResults.failureCount,
        fixHistory,
      });

      if (testResults.passed) {
        console.log(chalk.green.bold(`\n  All tests passed after ${iteration} fix iteration(s)!`));
        this.state.updateMayday({ active: false, currentStage: 'complete' });
        this.recordSuccessMemory(iteration);
        return;
      }

      // If stuck for 5+ iterations (all strategies exhausted), abort
      if (stuckCount >= 5) {
        console.log(chalk.red.bold(`\n[mayday] Stuck on same failures for ${stuckCount} iterations (all strategies exhausted). Aborting fix loop.`));
        const stuckError = `Stuck: same ${currentFailedTests.length} test(s) failing for ${stuckCount} iterations despite strategy escalation (standard → broader-context → rewrite → simplify).`;
        this.state.updateMayday({
          active: false,
          currentStage: 'complete',
          error: stuckError,
        });
        this.generateFailureReport();
        this.recordFailureMemory('fix-loop', stuckError, fixHistory);
        return;
      }
    }

    // Max iterations reached
    const maxIterError = `Max fix iterations reached. ${testResults.failureCount} test(s) still failing.`;
    console.log(chalk.yellow.bold(`\n[mayday] ${maxIterError}`));
    this.state.updateMayday({
      active: false,
      currentStage: 'complete',
      error: maxIterError,
    });
    this.generateFailureReport();
    this.recordFailureMemory('fix-loop', maxIterError, fixHistory);
  }

  /** Record a successful pipeline run to memory */
  private recordSuccessMemory(fixIterations: number): void {
    try {
      const mayday = this.state.getMayday();
      const pState = this.state.getState();
      const stages = Object.entries(pState.stages)
        .filter(([, s]) => s.status === 'done')
        .map(([name, s]) => ({
          name,
          cost: s.stageCost ?? 0,
          durationMs: (s.finishedAt ?? 0) - (s.startedAt ?? 0),
        }));

      recordPipelineSuccess(this.memoryStore, {
        featureRequest: mayday?.featureRequest ?? 'unknown',
        totalCost: pState.totalCost.totalUsd,
        durationMs: Date.now() - (mayday?.startedAt ?? Date.now()),
        fixIterations,
        stages,
      });
    } catch { /* non-critical */ }
  }

  /** Record a failed pipeline run to memory */
  private recordFailureMemory(failedStage: string, error: string, fixHistory?: import('../types.js').FixHistoryEntry[]): void {
    try {
      const mayday = this.state.getMayday();
      recordPipelineFailure(this.memoryStore, {
        featureRequest: mayday?.featureRequest ?? 'unknown',
        failedStage,
        error,
        fixHistory: fixHistory?.map(h => ({ approach: h.approach, failedTests: h.failedTests })),
      });
    } catch { /* non-critical */ }
  }

  /** Group test failures by source file for targeted fixing (I1) */
  private groupFailuresByFile(failures: TestFailure[]): Array<{ file: string; failures: TestFailure[] }> {
    if (failures.length === 0) return [];
    const groups = new Map<string, TestFailure[]>();
    for (const f of failures) {
      const key = f.file || 'unknown';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(f);
    }
    return Array.from(groups.entries()).map(([file, failures]) => ({ file, failures }));
  }

  /** Build a targeted fix prompt for a specific failure group */
  private buildTargetedFixPrompt(
    group: { file: string; failures: TestFailure[] },
    history: import('../types.js').FixHistoryEntry[],
    userMessages: string[],
    testRunCmd?: string,
  ): string {
    const parts = [
      `You are a BUG FIX ENGINEER. Fix the ${group.failures.length} failing test(s) in ${group.file}.`,
      '',
      '## Failures:',
      ...group.failures.map(f => `- **${f.testName}**: ${f.error.slice(0, 300)}`),
    ];

    if (history.length > 0) {
      parts.push(
        '',
        '## Fix History (what was already tried):',
        ...history.slice(-3).map(h =>
          `- Iteration ${h.iteration} (${h.approach}): fixed ${h.fixedTests.length}, regressed ${h.newFailures.length}`,
        ),
      );
    }

    if (userMessages.length > 0) {
      parts.push('', '## User Guidance:', ...userMessages.map(m => `- ${m}`));
    }

    parts.push(
      '',
      '## Rules:',
      '- Read the failing test files to understand what is expected',
      '- Fix the APPLICATION code (not the tests, unless the test itself is clearly wrong)',
      '- Do NOT break passing tests',
      `- Run \`${testRunCmd ?? 'npx playwright test'}\` after fixing to verify`,
      '- Focus only on these specific failures. Do not refactor unrelated code.',
    );

    return parts.join('\n');
  }

  private buildFixPrompt(
    testResults: TestEvaluation,
    userMessages: string[],
    history: import('../types.js').FixHistoryEntry[] = [],
    approach = 'standard',
    testRunCmd?: string,
  ): string {
    const parts = [
      'You are a BUG FIX ENGINEER. Tests are failing after a build. Fix the bugs.',
    ];

    if (approach === 'broader-context') {
      parts.push(
        '',
        '⚠️ STRATEGY: BROADER CONTEXT — Previous standard fixes did not work.',
        'Try a DIFFERENT approach: read more surrounding code, check imports/types carefully,',
        'trace the full data flow, or consider that the test expectations may need updating.',
      );
    } else if (approach === 'rewrite') {
      parts.push(
        '',
        '⚠️ STRATEGY: REWRITE — Standard and broader-context approaches have BOTH failed.',
        'Consider a COMPREHENSIVE REWRITE of the failing components:',
        '- Delete and rewrite the affected functions/modules from scratch',
        '- Re-examine the approach — maybe a different algorithm or pattern is needed',
        '- Check if test expectations match the requirements (tests may need updating too)',
        '- Do NOT try incremental patches — those have already failed repeatedly.',
      );
    } else if (approach === 'simplify') {
      parts.push(
        '',
        '⚠️ STRATEGY: SIMPLIFY — All previous approaches have failed. Last resort.',
        'REDUCE SCOPE to get tests passing:',
        '- Implement the minimum viable version that satisfies the test assertions',
        '- Stub out complex features that are causing failures',
        '- Remove edge-case handling that introduces bugs',
        '- The goal is now: MAKE TESTS PASS, even with simplified functionality.',
        '- If a test is testing unimplemented behavior, mark the test as skipped with a TODO comment.',
      );
    }

    // Use structured failures if available
    if (testResults.failures.length > 0) {
      parts.push(
        '',
        '## Specific Failures:',
        ...testResults.failures.map(f =>
          `- **${f.testName}** (${f.file}): ${f.error.slice(0, 300)}`,
        ),
      );
    }

    parts.push(
      '',
      '## Test Output (last run):',
      '```',
      testResults.output?.slice(-3000) ?? 'No test output captured.',
      '```',
      '',
      `Summary: ${testResults.summary}`,
    );

    // I3: Include fix history so agent knows what was tried
    if (history.length > 0) {
      parts.push(
        '',
        '## Fix History (what was already tried — do NOT repeat the same approach):',
        ...history.slice(-5).map(h =>
          `- Iteration ${h.iteration} (${h.approach}): fixed=[${h.fixedTests.join(', ')}], new_failures=[${h.newFailures.join(', ')}]`,
        ),
      );
    }

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
      `- Run \`${testRunCmd ?? 'npx playwright test'}\` after fixing to verify`,
      '- If you cannot fix a bug, document why in a code comment',
      '- Focus only on the failures. Do not refactor unrelated code.',
    );

    return parts.join('\n');
  }

  private evaluateTestResults(): TestEvaluation {
    // 1. Try structured JSON results first
    const jsonPath = join(this.projectCwd, '.swarm', 'test-results.json');
    if (existsSync(jsonPath)) {
      try {
        const raw = readFileSync(jsonPath, 'utf-8');
        try {
          // Try standard JSON parse first
          const json = JSON.parse(raw);
          return this.parseStructuredTestResults(json);
        } catch {
          // Might be NDJSON (go test -json) — parse as string
          return this.parseGoTestJson(raw);
        }
      } catch {
        // File read failed — fall through to regex
      }
    }

    // Also check .swarm/test-results.txt for frameworks that don't produce JSON
    const txtPath = join(this.projectCwd, '.swarm', 'test-results.txt');
    if (existsSync(txtPath)) {
      try {
        const raw = readFileSync(txtPath, 'utf-8');
        return this.parseTestOutputRegex(raw);
      } catch { /* fall through */ }
    }

    // 2. Fall back to regex parsing of agent output
    const agents = this.state.getState().agents;
    const testRunner = [...agents]
      .reverse()
      .find((a) => a.name.startsWith('test-runner-'));

    if (!testRunner) {
      return { passed: false, failureCount: null, failures: [], summary: 'No test runner output found.', output: null };
    }

    return this.parseTestOutputRegex(testRunner.output);
  }

  /** Parse structured test results JSON — auto-detects format (Playwright, Vitest, go test, pytest) */
  private parseStructuredTestResults(json: unknown): TestEvaluation {
    // Detect format and dispatch
    if (typeof json === 'object' && json !== null) {
      const obj = json as Record<string, unknown>;

      // Playwright: has `suites` array at top level
      if (Array.isArray(obj.suites)) {
        return this.parsePlaywrightJson(obj);
      }

      // Vitest: has `testResults` array (Vitest JSON reporter)
      if (Array.isArray(obj.testResults)) {
        return this.parseVitestJson(obj);
      }

      // pytest-json-report: has `tests` array and `summary`
      if (Array.isArray(obj.tests) && obj.summary) {
        return this.parsePytestJson(obj);
      }
    }

    // go test -json: NDJSON lines (each line is an object with Action/Test/Output)
    if (typeof json === 'string') {
      return this.parseGoTestJson(json);
    }

    // If it's already parsed as an array of NDJSON objects
    if (Array.isArray(json)) {
      return this.parseGoTestJsonLines(json as Array<Record<string, unknown>>);
    }

    return { passed: false, failureCount: null, failures: [], summary: 'Unknown JSON test results format', output: null };
  }

  /** Parse Playwright JSON reporter output */
  private parsePlaywrightJson(json: Record<string, unknown>): TestEvaluation {
    const failures: TestFailure[] = [];
    let passedCount = 0;
    let failedCount = 0;

    const walkSpecs = (specs: Array<Record<string, unknown>>) => {
      for (const spec of specs) {
        const tests = spec.tests as Array<Record<string, unknown>> | undefined;
        if (!tests) continue;
        for (const test of tests) {
          const results = test.results as Array<Record<string, unknown>> | undefined;
          if (!results || results.length === 0) continue;
          const lastResult = results[results.length - 1];
          const status = lastResult.status as string;
          if (status === 'passed') {
            passedCount++;
          } else if (status === 'failed' || status === 'timedOut') {
            failedCount++;
            const errorMsg = lastResult.error
              ? (lastResult.error as Record<string, unknown>).message as string ?? ''
              : '';
            failures.push({
              testName: `${spec.title ?? ''} > ${test.title ?? ''}`.trim(),
              file: spec.file as string ?? '',
              error: errorMsg.slice(0, 500),
            });
          }
        }
      }
    };

    const walkSuites = (suiteList: Array<Record<string, unknown>>) => {
      for (const suite of suiteList) {
        const specs = suite.specs as Array<Record<string, unknown>> | undefined;
        if (specs) walkSpecs(specs);
        const childSuites = suite.suites as Array<Record<string, unknown>> | undefined;
        if (childSuites) walkSuites(childSuites);
      }
    };

    walkSuites(json.suites as Array<Record<string, unknown>>);

    const passed = failedCount === 0 && passedCount > 0;
    const summary = `${passedCount} passed, ${failedCount} failed (Playwright JSON)`;
    const output = failures.length > 0
      ? failures.map(f => `FAIL: ${f.testName}\n  File: ${f.file}\n  Error: ${f.error}`).join('\n\n')
      : `All ${passedCount} tests passed.`;

    return { passed, failureCount: failedCount, failures, summary, output };
  }

  /** Parse Vitest JSON reporter output */
  private parseVitestJson(json: Record<string, unknown>): TestEvaluation {
    const failures: TestFailure[] = [];
    let passedCount = 0;
    let failedCount = 0;

    const testResults = json.testResults as Array<Record<string, unknown>> | undefined;
    if (!testResults) {
      return { passed: false, failureCount: null, failures: [], summary: 'Empty Vitest results', output: null };
    }

    for (const suite of testResults) {
      const assertionResults = suite.assertionResults as Array<Record<string, unknown>> | undefined;
      if (!assertionResults) continue;

      for (const test of assertionResults) {
        const status = test.status as string;
        if (status === 'passed') {
          passedCount++;
        } else if (status === 'failed') {
          failedCount++;
          const msgs = test.failureMessages as string[] | undefined;
          failures.push({
            testName: (test.fullName ?? test.title ?? 'unknown') as string,
            file: (suite.name ?? '') as string,
            error: (msgs?.[0] ?? '').slice(0, 500),
          });
        }
      }
    }

    const passed = failedCount === 0 && passedCount > 0;
    const summary = `${passedCount} passed, ${failedCount} failed (Vitest JSON)`;
    const output = failures.length > 0
      ? failures.map(f => `FAIL: ${f.testName}\n  File: ${f.file}\n  Error: ${f.error}`).join('\n\n')
      : `All ${passedCount} tests passed.`;

    return { passed, failureCount: failedCount, failures, summary, output };
  }

  /** Parse pytest-json-report output */
  private parsePytestJson(json: Record<string, unknown>): TestEvaluation {
    const failures: TestFailure[] = [];
    let passedCount = 0;
    let failedCount = 0;

    const tests = json.tests as Array<Record<string, unknown>> | undefined;
    if (!tests) {
      return { passed: false, failureCount: null, failures: [], summary: 'Empty pytest results', output: null };
    }

    for (const test of tests) {
      const outcome = test.outcome as string;
      if (outcome === 'passed') {
        passedCount++;
      } else if (outcome === 'failed') {
        failedCount++;
        const call = test.call as Record<string, unknown> | undefined;
        const longrepr = call?.longrepr as string ?? '';
        failures.push({
          testName: (test.nodeid ?? 'unknown') as string,
          file: ((test.nodeid as string) ?? '').split('::')[0] ?? '',
          error: longrepr.slice(0, 500),
        });
      }
    }

    const passed = failedCount === 0 && passedCount > 0;
    const summary = `${passedCount} passed, ${failedCount} failed (pytest JSON)`;
    const output = failures.length > 0
      ? failures.map(f => `FAIL: ${f.testName}\n  File: ${f.file}\n  Error: ${f.error}`).join('\n\n')
      : `All ${passedCount} tests passed.`;

    return { passed, failureCount: failedCount, failures, summary, output };
  }

  /** Parse go test -json NDJSON string */
  private parseGoTestJson(raw: string): TestEvaluation {
    const lines: Array<Record<string, unknown>> = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        lines.push(JSON.parse(line));
      } catch { /* skip non-JSON lines */ }
    }
    return this.parseGoTestJsonLines(lines);
  }

  /** Parse go test -json NDJSON lines */
  private parseGoTestJsonLines(lines: Array<Record<string, unknown>>): TestEvaluation {
    const failures: TestFailure[] = [];
    let passedCount = 0;
    let failedCount = 0;
    const failOutputs = new Map<string, string>();

    for (const line of lines) {
      const action = line.Action as string;
      const testName = line.Test as string;
      const pkg = line.Package as string ?? '';

      if (!testName) continue; // Package-level events

      if (action === 'pass') {
        passedCount++;
      } else if (action === 'fail') {
        failedCount++;
        failures.push({
          testName: `${pkg}/${testName}`,
          file: pkg,
          error: (failOutputs.get(`${pkg}/${testName}`) ?? '').slice(0, 500),
        });
      } else if (action === 'output') {
        const key = `${pkg}/${testName}`;
        const prev = failOutputs.get(key) ?? '';
        failOutputs.set(key, prev + (line.Output as string ?? ''));
      }
    }

    const passed = failedCount === 0 && passedCount > 0;
    const summary = `${passedCount} passed, ${failedCount} failed (go test JSON)`;
    const output = failures.length > 0
      ? failures.map(f => `FAIL: ${f.testName}\n  File: ${f.file}\n  Error: ${f.error}`).join('\n\n')
      : `All ${passedCount} tests passed.`;

    return { passed, failureCount: failedCount, failures, summary, output };
  }

  /** Regex-based fallback for parsing test output */
  private parseTestOutputRegex(output: string): TestEvaluation {
    if (!output) {
      return { passed: false, failureCount: null, failures: [], summary: 'Empty test output.', output: null };
    }

    const passedMatch = output.match(/(\d+)\s+passed/);
    const failedMatch = output.match(/(\d+)\s+failed/);

    const passedCount = passedMatch ? parseInt(passedMatch[1], 10) : 0;
    const failedCount = failedMatch ? parseInt(failedMatch[1], 10) : 0;

    const hasGenericFail = /(?:FAIL|Error:|✗|AssertionError|expect\(.*\)\.to)/i.test(output);

    const passed = failedCount === 0 && !hasGenericFail && passedCount > 0;

    const summary = passedCount > 0 || failedCount > 0
      ? `${passedCount} passed, ${failedCount} failed`
      : hasGenericFail
        ? 'Test failures detected (non-Playwright output)'
        : 'Could not parse test results';

    const truncated = output.length > 5000 ? output.slice(-5000) : output;

    return { passed, failureCount: failedCount || (hasGenericFail ? -1 : 0), failures: [], summary, output: truncated };
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Estimate cost for a pipeline run based on model and number of stages.
   * Returns a { low, high } range in USD.
   */
  static estimateCost(stageCount: number, model: string): { low: number; high: number } {
    const perStage: Record<string, { low: number; high: number }> = {
      opus:   { low: 2,    high: 4 },
      sonnet: { low: 0.5,  high: 1.5 },
      haiku:  { low: 0.1,  high: 0.3 },
    };
    const rates = perStage[model] ?? { low: 1, high: 3 };
    return {
      low:  Math.round(rates.low * stageCount * 100) / 100,
      high: Math.round(rates.high * stageCount * 100) / 100,
    };
  }
}

interface TestFailure {
  testName: string;
  file: string;
  error: string;
}

interface TestEvaluation {
  passed: boolean;
  failureCount: number | null;
  failures: TestFailure[];
  summary: string;
  output: string | null;
}
