import { watch, readFileSync, writeFileSync, existsSync, unlinkSync, copyFileSync, FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { stringify as toYaml, parse as parseYaml } from 'yaml';
import type { WsMessage, WsCommand, PipelineState, PipelineInfo, Persona, AgentActivity } from '../types.js';
import { emptyCost } from '../types.js';
import { StateManager } from './state.js';
import { AgentManager } from './agent-manager.js';
import { Pipeline } from './pipeline.js';
import type { Agent, SwarmConfig, PlaywrightConfig } from '../types.js';

// Non-engineer personas get tool restrictions + system enforcement
const NON_ENGINEER_DISALLOWED_TOOLS = ['Bash', 'Edit', 'NotebookEdit'];

const PERSONA_ENFORCEMENT: Record<string, string> = {
  analyst: [
    'SYSTEM ENFORCEMENT: Your output file MUST be named exactly REQUIREMENTS.md.',
    'SYSTEM ENFORCEMENT: REQUIREMENTS.md MUST contain these sections in order: ## 0. Original Requirement, ## 1. Summary, ## 2. Scope, ## 3. Functional Requirements, ## 4. Data Requirements, ## 5. UI/UX, ## 6. Non-Functional Requirements, ## 7. Integration, ## 8. Testing, ## 9. Rollout, ## 10. Open Questions, ## 11. Change Tracking, ## 12. Appendix.',
    'SYSTEM ENFORCEMENT: Section 3 MUST contain user stories in "As a [user] I want [thing] So that [reason]" format with Given/When/Then acceptance criteria.',
    'SYSTEM ENFORCEMENT: Do NOT write migration plans, decision tables, or free-form documents. Follow the template exactly.',
  ].join('\n'),
  architect: [
    'SYSTEM ENFORCEMENT: Your output file MUST be named exactly SPEC.md.',
    'SYSTEM ENFORCEMENT: SPEC.md MUST contain these sections: ## Overview, ## Requirements Summary, ## Architecture (with Mermaid diagrams), ## Architecture Decision Records, ## Component/Service Architecture, ## Data Model Design, ## API Specification, ## Performance Strategy, ## Testing Strategy, ## Security, ## Implementation Checklist, ## File Structure, ## Open Questions.',
    'SYSTEM ENFORCEMENT: Include ADR entries (ADR-1, ADR-2, etc.) and Mermaid diagrams. Follow the template exactly.',
  ].join('\n'),
  lead: [
    'SYSTEM ENFORCEMENT: Your output file MUST be named exactly TASKS.md.',
    'SYSTEM ENFORCEMENT: Every task MUST follow this format: - [ ] T001 [P] [US1] Description — `file/path.ext`',
    'SYSTEM ENFORCEMENT: One task = one file. Every task has [P] if parallelizable, [USn] user story label, AC: acceptance criteria, and an exact file path.',
    'SYSTEM ENFORCEMENT: Organize into phases: Setup → Foundational (GATE) → User Stories (parallel after gate) → E2E Tests (after stories) → Polish.',
  ].join('\n'),
  tester: [
    'SYSTEM ENFORCEMENT: Your output file MUST be named exactly TESTPLAN.md.',
    'SYSTEM ENFORCEMENT: TESTPLAN.md MUST contain these sections: ## Overview, ## Test Strategy, ## E2E Test Cases, ## Authentication, ## Test Data, ## Acceptance Criteria.',
    'SYSTEM ENFORCEMENT: Every E2E test case MUST have: ID (TC-001), title, user flow steps, expected assertions, and the target test file path under e2e/.',
    'SYSTEM ENFORCEMENT: Do NOT write implementation code. Do NOT modify application source. Only produce TESTPLAN.md.',
  ].join('\n'),
};

/** Ensure all expected stages exist in state loaded from disk (handles schema migrations). */
function migrateState(state: PipelineState): PipelineState {
  const emptyStage = () => ({ status: 'pending' as const, agentIds: [] as string[], artifact: null });
  const expectedStages = ['analyze', 'architect', 'plan', 'build', 'test', 'evaluate'] as const;
  for (const stage of expectedStages) {
    if (!state.stages[stage]) {
      (state.stages as Record<string, unknown>)[stage] = emptyStage();
    }
  }
  // Ensure totalCost exists (old state files may lack it)
  if (!state.totalCost) {
    state.totalCost = { totalUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 0 };
  }
  // Ensure agents have cost objects
  if (state.agents) {
    for (const agent of state.agents) {
      if (!agent.cost) {
        (agent as unknown as Record<string, unknown>).cost = { totalUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 0 };
      }
    }
  }
  // Migrate mayday state — add fields introduced in later versions
  if (state.mayday) {
    const m = state.mayday as unknown as Record<string, unknown>;
    if (m.approvalRequired === undefined) m.approvalRequired = false;
    if (m.pendingApproval === undefined) m.pendingApproval = null;
    if (m.maxFixBudgetUsd === undefined) m.maxFixBudgetUsd = null;
    if (m.fixAgentIds === undefined) m.fixAgentIds = [];
    if (m.userMessages === undefined) m.userMessages = [];
    if (m.failureCount === undefined) m.failureCount = null;
  }
  return state;
}

function isNonEngineer(persona: Persona): boolean {
  return persona === 'analyst' || persona === 'architect' || persona === 'lead' || persona === 'tester';
}

export class SwarmWsServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private fileWatcher: FSWatcher | null = null;
  private lastStateJson = '';
  private pipeline: Pipeline;
  private authToken: string | null = null;

  constructor(
    private state: StateManager,
    private agentManager: AgentManager,
    config: SwarmConfig,
    _projectCwd?: string,
  ) {
    this.pipeline = new Pipeline(agentManager, state, config);

    // Subscribe to in-process state events (for agents spawned via dashboard)
    this.state.on('agent-update', (agent: Agent) => {
      this.broadcast({ type: 'agent-update', payload: agent });
    });

    this.state.on('state-change', () => {
      this.broadcast({ type: 'state', payload: this.state.getState() });
    });

    this.agentManager.on('agent-output', (data: { agentId: string; chunk: string }) => {
      this.broadcast({ type: 'agent-output', payload: data });
    });

    this.agentManager.on('agent-activity', (activity: AgentActivity) => {
      this.broadcast({ type: 'agent-activity', payload: activity });
    });

    // Broadcast errors from agents so dashboard can show them
    this.agentManager.on('agent-error', (agent: Agent) => {
      this.broadcast({ type: 'agent-update', payload: agent });
    });

    this.agentManager.on('agent-done', (agent: Agent) => {
      this.broadcast({ type: 'agent-update', payload: agent });
      // Also broadcast full state to keep costs in sync
      this.broadcast({ type: 'state', payload: this.state.getState() });
    });
  }

  start(port: number, token?: string): void {
    this.authToken = token ?? null;
    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws, req) => {
      // Validate auth token if one was configured
      if (this.authToken) {
        const url = new URL(req.url || '/', `http://localhost:${port}`);
        const clientToken = url.searchParams.get('token');
        if (clientToken !== this.authToken) {
          // Silently reject — avoid log spam from browser reconnect attempts
          ws.close(4001, 'Unauthorized');
          return;
        }
      }

      this.clients.add(ws);

      // Send current state on connect — read fresh from disk
      const freshState = this.readStateFromDisk();
      const currentState = freshState ?? this.state.getState();
      const msg: WsMessage = { type: 'state', payload: currentState };
      ws.send(JSON.stringify(msg));

      // Send historical logs for all agents in state
      this.sendHistoricalLogs(ws, currentState);

      ws.on('message', async (data) => {
        try {
          const cmd: WsCommand = JSON.parse(data.toString());
          await this.handleCommand(cmd, ws);
        } catch (err) {
          // Send error back to the client that sent the command
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[ws] Command error: ${errMsg}`);
          ws.send(JSON.stringify({
            type: 'error' as const,
            payload: { message: errMsg },
          }));
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });

    // Watch state.json for changes from other CLI processes
    this.startFileWatcher();
  }

  private startFileWatcher(): void {
    const stateFile = this.state.getFilePath();
    if (!stateFile || !existsSync(stateFile)) return;

    try {
      this.lastStateJson = readFileSync(stateFile, 'utf-8');
    } catch { /* ignore */ }

    // fs.watch via kqueue on macOS is unreliable — misses writes.
    // Use both fs.watch AND polling to guarantee cross-process updates.
    this.fileWatcher = watch(stateFile, { persistent: false }, () => {
      this.debouncedFileCheck(stateFile);
    });

    // Poll every 1s as fallback for missed fs.watch events
    this.pollTimer = setInterval(() => {
      this.checkFileForChanges(stateFile);
    }, 1000);
  }

  private fileCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private debouncedFileCheck(stateFile: string): void {
    if (this.fileCheckTimer) return;
    this.fileCheckTimer = setTimeout(() => {
      this.fileCheckTimer = null;
      this.checkFileForChanges(stateFile);
    }, 150);
  }

  private checkFileForChanges(stateFile: string): void {
    try {
      const newJson = readFileSync(stateFile, 'utf-8');
      if (newJson === this.lastStateJson) return;
      this.lastStateJson = newJson;

      const newState: PipelineState = migrateState(JSON.parse(newJson));
      // Update the in-memory state so get-state returns fresh data
      this.state.reloadFrom(newState);
      this.broadcast({ type: 'state', payload: newState });
    } catch {
      // File might be mid-write, ignore
    }
  }

  private readStateFromDisk(): PipelineState | null {
    const stateFile = this.state.getFilePath();
    if (!stateFile || !existsSync(stateFile)) return null;
    try {
      const raw = readFileSync(stateFile, 'utf-8');
      return migrateState(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  /** Read .swarm/logs/{agentId}.jsonl files and send historical output/activities to a newly connected client. */
  private sendHistoricalLogs(ws: WebSocket, currentState: PipelineState): void {
    const logsDir = join(this.state.getFilePath(), '..', 'logs');
    if (!existsSync(logsDir)) return;

    for (const agent of currentState.agents) {
      const logPath = join(logsDir, `${agent.id}.jsonl`);
      if (!existsSync(logPath)) continue;

      try {
        const raw = readFileSync(logPath, 'utf-8');
        const lines = raw.split('\n').filter((l) => l.trim());

        let output = '';
        const activities: AgentActivity[] = [];

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.type === 'output' && typeof entry.chunk === 'string') {
              output += entry.chunk;
            } else if (entry.type === 'activity' && entry.activity) {
              activities.push(entry.activity as AgentActivity);
            }
          } catch {
            // Skip malformed lines
          }
        }

        if (output || activities.length > 0) {
          const logMsg: WsMessage = {
            type: 'agent-logs',
            payload: { agentId: agent.id, output, activities },
          };
          ws.send(JSON.stringify(logMsg));
        }
      } catch {
        // Non-critical — skip if file can't be read
      }
    }
  }

  stop(): void {
    this.fileWatcher?.close();
    this.fileWatcher = null;
    if (this.fileCheckTimer) {
      clearTimeout(this.fileCheckTimer);
      this.fileCheckTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
  }

  broadcast(msg: WsMessage): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  private buildPersonaPrompt(persona: Persona, userPrompt?: string): string {
    const task = userPrompt?.trim() || 'Analyze the project and produce your deliverable.';

    const constraints: Record<string, string> = {
      analyst: [
        `Feature request: ${task}`,
        '',
        'CRITICAL: Your ONLY deliverable is REQUIREMENTS.md (exact filename).',
        'Do NOT write code, design architecture, create tasks, or produce any other file.',
        'REQUIREMENTS.md MUST contain sections 0-12: Original Requirement, Summary, Scope,',
        'Functional Requirements (with user stories + Given/When/Then AC), Data Requirements,',
        'UI/UX, Non-Functional Requirements, Integration, Testing, Rollout, Open Questions,',
        'Change Tracking, Appendix. Do NOT skip sections — write N/A if not applicable.',
        'Do NOT write migration plans, decision tables, or free-form documents.',
        'Do NOT ask clarifying questions — you are running autonomously.',
        'Proceed DIRECTLY to writing REQUIREMENTS.md. Make reasonable assumptions where details are missing.',
        'Document assumptions in Section 10 (Open Questions). Once done, STOP.',
      ].join('\n'),
      architect: [
        `Read REQUIREMENTS.md and produce SPEC.md (exact filename).`,
        '',
        `Context: ${task}`,
        '',
        'CRITICAL: Your ONLY deliverable is SPEC.md.',
        'Do NOT write code or create tasks.',
        'SPEC.md MUST contain: Overview, Requirements Summary, Architecture (Mermaid diagrams),',
        'ADRs, Component/Service Architecture, Data Model, API Specification, Performance Strategy,',
        'Testing Strategy, Security, Implementation Checklist, File Structure, Open Questions.',
        'Once done, STOP.',
      ].join('\n'),
      lead: [
        `Read SPEC.md and produce TASKS.md (exact filename).`,
        '',
        `Context: ${task}`,
        '',
        'CRITICAL: Your ONLY deliverable is TASKS.md.',
        'Do NOT write code or redesign architecture.',
        'Format: - [ ] T001 [P] [US1] Description — `file/path.ext`',
        'One task = one file. [P] for parallel tasks. [USn] user story labels.',
        'Phases: Setup → Foundational (GATE) → User Stories (parallel) → E2E Tests (after stories) → Polish.',
        'Once done, STOP.',
      ].join('\n'),
      tester: [
        `Read pipeline artifacts and produce TESTPLAN.md (exact filename).`,
        '',
        `Context: ${task}`,
        '',
        'CRITICAL: Your ONLY deliverable is TESTPLAN.md.',
        'Do NOT write implementation code or test files. Do NOT modify application source.',
        'TESTPLAN.md MUST contain: Overview, Test Strategy, E2E Test Cases (TC-001 format',
        'with steps + assertions + file paths), Authentication, Test Data, Acceptance Criteria.',
        'If Figma URL is provided, derive visual test cases from the designs.',
        'Once done, STOP.',
      ].join('\n'),
      engineer: task,
    };

    return constraints[persona] || task;
  }

  private async handleCommand(cmd: WsCommand, _ws: WebSocket): Promise<void> {
    switch (cmd.action) {
      case 'spawn': {
        const prompt = this.buildPersonaPrompt(cmd.persona, cmd.prompt);

        console.log(`[ws] Spawning agent "${cmd.name}" (${cmd.persona}/${cmd.stack})`);

        const agent = await this.agentManager.spawn({
          name: cmd.name,
          persona: cmd.persona,
          stack: cmd.stack,
          model: cmd.model,
          prompt,
          cwd: this.getEffectiveCwd(),
          interactive: false,
          permissionMode: cmd.permissionMode,
          disallowedTools: isNonEngineer(cmd.persona) ? NON_ENGINEER_DISALLOWED_TOOLS : undefined,
          appendSystemPrompt: PERSONA_ENFORCEMENT[cmd.persona],
        });

        console.log(`[ws] Agent "${cmd.name}" spawned (${agent.id.slice(0, 8)})`);
        break;
      }

      case 'kill':
        console.log(`[ws] Killing agent ${cmd.agentId}`);
        this.agentManager.kill(cmd.agentId);
        break;

      case 'send-input': {
        console.log(`[ws] Sending input to agent ${cmd.agentId}: ${cmd.text.slice(0, 80)}`);
        await this.agentManager.sendInput(cmd.agentId, cmd.text, this.getEffectiveCwd());
        break;
      }

      case 'get-state':
        this.broadcast({ type: 'state', payload: this.state.getState() });
        break;

      case 'run-stage': {
        // Idempotency guard: prevent duplicate spawns for a stage already running
        const currentStageState = this.state.getState().stages[cmd.stage];
        if (currentStageState?.status === 'running') {
          _ws.send(JSON.stringify({
            type: 'error' as const,
            payload: { message: `Stage "${cmd.stage}" is already running` },
          }));
          return;
        }

        const stageStack = this.state.getState().stack;
        const stageOpts = { stack: stageStack, interactive: false };
        if (currentStageState?.status === 'done') {
          this.state.updateStage(cmd.stage as import('../types.js').StageName, { status: 'pending' });
          console.log(`[ws] Reset stage "${cmd.stage}" from done to pending for re-run`);
        }

        console.log(`[ws] Running pipeline stage: ${cmd.stage}`);

        // Run in background — don't block the WS command handler
        (async () => {
          try {
            switch (cmd.stage) {
              case 'analyze':
                if (!cmd.prompt?.trim()) {
                  throw new Error('Analyze stage requires a feature request prompt. Describe what to analyze.');
                }
                await this.pipeline.runAnalyze(cmd.prompt.trim(), { ...stageOpts, figmaUrl: cmd.figmaUrl });
                break;
              case 'architect':
                await this.pipeline.runArchitect(stageOpts);
                break;
              case 'plan':
                await this.pipeline.runPlan({ ...stageOpts, prompt: cmd.prompt?.trim() });
                break;
              case 'build':
                await this.pipeline.runBuild({
                  stack: stageStack,
                  parallel: cmd.parallel ?? 3,
                  taskId: cmd.taskId,
                });
                break;
              case 'test': {
                // Write auth/url config to .swarm/playwright.config.yaml if provided
                if (cmd.baseUrl || cmd.authStorageState) {
                  this.writePlaywrightConfig(cmd.baseUrl, cmd.authStorageState);
                }
                await this.pipeline.runTest({
                  stack: stageStack,
                  parallel: cmd.parallel ?? 2,
                  figmaUrl: cmd.figmaUrl,
                });
                break;
              }
            }
            console.log(`[ws] Pipeline stage "${cmd.stage}" complete`);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(`[ws] Pipeline stage "${cmd.stage}" failed: ${errMsg}`);
          }
        })();
        break;
      }

      case 'run-mayday': {
        // Idempotency guard: prevent concurrent MayDay runs
        if (!cmd.resume && this.state.getMayday()?.active) {
          _ws.send(JSON.stringify({
            type: 'error' as const,
            payload: { message: 'MayDay pipeline is already running. Use resume or stop it first.' },
          }));
          return;
        }

        const stageStack = this.state.getState().stack;

        if (cmd.resume) {
          console.log(`[ws] Resuming MayDay session`);
        } else {
          if (!cmd.prompt?.trim()) {
            throw new Error('MayDay requires a feature request prompt.');
          }
          console.log(`[ws] Starting MayDay: ${cmd.prompt.slice(0, 80)}`);
        }

        (async () => {
          try {
            if (cmd.resume) {
              await this.pipeline.resumeMayday({ parallel: cmd.parallel, headless: true });
            } else {
              await this.pipeline.runMayday(cmd.prompt, {
                stack: stageStack,
                maxIterations: cmd.maxIterations,
                figmaUrl: cmd.figmaUrl,
                parallel: cmd.parallel,
                model: cmd.model,
                maxFixBudgetUsd: cmd.maxFixBudgetUsd !== undefined ? cmd.maxFixBudgetUsd : 15,
                fromStage: cmd.fromStage,
                approvalRequired: cmd.approvalRequired,
                headless: true, // Dashboard runs are always headless (no stdin prompts)
              });
            }
            console.log(`[ws] MayDay complete`);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(`[ws] MayDay failed: ${errMsg}`);
          }
        })();
        break;
      }

      case 'mayday-input': {
        if (!cmd.text?.trim()) break;
        console.log(`[ws] MayDay user input: ${cmd.text.slice(0, 80)}`);
        this.state.pushMaydayMessage(cmd.text.trim());
        break;
      }

      case 'mayday-approve': {
        console.log(`[ws] Approving MayDay stage: ${cmd.stage}`);
        const maydayApprove = this.state.getMayday();
        if (maydayApprove?.active && maydayApprove.pendingApproval) {
          this.state.updateMayday({ pendingApproval: null });
        }
        break;
      }

      case 'mayday-reject': {
        console.log(`[ws] Rejecting MayDay stage: ${cmd.stage}`);
        const maydayReject = this.state.getMayday();
        if (maydayReject?.active) {
          this.state.updateMayday({
            active: false,
            error: cmd.reason || 'Rejected by user',
            pendingApproval: null,
          });
          // Kill all running agents
          for (const agent of this.state.getState().agents) {
            if (agent.status === 'running') {
              this.agentManager.kill(agent.id);
            }
          }
        }
        break;
      }

      case 'mayday-stop': {
        console.log(`[ws] Stopping MayDay`);
        const mayday = this.state.getMayday();
        if (mayday?.active) {
          this.state.updateMayday({ active: false, pausedAt: Date.now() });
          // Kill all running agents
          for (const agent of this.state.getState().agents) {
            if (agent.status === 'running') {
              this.agentManager.kill(agent.id);
            }
          }
        }
        break;
      }

      case 'get-history': {
        const entries = this.state.listHistory();
        const msg: WsMessage = { type: 'history-list', payload: entries };
        _ws.send(JSON.stringify(msg));
        break;
      }

      case 'get-artifact': {
        const stage = cmd.stage;
        const artifactMap: Record<string, string> = {
          analyze: 'REQUIREMENTS.md',
          architect: 'SPEC.md',
          plan: 'TASKS.md',
          test: 'TESTPLAN.md',
        };
        const artifactName = artifactMap[stage];
        let content: string | null = null;
        if (artifactName) {
          const artifactPath = join(this.getEffectiveCwd(), artifactName);
          try {
            content = readFileSync(artifactPath, 'utf-8');
          } catch {
            content = null;
          }
        }
        const artifactMsg: WsMessage = {
          type: 'artifact-content',
          payload: { stage, artifact: artifactName || stage, content },
        };
        _ws.send(JSON.stringify(artifactMsg));
        break;
      }

      case 'list-pipelines': {
        const pipelines = this.buildPipelineList();
        const msg: WsMessage = {
          type: 'pipeline-list',
          payload: { pipelines, active: this.state.getNamespace() },
        };
        _ws.send(JSON.stringify(msg));
        break;
      }

      case 'switch-pipeline': {
        console.log(`[ws] Switching to pipeline: ${cmd.namespace}`);
        this.state.switchTo(cmd.namespace);
        // Ensure worktree exists for non-default pipelines
        if (cmd.namespace !== 'default') {
          this.state.ensureWorktree(cmd.namespace);
        }
        // Broadcast new state to all clients
        this.broadcast({ type: 'state', payload: this.state.getState() });
        // Also send updated pipeline list
        const updatedPipelines = this.buildPipelineList();
        this.broadcast({
          type: 'pipeline-list',
          payload: { pipelines: updatedPipelines, active: cmd.namespace },
        });
        // Re-start file watcher for new state file
        this.restartFileWatcher();
        break;
      }

      case 'create-pipeline': {
        const ns = cmd.namespace;
        if (!ns || ns === 'default') {
          throw new Error('Cannot create a pipeline named "default"');
        }
        const swarmDir = join(this.state.getFilePath(), '..');
        const existing = StateManager.listPipelines(swarmDir);
        if (existing.includes(ns)) {
          throw new Error(`Pipeline "${ns}" already exists`);
        }

        console.log(`[ws] Creating pipeline: ${ns}`);

        // Create new pipeline state
        const newState = new StateManager(swarmDir, ns);
        const currentState = this.state.getState();
        newState.init(currentState.projectName, currentState.stack);

        // Create worktree
        newState.ensureWorktree(ns);

        // Copy artifacts from current pipeline to the new worktree (#4 cross-pipeline artifact copy)
        const sourceCwd = this.state.getProjectCwd();
        const targetCwd = newState.getProjectCwd();
        const artifactFiles = ['REQUIREMENTS.md', 'SPEC.md', 'TASKS.md', 'TESTPLAN.md'];
        for (const file of artifactFiles) {
          const src = join(sourceCwd, file);
          const dst = join(targetCwd, file);
          if (existsSync(src) && !existsSync(dst)) {
            try {
              copyFileSync(src, dst);
              console.log(`[ws] Copied ${file} to pipeline "${ns}"`);
            } catch { /* non-critical */ }
          }
        }

        // Broadcast updated pipeline list
        const createdPipelines = this.buildPipelineList();
        this.broadcast({
          type: 'pipeline-list',
          payload: { pipelines: createdPipelines, active: this.state.getNamespace() },
        });
        break;
      }

      case 'delete-pipeline': {
        const ns = cmd.namespace;
        if (ns === 'default') {
          throw new Error('Cannot delete the default pipeline');
        }

        console.log(`[ws] Deleting pipeline: ${ns}`);

        const swarmDir = join(this.state.getFilePath(), '..');

        // If we're currently on this pipeline, switch to default first
        if (this.state.getNamespace() === ns) {
          this.state.switchTo('default');
          this.restartFileWatcher();
        }

        // Remove worktree and state file
        const tempState = new StateManager(swarmDir, ns);
        tempState.removeWorktree(ns);

        const pipelineFile = join(swarmDir, 'pipelines', `${ns}.json`);
        if (existsSync(pipelineFile)) {
          unlinkSync(pipelineFile);
        }
        const backupFile = pipelineFile + '.bak';
        if (existsSync(backupFile)) {
          unlinkSync(backupFile);
        }

        // Broadcast updated state and pipeline list
        this.broadcast({ type: 'state', payload: this.state.getState() });
        const deletedPipelines = this.buildPipelineList();
        this.broadcast({
          type: 'pipeline-list',
          payload: { pipelines: deletedPipelines, active: this.state.getNamespace() },
        });
        break;
      }
    }
  }

  /** Build PipelineInfo[] from all pipeline state files */
  private buildPipelineList(): PipelineInfo[] {
    const swarmDir = join(this.state.getFilePath(), '..');
    const namespaces = StateManager.listPipelines(swarmDir);
    const pipelines: PipelineInfo[] = [];

    for (const ns of namespaces) {
      try {
        const filePath = ns === 'default'
          ? join(swarmDir, 'state.json')
          : join(swarmDir, 'pipelines', `${ns}.json`);

        if (!existsSync(filePath)) continue;
        const raw = readFileSync(filePath, 'utf-8');
        const pState: PipelineState = JSON.parse(raw);

        // Determine pipeline status
        const stages = Object.values(pState.stages);
        const hasRunning = stages.some(s => s.status === 'running');
        const hasError = stages.some(s => s.status === 'error');
        const allDone = stages.every(s => s.status === 'done' || s.status === 'skipped' || s.status === 'pending');
        const anyDone = stages.some(s => s.status === 'done');

        let status: PipelineInfo['status'] = 'idle';
        if (hasRunning || pState.mayday?.active) status = 'running';
        else if (hasError) status = 'error';
        else if (anyDone && allDone) status = 'complete';

        // Determine current stage
        let currentStage = 'idle';
        if (pState.mayday?.currentStage) {
          currentStage = pState.mayday.currentStage;
        } else {
          const runningStage = Object.entries(pState.stages).find(([, s]) => s.status === 'running');
          if (runningStage) currentStage = runningStage[0];
          else {
            const lastDone = Object.entries(pState.stages)
              .filter(([, s]) => s.status === 'done')
              .pop();
            if (lastDone) currentStage = lastDone[0];
          }
        }

        pipelines.push({
          namespace: ns,
          projectName: pState.projectName,
          currentStage,
          status,
          updatedAt: pState.updatedAt,
          totalCost: pState.totalCost || emptyCost(),
          worktreePath: pState.worktreePath,
        });
      } catch {
        // Skip unreadable pipeline files
      }
    }

    return pipelines.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Restart file watcher after switching pipelines */
  private restartFileWatcher(): void {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
    if (this.fileCheckTimer) {
      clearTimeout(this.fileCheckTimer);
      this.fileCheckTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.startFileWatcher();
  }

  /** Write/merge baseUrl and authStorageState into .swarm/playwright.config.yaml */
  private writePlaywrightConfig(baseUrl?: string, authStorageState?: string): void {
    const configPath = join(this.getEffectiveCwd(), '.swarm', 'playwright.config.yaml');
    let existing: PlaywrightConfig = {};

    // Read existing config if present
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf-8');
        const parsed = parseYaml(raw);
        if (parsed && typeof parsed === 'object') {
          existing = parsed;
        }
      } catch { /* ignore */ }
    }

    // Merge new values
    if (baseUrl) existing.baseUrl = baseUrl;
    if (authStorageState) existing.authStorageState = authStorageState;
    if (!existing.testDir) existing.testDir = 'e2e';

    writeFileSync(configPath, toYaml(existing));
    console.log(`[ws] Updated .swarm/playwright.config.yaml`);
  }

  /**
   * Get the effective working directory for the active pipeline.
   * Uses worktree path if available (non-default pipelines), otherwise falls back to projectCwd.
   */
  private getEffectiveCwd(): string {
    return this.state.getProjectCwd();
  }

  get port(): number | undefined {
    const addr = this.wss?.address();
    return typeof addr === 'object' ? addr?.port : undefined;
  }
}
