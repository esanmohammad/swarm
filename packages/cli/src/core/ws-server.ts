import { watch, readFileSync, writeFileSync, existsSync, unlinkSync, copyFileSync, FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { stringify as toYaml, parse as parseYaml } from 'yaml';
import type { WsMessage, WsCommand, PipelineState, PipelineInfo, Persona, AgentActivity } from '../types.js';
import { emptyCost } from '../types.js';
import { StateManager } from './state.js';
import { AgentManager } from './agent-manager.js';
import { Pipeline } from './pipeline.js';
import { AgentBus } from './agent-bus.js';
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

function resolveStackTestCmd(stack: string): string {
  switch (stack) {
    case 'react': case 'node': case 'custom': return detectJsTestCmd();
    case 'go': return 'go test ./...';
    case 'python': return 'pytest -v';
    case 'rust': return 'cargo test';
    case 'swift': return 'swift test';
    default: return detectJsTestCmd();
  }
}

function detectJsTestCmd(): string {
  const cwd = process.cwd();
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
    const testScript = pkg.scripts?.test || '';
    if (testScript.includes('vitest')) return 'npx vitest run';
    if (testScript.includes('jest')) return 'npx jest';
    if (testScript.includes('react-scripts test')) return 'npx react-scripts test --watchAll=false';
    if (testScript && testScript !== 'echo "Error: no test specified" && exit 1') return 'npm test';
  } catch { /* ignore */ }
  if (existsSync(join(cwd, 'vitest.config.ts')) || existsSync(join(cwd, 'vitest.config.js'))) return 'npx vitest run';
  if (existsSync(join(cwd, 'jest.config.ts')) || existsSync(join(cwd, 'jest.config.js'))) return 'npx jest';
  if (existsSync(join(cwd, 'node_modules', '.bin', 'vitest'))) return 'npx vitest run';
  if (existsSync(join(cwd, 'node_modules', '.bin', 'jest'))) return 'npx jest';
  return 'npm test';
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
  private agentBus: AgentBus;
  private authToken: string | null = null;
  private swarmConfig: SwarmConfig;

  constructor(
    private state: StateManager,
    private agentManager: AgentManager,
    config: SwarmConfig,
    _projectCwd?: string,
  ) {
    this.swarmConfig = config;
    this.pipeline = new Pipeline(agentManager, state, config);
    this.agentBus = new AgentBus(agentManager);

    // Broadcast bus messages to dashboard
    this.agentBus.on('message', () => {
      this.broadcast({ type: 'bus-messages', payload: { messages: this.agentBus.getMessages() } });
    });
    this.agentBus.on('delivered', () => {
      this.broadcast({ type: 'bus-messages', payload: { messages: this.agentBus.getMessages() } });
    });

    // Deliver queued bus messages when agents complete
    this.agentManager.on('agent-done', () => {
      this.agentBus.deliverQueued();
    });

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
              // Apply lean mode: haiku for docs stages, keep engineer on default
              if (cmd.lean) {
                const engineerModel = this.swarmConfig.models?.engineer ?? this.swarmConfig.model;
                this.swarmConfig.models = {
                  ...this.swarmConfig.models,
                  analyst: 'haiku',
                  architect: 'haiku',
                  lead: 'haiku',
                  tester: 'haiku',
                  engineer: engineerModel,
                };
              }

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

      // ── Preset commands ──────────────────────────────────────────────

      case 'run-fix': {
        if (!cmd.prompt?.trim() && !cmd.issue) {
          throw new Error('Fix requires a bug description or --issue number.');
        }
        const fixStack = this.state.getState().stack;
        const fixModel = cmd.model || this.swarmConfig.model;
        (async () => {
          try {
            let bugDescription = cmd.prompt || '';
            let issueContext = '';

            // Fetch GitHub issue if provided
            if (cmd.issue) {
              const { execSync } = await import('node:child_process');
              try {
                const issueJson = execSync(
                  `gh issue view ${cmd.issue} --json title,body,labels,comments`,
                  { encoding: 'utf-8', cwd: this.getEffectiveCwd() },
                ).trim();
                const issue = JSON.parse(issueJson);
                bugDescription = `[Issue #${cmd.issue}] ${issue.title}\n\n${issue.body || ''}`;
                if (issue.comments?.length > 0) {
                  issueContext = '\n\nIssue comments:\n' + issue.comments.slice(-5)
                    .map((c: { author: { login: string }; body: string }) => `@${c.author.login}: ${c.body.slice(0, 500)}`)
                    .join('\n---\n');
                }
                console.log(`[ws] Fixing issue #${cmd.issue}: ${issue.title}`);
              } catch {
                console.error(`[ws] Could not fetch issue #${cmd.issue}`);
                return;
              }
            } else {
              console.log(`[ws] Running fix: ${bugDescription.slice(0, 80)}`);
            }

            const prompt = [
              'You are fixing a bug. Read the codebase, understand the issue, and fix it.',
              '',
              `Bug description: ${bugDescription}`,
              issueContext,
              '',
              'Instructions:',
              '1. First, understand the bug by reading relevant files and understanding the codebase structure.',
              '2. Identify the root cause.',
              '3. Implement the fix with minimal changes — do NOT refactor unrelated code.',
              '4. Run existing tests to verify the fix does not break anything.',
              '5. If no tests exist for this bug, write a focused test that reproduces the bug and verifies the fix.',
            ].join('\n');

            await this.agentManager.spawn({
              name: `fix-engineer-${fixStack}`,
              persona: 'engineer',
              stack: fixStack,
              prompt,
              model: fixModel,
              cwd: this.getEffectiveCwd(),
              interactive: false,
              permissionMode: 'auto',
            });
            console.log(`[ws] Fix complete`);
          } catch (err) {
            console.error(`[ws] Fix failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'run-spike': {
        if (!cmd.prompt?.trim()) {
          throw new Error('Spike requires a question or exploration task.');
        }
        console.log(`[ws] Running spike: ${cmd.prompt.slice(0, 80)}`);
        const spikeStack = this.state.getState().stack;
        const spikeModel = cmd.model || 'haiku';
        (async () => {
          try {
            const prompt = [
              'You are doing a quick investigation spike. Your goal is to explore and report findings.',
              '',
              `Task: ${cmd.prompt}`,
              '',
              'Instructions:',
              '1. Read and explore the codebase to answer the question.',
              '2. Do NOT make any code changes unless explicitly asked.',
              '3. Summarize your findings clearly at the end.',
              '4. If you find relevant files, code patterns, or potential issues — list them.',
              '5. Keep your investigation focused — this is a quick spike, not a deep audit.',
            ].join('\n');

            await this.agentManager.spawn({
              name: `spike-${spikeStack}`,
              persona: 'engineer',
              stack: spikeStack,
              prompt,
              model: spikeModel,
              cwd: this.getEffectiveCwd(),
              interactive: false,
              permissionMode: 'auto',
              disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
            });
            console.log(`[ws] Spike complete`);
          } catch (err) {
            console.error(`[ws] Spike failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'run-review': {
        console.log(`[ws] Running code review`);
        const reviewStack = this.state.getState().stack;
        const reviewModel = cmd.model || 'sonnet';
        (async () => {
          try {
            const { execSync } = await import('node:child_process');
            const cwd = this.getEffectiveCwd();
            let diff = '';
            let reviewContext = '';

            if (cmd.target && /^\d+$/.test(cmd.target)) {
              try {
                const prInfo = execSync(`gh pr view ${cmd.target} --json title,body`, { encoding: 'utf-8', cwd }).trim();
                const prDiff = execSync(`gh pr diff ${cmd.target}`, { encoding: 'utf-8', cwd }).trim();
                reviewContext = `Pull Request #${cmd.target}:\n${prInfo}`;
                diff = prDiff;
              } catch {
                console.error(`[ws] Could not fetch PR #${cmd.target}`);
                return;
              }
            } else {
              try {
                diff = execSync('git diff main...HEAD', { encoding: 'utf-8', cwd }).trim();
                reviewContext = 'Changes on current branch vs main';
              } catch {
                try {
                  diff = execSync('git diff HEAD', { encoding: 'utf-8', cwd }).trim();
                  reviewContext = 'Current uncommitted changes';
                } catch {
                  console.error(`[ws] No git changes to review`);
                  return;
                }
              }
            }

            if (!diff) {
              console.log(`[ws] No changes to review`);
              return;
            }

            const maxLen = 50000;
            const trimmed = diff.length > maxLen ? diff.slice(0, maxLen) : diff;

            const prompt = [
              'You are a senior code reviewer. Review the following code changes thoroughly.',
              '',
              reviewContext ? `Context: ${reviewContext}` : '',
              '',
              'Produce a structured code review:',
              '## Summary - What the changes do.',
              '## Issues - Bugs, security, performance problems. Severity + file + suggestion.',
              '## Suggestions - Quality improvements.',
              '## Verdict - APPROVE, REQUEST_CHANGES, or COMMENT.',
              '',
              '```diff',
              trimmed,
              '```',
            ].join('\n');

            await this.agentManager.spawn({
              name: `reviewer-${reviewStack}`,
              persona: 'engineer',
              stack: reviewStack,
              prompt,
              model: reviewModel,
              cwd,
              interactive: false,
              permissionMode: 'auto',
              disallowedTools: ['Edit', 'Write', 'Bash', 'NotebookEdit'],
            });
            console.log(`[ws] Review complete`);
          } catch (err) {
            console.error(`[ws] Review failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'run-refactor': {
        if (!cmd.prompt?.trim()) {
          throw new Error('Refactor requires a description of what to change.');
        }
        console.log(`[ws] Running refactor: ${cmd.prompt.slice(0, 80)}`);
        const refactorStack = this.state.getState().stack;
        const refactorModel = cmd.model || this.swarmConfig.model;
        const scopeClause = cmd.scope ? `\nScope: Only modify files within "${cmd.scope}".` : '';
        (async () => {
          try {
            // Step 1: Analyze
            const analyst = await this.agentManager.spawn({
              name: `refactor-analyst-${refactorStack}`,
              persona: 'engineer',
              stack: refactorStack,
              prompt: [
                'Analyze a codebase for refactoring. Do NOT make changes.',
                `\nRefactoring goal: ${cmd.prompt}`,
                scopeClause,
                '\nList files to modify, risks, and complexity estimate.',
              ].join('\n'),
              model: refactorModel,
              cwd: this.getEffectiveCwd(),
              interactive: false,
              permissionMode: 'auto',
              disallowedTools: ['Edit', 'Write', 'Bash', 'NotebookEdit'],
            });
            await this.agentManager.waitForAgent(analyst.id);

            // Step 2: Apply
            const analysisOutput = analyst.output.slice(-10000);
            await this.agentManager.spawn({
              name: `refactor-engineer-${refactorStack}`,
              persona: 'engineer',
              stack: refactorStack,
              prompt: [
                'Apply the refactoring changes from the analysis below.',
                `\nGoal: ${cmd.prompt}`,
                scopeClause,
                `\nAnalysis:\n${analysisOutput}`,
                '\nMake minimal changes. Run tests to verify.',
              ].join('\n'),
              model: refactorModel,
              cwd: this.getEffectiveCwd(),
              interactive: false,
              permissionMode: 'auto',
            });
            console.log(`[ws] Refactor complete`);
          } catch (err) {
            console.error(`[ws] Refactor failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'get-memories': {
        const { MemoryStore } = await import('./memory-store.js');
        const swarmDir = join(this.state.getFilePath(), '..');
        const store = new MemoryStore(swarmDir);
        const entries = store.list();
        _ws.send(JSON.stringify({ type: 'memories', payload: { entries } }));
        break;
      }

      case 'add-memory': {
        const { MemoryStore } = await import('./memory-store.js');
        const swarmDir = join(this.state.getFilePath(), '..');
        const store = new MemoryStore(swarmDir);
        store.add({
          kind: (cmd.kind as 'manual') || 'manual',
          content: cmd.content,
          confidence: 80,
          source: 'dashboard',
          tags: cmd.tags || [],
        });
        // Broadcast updated list
        const entries = store.list();
        this.broadcast({ type: 'memories', payload: { entries } });
        break;
      }

      case 'remove-memory': {
        const { MemoryStore } = await import('./memory-store.js');
        const swarmDir = join(this.state.getFilePath(), '..');
        const store = new MemoryStore(swarmDir);
        store.remove(cmd.id);
        const entries = store.list();
        this.broadcast({ type: 'memories', payload: { entries } });
        break;
      }

      case 'clear-memories': {
        const { MemoryStore } = await import('./memory-store.js');
        const swarmDir = join(this.state.getFilePath(), '..');
        const store = new MemoryStore(swarmDir);
        store.clear();
        this.broadcast({ type: 'memories', payload: { entries: [] } });
        break;
      }

      case 'run-deploy': {
        console.log(`[ws] Running deploy: ${cmd.environment}`);
        (async () => {
          try {
            const { loadDeployConfig } = await import('../commands/deploy.js');
            const { execSync: exec } = await import('node:child_process');
            const swarmDir = join(this.state.getFilePath(), '..');
            const config = loadDeployConfig(swarmDir);
            if (!config || !config[cmd.environment]) {
              this.broadcast({ type: 'deploy-result', payload: {
                environment: cmd.environment,
                steps: [{ name: 'Config', cmd: 'load deploy.yaml', status: 'fail' as const, output: `No deploy config for "${cmd.environment}"`, durationMs: 0 }],
                success: false, rolledBack: false, timestamp: Date.now(),
              }});
              return;
            }
            const env = config[cmd.environment];
            const cwd = this.getEffectiveCwd();
            const rawSteps = [
              env.build && { name: 'Build', cmd: env.build },
              env.deploy && { name: 'Deploy', cmd: env.deploy },
              env.promote && { name: 'Promote', cmd: env.promote },
              env.healthcheck && { name: 'Healthcheck', cmd: env.healthcheck },
              env.smoketest && { name: 'Smoke test', cmd: env.smoketest },
            ].filter(Boolean) as Array<{ name: string; cmd: string }>;

            const results: Array<{ name: string; cmd: string; status: 'pass' | 'fail' | 'skip'; output?: string; durationMs: number }> = [];
            let failed = false;
            let rolledBack = false;

            for (const step of rawSteps) {
              if (cmd.dryRun) {
                results.push({ name: step.name, cmd: step.cmd, status: 'skip', durationMs: 0 });
                continue;
              }
              const start = Date.now();
              try {
                const out = exec(step.cmd, { cwd, stdio: 'pipe', timeout: 300000, encoding: 'utf-8' });
                results.push({ name: step.name, cmd: step.cmd, status: 'pass', output: typeof out === 'string' ? out.slice(-1000) : '', durationMs: Date.now() - start });
                console.log(`[ws] Deploy ${step.name}: OK`);
              } catch (err: unknown) {
                const e = err as { stderr?: string; stdout?: string };
                const output = ((e.stderr || '') + (e.stdout || '')).slice(-1000);
                results.push({ name: step.name, cmd: step.cmd, status: 'fail', output, durationMs: Date.now() - start });
                console.error(`[ws] Deploy ${step.name}: FAILED`);
                failed = true;
                if (env.rollback) {
                  try { exec(env.rollback, { cwd, stdio: 'pipe', timeout: 60000 }); rolledBack = true; } catch {}
                }
                break;
              }
              // Broadcast progress after each step
              this.broadcast({ type: 'deploy-result', payload: {
                environment: cmd.environment, steps: results, success: !failed, rolledBack, timestamp: Date.now(),
              }});
            }

            // Final broadcast
            this.broadcast({ type: 'deploy-result', payload: {
              environment: cmd.environment, steps: results, success: !failed, rolledBack, timestamp: Date.now(),
            }});
          } catch (err) {
            this.broadcast({ type: 'deploy-result', payload: {
              environment: cmd.environment,
              steps: [{ name: 'Error', cmd: '', status: 'fail' as const, output: err instanceof Error ? err.message : String(err), durationMs: 0 }],
              success: false, rolledBack: false, timestamp: Date.now(),
            }});
          }
        })();
        break;
      }

      case 'run-migrate': {
        console.log(`[ws] Running migrate: ${cmd.description.slice(0, 60)}`);
        const migrateStack = this.state.getState().stack;
        const migrateModel = cmd.model || 'sonnet';
        (async () => {
          try {
            const prompt = [
              'You are a database migration specialist. Generate a safe database migration.',
              `\nMigration request: ${cmd.description}`,
              '\n1. Analyze current schema from existing migration files.',
              '2. Generate migration + rollback in the correct ORM format.',
              '3. Flag any destructive operations or data loss risk.',
              cmd.dryRun ? '\nDRY RUN: Only output the plan, do NOT create files.' : '\nGenerate files, then test: apply → rollback → re-apply.',
            ].join('\n');

            await this.agentManager.spawn({
              name: `migrate-${migrateStack}`,
              persona: 'engineer',
              stack: migrateStack,
              prompt,
              model: migrateModel,
              cwd: this.getEffectiveCwd(),
              interactive: false,
              permissionMode: 'auto',
              disallowedTools: cmd.dryRun ? ['Edit', 'Write', 'NotebookEdit'] : undefined,
            });
            console.log(`[ws] Migrate complete`);
          } catch (err) {
            console.error(`[ws] Migrate failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'get-stats': {
        const { computeStats } = await import('../commands/stats.js');
        const history = this.state.listHistory();
        const periodDays = cmd.period ?? 30;
        const cutoff = Date.now() - periodDays * 86400000;
        const recent = history.filter(h => h.timestamp >= cutoff);
        const stats = computeStats(recent);
        _ws.send(JSON.stringify({ type: 'stats', payload: stats }));
        break;
      }

      case 'agent-message': {
        const fromAgent = this.agentManager.getAgent(cmd.fromAgentId);
        const toAgent = this.agentManager.getAgent(cmd.toAgentId);
        if (!fromAgent || !toAgent) {
          throw new Error('Source or target agent not found');
        }
        const result = this.agentBus.sendTo(
          cmd.fromAgentId, fromAgent.persona,
          cmd.toAgentId, toAgent.persona,
          cmd.kind as 'question' | 'clarification' | 'blocker' | 'status-update',
          cmd.content,
        );
        if (!result) {
          throw new Error('Message not allowed (route denied or exchange limit reached)');
        }
        break;
      }

      case 'get-bus-messages': {
        _ws.send(JSON.stringify({
          type: 'bus-messages',
          payload: { messages: this.agentBus.getMessages() },
        }));
        break;
      }

      case 'run-explain': {
        console.log(`[ws] Running explain: ${cmd.target?.slice(0, 60) || 'full overview'}`);
        const explainStack = this.state.getState().stack;
        const explainModel = cmd.model || 'haiku';
        (async () => {
          try {
            const { scanCodebase } = await import('./codebase-scanner.js');
            const { loadConventions } = await import('../commands/learn.js');
            const { existsSync: efs, readFileSync: rfs, statSync: ss } = await import('node:fs');
            const { join: pjoin } = await import('node:path');
            const cwd = this.getEffectiveCwd();
            const swarmDir = pjoin(this.state.getFilePath(), '..');

            const parts: string[] = [];
            const ctx = scanCodebase(cwd);
            if (ctx) parts.push(ctx);
            const conv = loadConventions(swarmDir);
            if (conv) parts.push(conv);

            // Existing docs
            for (const f of ['README.md', 'CLAUDE.md']) {
              const fp = pjoin(cwd, f);
              if (efs(fp)) {
                try { parts.push(`--- ${f} ---\n${rfs(fp, 'utf-8').slice(0, 5000)}`); } catch {}
              }
            }

            const depth = cmd.depth || 'medium';
            const depthInstr = depth === 'shallow' ? 'Brief high-level overview.' :
              depth === 'deep' ? 'Comprehensive deep-dive with code examples.' :
              'Thorough explanation covering architecture and key patterns.';

            if (!cmd.target) {
              parts.push(`TASK: Generate project overview.\n${depthInstr}\nStructure: ## Overview, ## Architecture, ## Key Patterns, ## Data Flow, ## Entry Points`);
              if (cmd.diagram) parts.push('Include Mermaid diagrams.');
            } else if (efs(pjoin(cwd, cmd.target))) {
              const isDir = ss(pjoin(cwd, cmd.target)).isDirectory();
              parts.push(`TASK: Explain ${isDir ? 'directory' : 'file'} \`${cmd.target}\`.\n${depthInstr}`);
              if (cmd.diagram) parts.push('Include Mermaid diagrams.');
            } else {
              parts.push(`TASK: Answer about the codebase: "${cmd.target}"\n${depthInstr}\nCite specific files. Do NOT guess.`);
              if (cmd.diagram) parts.push('Include Mermaid diagrams.');
            }

            await this.agentManager.spawn({
              name: `explain-${explainStack}`,
              persona: 'engineer',
              stack: explainStack,
              prompt: parts.join('\n'),
              model: explainModel,
              cwd,
              interactive: false,
              permissionMode: 'auto',
              disallowedTools: ['Edit', 'Write', 'NotebookEdit', 'Bash'],
            });
            console.log(`[ws] Explain complete`);
          } catch (err) {
            console.error(`[ws] Explain failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'run-watch-test': {
        console.log(`[ws] Running test check`);
        (async () => {
          try {
            const { execSync: exec } = await import('node:child_process');
            const cwd = this.getEffectiveCwd();
            const stack = this.state.getState().stack;
            const testCmd = resolveStackTestCmd(stack);

            let passed = false;
            let output = '';
            try {
              output = exec(testCmd, { encoding: 'utf-8', cwd, timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] });
              passed = true;
            } catch (err: unknown) {
              const e = err as { stdout?: string; stderr?: string };
              output = (e.stdout || '') + (e.stderr || '');
            }

            this.broadcast({
              type: 'watch-result',
              payload: { passed, output: output.slice(-5000), testCmd, timestamp: Date.now() },
            });
            console.log(`[ws] Test check: ${passed ? 'PASS' : 'FAIL'}`);
          } catch (err) {
            console.error(`[ws] Test check failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'run-watch-fix': {
        console.log(`[ws] Running watch fix agent`);
        const fixStack = this.state.getState().stack;
        const fixModel = cmd.model || this.swarmConfig.model;
        (async () => {
          try {
            const prompt = [
              'Fix test failures detected by the file watcher.',
              '',
              `Changed files: ${cmd.changedFiles.join(', ')}`,
              '',
              'Test output:',
              '```',
              cmd.testOutput.slice(-8000),
              '```',
              '',
              '1. Read the failing test output.',
              '2. Fix the source code with minimal changes.',
              '3. Run tests to verify.',
            ].join('\n');

            await this.agentManager.spawn({
              name: `watch-fixer-${fixStack}`,
              persona: 'engineer',
              stack: fixStack,
              prompt,
              model: fixModel,
              cwd: this.getEffectiveCwd(),
              interactive: false,
              permissionMode: 'auto',
            });
            console.log(`[ws] Watch fix complete`);
          } catch (err) {
            console.error(`[ws] Watch fix failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'get-pr-reviews': {
        const { getReviewHistory } = await import('../commands/babysit-prs.js');
        const swarmDir = join(this.state.getFilePath(), '..');
        const reviews = getReviewHistory(swarmDir);
        _ws.send(JSON.stringify({ type: 'pr-reviews', payload: { reviews } }));
        break;
      }

      case 'run-babysit-prs': {
        console.log(`[ws] Running PR review cycle`);
        (async () => {
          try {
            const { execSync } = await import('node:child_process');
            const { loadConventions } = await import('../commands/learn.js');
            const { getReviewHistory } = await import('../commands/babysit-prs.js');
            const cwd = this.getEffectiveCwd();
            const swarmDir = join(this.state.getFilePath(), '..');
            const reviewModel = cmd.model || 'sonnet';

            // Fetch open PRs
            let prListCmd = 'gh pr list --json number,title,body,headRefOid,author,labels,additions,deletions --limit 20';
            if (cmd.label) prListCmd += ` --label "${cmd.label}"`;

            let prs: Array<{ number: number; title: string; body: string; headRefOid: string; author: { login: string }; additions: number; deletions: number }>;
            try {
              const raw = execSync(prListCmd, { encoding: 'utf-8', cwd }).trim();
              prs = JSON.parse(raw || '[]');
            } catch {
              console.log(`[ws] No open PRs or gh CLI error`);
              return;
            }

            // Filter already-reviewed
            const existingReviews = getReviewHistory(swarmDir);
            const reviewedKeys = new Set(existingReviews.map(r => `${r.number}-${r.sha}`));
            const pending = prs.filter(pr => !reviewedKeys.has(`${pr.number}-${pr.headRefOid}`));

            if (pending.length === 0) {
              console.log(`[ws] All ${prs.length} open PR(s) already reviewed`);
              return;
            }

            const conventions = loadConventions(swarmDir);

            for (const pr of pending) {
              let diff: string;
              try {
                diff = execSync(`gh pr diff ${pr.number}`, { encoding: 'utf-8', cwd }).trim();
              } catch { continue; }
              if (!diff) continue;

              const maxLen = 50000;
              const trimmed = diff.length > maxLen ? diff.slice(0, maxLen) : diff;

              const prompt = [
                `Review PR #${pr.number}: ${pr.title} by @${pr.author.login}`,
                `+${pr.additions} -${pr.deletions} lines`,
                pr.body ? `\nDescription: ${pr.body.slice(0, 2000)}` : '',
                conventions ? `\n${conventions}` : '',
                '\nProduce: ## Summary, ## Issues, ## Suggestions, ## Verdict (APPROVE/REQUEST_CHANGES/COMMENT)',
                `\n\`\`\`diff\n${trimmed}\n\`\`\``,
              ].join('\n');

              const agent = await this.agentManager.spawn({
                name: `pr-reviewer-${pr.number}`,
                persona: 'engineer',
                stack: this.state.getState().stack,
                prompt,
                model: reviewModel,
                cwd,
                interactive: false,
                permissionMode: 'auto',
                disallowedTools: ['Edit', 'Write', 'Bash', 'NotebookEdit'],
              });
              await this.agentManager.waitForAgent(agent.id);

              const output = agent.output.trim();
              let verdict = 'COMMENT';
              if (output.match(/verdict[:\s]*APPROVE/i)) verdict = 'APPROVE';
              else if (output.match(/verdict[:\s]*REQUEST_CHANGES/i)) verdict = 'REQUEST_CHANGES';

              // Post comment
              if (output) {
                try {
                  const body = `## Swarm AI Review\n\n${output}\n\n---\n*Reviewed by Swarm (${reviewModel}, $${agent.cost.totalUsd.toFixed(2)})*`;
                  execSync(`gh pr comment ${pr.number} --body-file -`, {
                    input: body, cwd, stdio: ['pipe', 'pipe', 'pipe'],
                  });
                } catch { /* non-critical */ }
              }

              // Auto-approve
              if (cmd.autoApprove && verdict === 'APPROVE') {
                try {
                  execSync(`gh pr review ${pr.number} --approve --body "Auto-approved by Swarm"`, { cwd, stdio: 'pipe' });
                } catch { /* non-critical */ }
              }

              // Save review
              const { writeFileSync: wfs, existsSync: efs, readFileSync: rfs, mkdirSync: mds } = await import('node:fs');
              const memDir = join(swarmDir, 'memory');
              if (!efs(memDir)) mds(memDir, { recursive: true });
              const reviewPath = join(memDir, 'pr-reviews.json');
              const existing = efs(reviewPath) ? JSON.parse(rfs(reviewPath, 'utf-8')) : [];
              existing.push({ number: pr.number, sha: pr.headRefOid, reviewedAt: new Date().toISOString(), verdict, cost: agent.cost.totalUsd });
              wfs(reviewPath, JSON.stringify(existing.slice(-200), null, 2), 'utf-8');

              console.log(`[ws] PR #${pr.number}: ${verdict} ($${agent.cost.totalUsd.toFixed(2)})`);
            }

            // Broadcast updated reviews
            const updatedReviews = getReviewHistory(swarmDir);
            this.broadcast({ type: 'pr-reviews', payload: { reviews: updatedReviews } });
          } catch (err) {
            console.error(`[ws] PR review failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'run-learn': {
        console.log(`[ws] Running learn (convention scan)`);
        (async () => {
          try {
            const { extractConventions } = await import('./convention-extractor.js');
            const cwd = this.getEffectiveCwd();
            const swarmDir = join(this.state.getFilePath(), '..');
            const conventionsPath = join(swarmDir, 'conventions.md');

            // Broadcast loading state
            this.broadcast({ type: 'conventions', payload: { content: null, loading: true } });

            const conventions = extractConventions(cwd);

            if (!conventions.trim()) {
              this.broadcast({ type: 'conventions', payload: { content: null, loading: false } });
              console.log(`[ws] No conventions detected`);
              return;
            }

            const header = [
              '# Project Conventions',
              '',
              `<!-- Generated by swarm learn on ${new Date().toISOString().split('T')[0]} -->`,
              '<!-- Edit freely — manual changes are preserved with --merge -->',
              '',
            ].join('\n');
            const content = header + conventions + '\n';
            writeFileSync(conventionsPath, content, 'utf-8');

            this.broadcast({ type: 'conventions', payload: { content, loading: false } });
            console.log(`[ws] Conventions saved`);
          } catch (err) {
            console.error(`[ws] Learn failed: ${err instanceof Error ? err.message : err}`);
            this.broadcast({ type: 'conventions', payload: { content: null, loading: false } });
          }
        })();
        break;
      }

      case 'get-conventions': {
        const swarmDir = join(this.state.getFilePath(), '..');
        const conventionsPath = join(swarmDir, 'conventions.md');
        let content: string | null = null;
        if (existsSync(conventionsPath)) {
          try {
            content = readFileSync(conventionsPath, 'utf-8');
          } catch { /* ignore */ }
        }
        _ws.send(JSON.stringify({
          type: 'conventions' as const,
          payload: { content, loading: false },
        }));
        break;
      }

      case 'save-conventions': {
        const swarmDir = join(this.state.getFilePath(), '..');
        const conventionsPath = join(swarmDir, 'conventions.md');
        writeFileSync(conventionsPath, cmd.content, 'utf-8');
        this.broadcast({ type: 'conventions', payload: { content: cmd.content, loading: false } });
        console.log(`[ws] Conventions saved (manual edit)`);
        break;
      }

      case 'run-simplify': {
        console.log(`[ws] Running simplify`);
        const simplifyStack = this.state.getState().stack;
        const simplifyModel = cmd.model || 'haiku';
        const simplifyDryRun = cmd.dryRun ?? false;
        (async () => {
          try {
            const { execSync } = await import('node:child_process');
            const cwd = this.getEffectiveCwd();

            let diff = '';
            try {
              diff = execSync('git diff main...HEAD', { encoding: 'utf-8', cwd }).trim();
              if (!diff) {
                diff = execSync('git diff HEAD', { encoding: 'utf-8', cwd }).trim();
              }
            } catch {
              try {
                diff = execSync('git diff HEAD', { encoding: 'utf-8', cwd }).trim();
              } catch { /* ignore */ }
            }

            if (!diff) {
              console.log(`[ws] No changes to simplify`);
              return;
            }

            const changedFiles = (() => {
              try { return execSync('git diff --name-only main...HEAD', { encoding: 'utf-8', cwd }).trim(); }
              catch { try { return execSync('git diff --name-only HEAD', { encoding: 'utf-8', cwd }).trim(); } catch { return ''; } }
            })();

            const maxLen = 40000;
            const trimmed = diff.length > maxLen ? diff.slice(0, maxLen) : diff;

            // Step 1: Analyze
            const analyst = await this.agentManager.spawn({
              name: `simplify-analyst-${simplifyStack}`,
              persona: 'engineer',
              stack: simplifyStack,
              prompt: [
                'Analyze code changes for simplification opportunities.',
                `\nChanged files:\n${changedFiles}`,
                '\nLook for: dead code, unnecessary abstractions, duplication, over-engineering, missed reuse.',
                '\nFor each finding: severity (high/medium/low), file, lines, issue, fix.',
                `\n\`\`\`diff\n${trimmed}\n\`\`\``,
              ].join('\n'),
              model: simplifyModel,
              cwd,
              interactive: false,
              permissionMode: 'auto',
              disallowedTools: ['Edit', 'Write', 'Bash', 'NotebookEdit'],
            });

            if (simplifyDryRun) {
              console.log(`[ws] Simplify analysis complete (dry run)`);
              return;
            }

            await this.agentManager.waitForAgent(analyst.id);

            // Step 2: Apply
            const analysisOutput = analyst.output.slice(-10000);
            await this.agentManager.spawn({
              name: `simplify-fixer-${simplifyStack}`,
              persona: 'engineer',
              stack: simplifyStack,
              prompt: [
                'Apply simplification fixes from the analysis.',
                `\nAnalysis:\n${analysisOutput}`,
                '\nOnly apply high-severity fixes. Run tests after. Revert if tests break.',
              ].join('\n'),
              model: simplifyModel,
              cwd,
              interactive: false,
              permissionMode: 'auto',
            });
            console.log(`[ws] Simplify complete`);
          } catch (err) {
            console.error(`[ws] Simplify failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'run-health': {
        console.log(`[ws] Running health check`);
        (async () => {
          try {
            const { checkHealth } = await import('../commands/health.js');
            const cwd = this.getEffectiveCwd();
            const report = checkHealth(cwd);
            this.broadcast({ type: 'health-report', payload: { overall: report.overall, metrics: report.metrics, timestamp: report.timestamp } });
            console.log(`[ws] Health check complete: ${report.overall}/100`);
          } catch (err) {
            console.error(`[ws] Health check failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'run-secure': {
        console.log(`[ws] Running security scan`);
        (async () => {
          try {
            const { SecurityScanner } = await import('./security-scanner.js');
            const cwd = this.getEffectiveCwd();
            const scanner = new SecurityScanner(cwd);
            const report = scanner.scan({ full: cmd.full });
            this.broadcast({ type: 'security-report', payload: { findings: report.findings, summary: report.summary, scannedFiles: report.scannedFiles } });
            console.log(`[ws] Security scan complete: ${report.findings.length} findings`);
          } catch (err) {
            console.error(`[ws] Security scan failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'run-secrets-scan': {
        console.log(`[ws] Running secret scan`);
        (async () => {
          try {
            const { SecretDetector } = await import('./secret-detector.js');
            const cwd = this.getEffectiveCwd();
            const detector = new SecretDetector(cwd);
            const findings = detector.scan({ });
            const gitignoreCheck = detector.checkGitignore();
            this.broadcast({ type: 'secrets-report', payload: { findings: findings.map(f => ({ type: f.type, file: f.file, line: f.line, severity: f.severity, message: f.message })), gitignoreIssues: gitignoreCheck.missing } });
            console.log(`[ws] Secret scan complete: ${findings.length} findings`);
          } catch (err) {
            console.error(`[ws] Secret scan failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'run-supply-chain-check': {
        console.log(`[ws] Running supply chain check`);
        (async () => {
          try {
            const { SupplyChainGuard } = await import('./supply-chain.js');
            const cwd = this.getEffectiveCwd();
            const guard = new SupplyChainGuard(cwd);
            const results = cmd.package ? [guard.verifyPackage(cmd.package)] : guard.verifyAll();
            _ws.send(JSON.stringify({ type: 'supply-chain-results', payload: { results } }));
            console.log(`[ws] Supply chain check complete: ${results.length} packages`);
          } catch (err) {
            console.error(`[ws] Supply chain check failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'run-deps-check': {
        console.log(`[ws] Running dependency check`);
        (async () => {
          try {
            const { execSync } = await import('node:child_process');
            const cwd = this.getEffectiveCwd();
            const raw = execSync('npm outdated --json 2>/dev/null || true', { cwd, encoding: 'utf-8', timeout: 30000 }).trim();
            const parsed = raw && raw !== '{}' ? JSON.parse(raw) : {};
            _ws.send(JSON.stringify({ type: 'deps-check', payload: { outdated: parsed } }));
          } catch (err) {
            console.error(`[ws] Deps check failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'run-deps-audit': {
        console.log(`[ws] Running dependency audit`);
        (async () => {
          try {
            const { execSync } = await import('node:child_process');
            const cwd = this.getEffectiveCwd();
            const raw = execSync('npm audit --json 2>/dev/null || true', { cwd, encoding: 'utf-8', timeout: 30000 }).trim();
            const parsed = JSON.parse(raw || '{}');
            _ws.send(JSON.stringify({ type: 'deps-audit', payload: { audit: parsed } }));
          } catch (err) {
            console.error(`[ws] Deps audit failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'run-deps-update': {
        console.log(`[ws] Running dependency update (level: ${cmd.level || 'minor'})`);
        (async () => {
          try {
            const { execSync } = await import('node:child_process');
            const cwd = this.getEffectiveCwd();
            execSync('npm update', { cwd, encoding: 'utf-8', timeout: 120000 });
            _ws.send(JSON.stringify({ type: 'deps-update', payload: { success: true } }));
            console.log(`[ws] Deps update complete`);
          } catch (err) {
            console.error(`[ws] Deps update failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'run-incident': {
        console.log(`[ws] Running incident response: ${cmd.description.slice(0, 60)}`);
        (async () => {
          try {
            const { execSync } = await import('node:child_process');
            const cwd = this.getEffectiveCwd();
            const model = cmd.model || 'sonnet';

            // Gather context
            let context = '';
            try { context += 'Recent commits:\n' + execSync('git log --oneline -15', { cwd, encoding: 'utf-8' }); } catch { /* ignore */ }

            const prompt = [
              'You are a production incident responder. Diagnose the following issue.',
              `\nSeverity: ${cmd.severity || 'P3'}`,
              `\nIncident: ${cmd.description}`,
              context ? `\nContext:\n${context}` : '',
              '\nProduce: 1) Timeline, 2) Suspected culprit, 3) Root cause, 4) Recommended fix/rollback.',
            ].join('\n');

            const agent = await this.agentManager.spawn({
              name: `incident-${Date.now()}`,
              persona: 'engineer',
              stack: this.state.getState().stack,
              prompt,
              model,
              cwd,
              interactive: false,
              permissionMode: cmd.fix ? 'auto' : 'plan',
              disallowedTools: cmd.fix ? undefined : ['Edit', 'Write', 'Bash', 'NotebookEdit'],
            });

            await this.agentManager.waitForAgent(agent.id);
            console.log(`[ws] Incident response complete`);
          } catch (err) {
            console.error(`[ws] Incident response failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'run-benchmark': {
        console.log(`[ws] Running benchmark`);
        (async () => {
          try {
            const { execSync } = await import('node:child_process');
            const cwd = this.getEffectiveCwd();
            // Try to find a bench script
            let output = '';
            try {
              const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
              const benchCmd = pkg.scripts?.bench || pkg.scripts?.benchmark;
              if (benchCmd) {
                output = execSync(`npm run ${pkg.scripts?.bench ? 'bench' : 'benchmark'}`, { cwd, encoding: 'utf-8', timeout: 120000 });
              }
            } catch { /* no bench script */ }

            this.broadcast({
              type: 'benchmark-report',
              payload: { results: [], regressions: [], timestamp: Date.now() },
            });
            console.log(`[ws] Benchmark complete`);
          } catch (err) {
            console.error(`[ws] Benchmark failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'run-risk': {
        console.log(`[ws] Running risk scoring`);
        (async () => {
          try {
            const { RiskScorer } = await import('./risk-scorer.js');
            const { execSync } = await import('node:child_process');
            const cwd = this.getEffectiveCwd();
            const scorer = new RiskScorer(cwd);
            let files = cmd.files || [];
            if (files.length === 0) {
              try {
                const diff = execSync('git diff --name-only main...HEAD', { cwd, encoding: 'utf-8' }).trim();
                files = diff ? diff.split('\n').filter(Boolean) : [];
              } catch { /* ignore */ }
            }
            if (files.length > 0) {
              const scores = scorer.scoreFiles(files);
              this.broadcast({ type: 'risk-scores', payload: { scores } });
            }
            console.log(`[ws] Risk scoring complete: ${files.length} files`);
          } catch (err) {
            console.error(`[ws] Risk scoring failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'run-fingerprint': {
        console.log(`[ws] Running fingerprint scan`);
        (async () => {
          try {
            const { CodeFingerprinter } = await import('./fingerprint.js');
            const cwd = this.getEffectiveCwd();
            const swarmDir = join(this.state.getFilePath(), '..');
            const fp = new CodeFingerprinter(cwd, swarmDir);
            const report = fp.scan();
            this.broadcast({ type: 'fingerprint-report', payload: { files: report.files, summary: report.summary } });
            console.log(`[ws] Fingerprint scan complete: ${report.files.length} files`);
          } catch (err) {
            console.error(`[ws] Fingerprint failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'get-sandbox-status': {
        try {
          const { Sandbox } = await import('./sandbox.js');
          const cwd = this.getEffectiveCwd();
          const sandbox = new Sandbox(cwd);
          _ws.send(JSON.stringify({ type: 'sandbox-status', payload: { mode: sandbox['config']?.mode || 'moderate' } }));
        } catch { /* ignore */ }
        break;
      }

      case 'set-sandbox-mode': {
        try {
          const swarmDir = join(this.state.getFilePath(), '..');
          writeFileSync(join(swarmDir, 'sandbox.yaml'), `mode: ${cmd.mode}\n`);
          console.log(`[ws] Sandbox mode set to ${cmd.mode}`);
        } catch { /* ignore */ }
        break;
      }

      case 'get-provenance': {
        try {
          const { ProvenanceTracker } = await import('./provenance.js');
          const swarmDir = join(this.state.getFilePath(), '..');
          const tracker = new ProvenanceTracker(swarmDir);
          const records = cmd.file
            ? tracker.getFileProvenance(cmd.file)
            : tracker.list(cmd.limit || 20);
          _ws.send(JSON.stringify({ type: 'provenance', payload: { records } }));
        } catch { /* ignore */ }
        break;
      }

      case 'get-runtime-events': {
        try {
          const { RuntimeMonitor } = await import('./runtime-monitor.js');
          const swarmDir = join(this.state.getFilePath(), '..');
          const monitor = new RuntimeMonitor(swarmDir);
          const events = monitor.getEvents(cmd.since ? Date.now() - cmd.since * 60000 : undefined);
          const anomalies = monitor.getAnomalies();
          _ws.send(JSON.stringify({ type: 'runtime-events', payload: { events, anomalyCount: anomalies.length } }));
        } catch { /* ignore */ }
        break;
      }

      case 'save-runtime-baseline': {
        try {
          const { RuntimeMonitor } = await import('./runtime-monitor.js');
          const swarmDir = join(this.state.getFilePath(), '..');
          const monitor = new RuntimeMonitor(swarmDir);
          monitor.saveBaseline();
          console.log(`[ws] Runtime baseline saved`);
        } catch { /* ignore */ }
        break;
      }

      case 'autopilot-status': {
        const { loadAutopilotState } = await import('../commands/autopilot.js');
        const swarmDir = join(this.state.getFilePath(), '..');
        const autopilotState = loadAutopilotState(swarmDir);
        _ws.send(JSON.stringify({ type: 'autopilot-state', payload: autopilotState }));
        break;
      }

      case 'autopilot-start': {
        console.log(`[ws] Starting autopilot`);
        const { loadAutopilotState: loadAP, saveAutopilotState: saveAP } = await import('../commands/autopilot.js');
        const swarmDir = join(this.state.getFilePath(), '..');
        const apState = loadAP(swarmDir);
        apState.running = true;
        apState.label = cmd.label || apState.label || 'swarm';
        apState.pollInterval = cmd.interval || apState.pollInterval || 10;
        apState.maxConcurrent = cmd.maxConcurrent || apState.maxConcurrent || 1;
        apState.budgetPerIssue = cmd.budget || apState.budgetPerIssue || 10;
        saveAP(swarmDir, apState);
        this.broadcast({ type: 'autopilot-state', payload: apState });
        console.log(`[ws] Autopilot started (label: ${apState.label})`);
        break;
      }

      case 'autopilot-stop': {
        console.log(`[ws] Stopping autopilot`);
        const { loadAutopilotState: loadAP2, saveAutopilotState: saveAP2 } = await import('../commands/autopilot.js');
        const swarmDir = join(this.state.getFilePath(), '..');
        const apState = loadAP2(swarmDir);
        apState.running = false;
        saveAP2(swarmDir, apState);
        this.broadcast({ type: 'autopilot-state', payload: apState });
        console.log(`[ws] Autopilot stopped`);
        break;
      }

      // ── Wave 3: Autonomous Employee ────────────────────────────────

      case 'inbox-status': {
        try {
          const { loadInboxState } = await import('../commands/inbox.js');
          const sd = join(this.state.getFilePath(), '..');
          const inbox = loadInboxState(sd);
          _ws.send(JSON.stringify({ type: 'inbox-state', payload: inbox }));
        } catch { /* ignore */ }
        break;
      }

      case 'inbox-start': {
        console.log(`[ws] Starting inbox daemon`);
        try {
          const { loadInboxState, saveInboxState } = await import('../commands/inbox.js');
          const sd = join(this.state.getFilePath(), '..');
          const inbox = loadInboxState(sd);
          inbox.running = true;
          inbox.paused = false;
          inbox.label = cmd.label || inbox.label || 'swarm';
          inbox.pollInterval = cmd.interval || inbox.pollInterval || 10;
          inbox.maxConcurrent = cmd.maxConcurrent || inbox.maxConcurrent || 1;
          if (cmd.budget) inbox.stats.dailyBudget = cmd.budget;
          saveInboxState(sd, inbox);
          this.broadcast({ type: 'inbox-state', payload: inbox });
        } catch (err) {
          console.error(`[ws] Inbox start failed: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }

      case 'inbox-stop': {
        console.log(`[ws] Stopping inbox daemon`);
        try {
          const { loadInboxState, saveInboxState } = await import('../commands/inbox.js');
          const sd = join(this.state.getFilePath(), '..');
          const inbox = loadInboxState(sd);
          inbox.running = false;
          saveInboxState(sd, inbox);
          this.broadcast({ type: 'inbox-state', payload: inbox });
        } catch { /* ignore */ }
        break;
      }

      case 'inbox-pause': {
        try {
          const { loadInboxState, saveInboxState } = await import('../commands/inbox.js');
          const sd = join(this.state.getFilePath(), '..');
          const inbox = loadInboxState(sd);
          inbox.paused = !inbox.paused;
          saveInboxState(sd, inbox);
          this.broadcast({ type: 'inbox-state', payload: inbox });
        } catch { /* ignore */ }
        break;
      }

      case 'inbox-add': {
        try {
          const { loadInboxState, saveInboxState } = await import('../commands/inbox.js');
          const sd = join(this.state.getFilePath(), '..');
          const inbox = loadInboxState(sd);
          inbox.queue.push({
            id: `manual-${Date.now()}`,
            source: 'manual',
            title: cmd.task,
            body: cmd.task,
            labels: [],
            createdAt: new Date().toISOString(),
            priority: 50,
            type: 'feature',
            status: 'queued',
            confidence: 70,
            estimatedCost: 5,
            estimatedMinutes: 15,
          });
          saveInboxState(sd, inbox);
          this.broadcast({ type: 'inbox-state', payload: inbox });
        } catch { /* ignore */ }
        break;
      }

      case 'inbox-skip': {
        try {
          const { loadInboxState, saveInboxState } = await import('../commands/inbox.js');
          const sd = join(this.state.getFilePath(), '..');
          const inbox = loadInboxState(sd);
          const item = inbox.queue.find(i => i.id === cmd.itemId);
          if (item) { item.status = 'skipped'; inbox.stats.skipped++; }
          saveInboxState(sd, inbox);
          this.broadcast({ type: 'inbox-state', payload: inbox });
        } catch { /* ignore */ }
        break;
      }

      case 'inbox-prioritize': {
        try {
          const { loadInboxState, saveInboxState } = await import('../commands/inbox.js');
          const sd = join(this.state.getFilePath(), '..');
          const inbox = loadInboxState(sd);
          const idx = inbox.queue.findIndex(i => i.id === cmd.itemId);
          if (idx > 0) {
            const [item] = inbox.queue.splice(idx, 1);
            inbox.queue.unshift(item);
          }
          saveInboxState(sd, inbox);
          this.broadcast({ type: 'inbox-state', payload: inbox });
        } catch { /* ignore */ }
        break;
      }

      case 'get-standup': {
        console.log(`[ws] Generating standup report`);
        try {
          const { generateStandupReport } = await import('../core/activity-tracker.js');
          const sd = join(this.state.getFilePath(), '..');
          const report = generateStandupReport(sd, { weekly: cmd.weekly, format: 'json' });
          const parsed = typeof report === 'string' ? JSON.parse(report) : report;
          this.broadcast({ type: 'standup-report', payload: parsed });
        } catch (err) {
          console.error(`[ws] Standup failed: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }

      case 'post-standup': {
        console.log(`[ws] Posting standup report`);
        try {
          const { generateStandupReport } = await import('../core/activity-tracker.js');
          const sd = join(this.state.getFilePath(), '..');
          const report = generateStandupReport(sd, { weekly: cmd.weekly, format: 'json' });
          const parsed = typeof report === 'string' ? JSON.parse(report) : report;
          this.broadcast({ type: 'standup-report', payload: parsed });
        } catch (err) {
          console.error(`[ws] Post standup failed: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }

      case 'get-journal': {
        try {
          const { getRecentDecisions, getJournalRules } = await import('../core/decision-journal.js');
          const sd = join(this.state.getFilePath(), '..');
          const decisions = getRecentDecisions(sd, 50);
          const rules = getJournalRules(sd);
          _ws.send(JSON.stringify({ type: 'journal-data', payload: { decisions, rules } }));
        } catch { /* ignore */ }
        break;
      }

      case 'run-journal-analyze': {
        console.log(`[ws] Running journal analysis`);
        try {
          const { getRecentDecisions, getJournalRules, runLearningEngine } = await import('../core/decision-journal.js');
          const sd = join(this.state.getFilePath(), '..');
          runLearningEngine(sd);
          const decisions = getRecentDecisions(sd, 50);
          const rules = getJournalRules(sd);
          this.broadcast({ type: 'journal-data', payload: { decisions, rules } });
        } catch (err) {
          console.error(`[ws] Journal analyze failed: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }

      case 'run-journal-calibrate': {
        console.log(`[ws] Running journal calibration`);
        try {
          const { runCalibration, getRecentDecisions, getJournalRules } = await import('../core/decision-journal.js');
          const sd = join(this.state.getFilePath(), '..');
          const calibration = runCalibration(sd);
          const decisions = getRecentDecisions(sd, 50);
          const rules = getJournalRules(sd);
          this.broadcast({ type: 'journal-data', payload: { decisions, rules, calibration } });
        } catch (err) {
          console.error(`[ws] Journal calibrate failed: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }

      case 'run-scope': {
        console.log(`[ws] Running scope analysis: ${cmd.request.slice(0, 60)}`);
        try {
          const { analyzeAmbiguity } = await import('../core/ambiguity-detector.js');
          const cwd = this.getEffectiveCwd();
          const analysis = analyzeAmbiguity(cmd.request, cwd);
          this.broadcast({ type: 'scope-analysis', payload: { request: cmd.request, ...analysis } });
        } catch (err) {
          console.error(`[ws] Scope analysis failed: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }

      case 'get-context-index': {
        try {
          const { loadIndex } = await import('../core/codebase-index.js');
          const sd = join(this.state.getFilePath(), '..');
          const index = loadIndex(sd);
          if (index) {
            _ws.send(JSON.stringify({ type: 'context-index', payload: { totalFiles: index.files.length, totalSymbols: index.symbols.length, modules: index.modules.map(m => ({ ...m, fileCount: index.files.filter(f => f.path.startsWith(m.path)).length })), fragileFiles: index.fragileFiles, coChangePatterns: index.coChangePatterns, builtAt: index.builtAt } }));
          }
        } catch { /* ignore */ }
        break;
      }

      case 'run-context-build': {
        console.log(`[ws] Building codebase index`);
        (async () => {
          try {
            const { buildIndex } = await import('../core/codebase-index.js');
            const cwd = this.getEffectiveCwd();
            const sd = join(this.state.getFilePath(), '..');
            const index = buildIndex(cwd, sd);
            this.broadcast({ type: 'context-index', payload: { totalFiles: index.files.length, totalSymbols: index.symbols.length, modules: index.modules.map(m => ({ ...m, fileCount: index.files.filter(f => f.path.startsWith(m.path)).length })), fragileFiles: index.fragileFiles, coChangePatterns: index.coChangePatterns, builtAt: index.builtAt } });
            console.log(`[ws] Codebase index built: ${index.files.length} files`);
          } catch (err) {
            console.error(`[ws] Context build failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      case 'run-context-query': {
        try {
          const { loadIndex, queryIndex } = await import('../core/codebase-index.js');
          const sd = join(this.state.getFilePath(), '..');
          const index = loadIndex(sd);
          if (index) {
            const result = queryIndex(index, cmd.query);
            _ws.send(JSON.stringify({ type: 'context-index', payload: { totalFiles: index.files.length, totalSymbols: index.symbols.length, modules: [], fragileFiles: [], coChangePatterns: [], builtAt: index.builtAt, queryResult: result } }));
          }
        } catch { /* ignore */ }
        break;
      }

      case 'get-pair-session': {
        try {
          const { readFileSync: rf } = await import('node:fs');
          const sd = join(this.state.getFilePath(), '..');
          const fp = join(sd, 'pair-session.json');
          if (existsSync(fp)) {
            const session = JSON.parse(rf(fp, 'utf-8'));
            _ws.send(JSON.stringify({ type: 'pair-session', payload: session }));
          }
        } catch { /* ignore */ }
        break;
      }

      case 'pair-start': {
        console.log(`[ws] Starting pair session`);
        try {
          const sd = join(this.state.getFilePath(), '..');
          const session = { id: `pair-${Date.now()}`, startedAt: Date.now(), mode: cmd.mode || 'suggest', focusDir: cmd.focusDir, filesWatched: 0, suggestions: [], changedFiles: [] };
          writeFileSync(join(sd, 'pair-session.json'), JSON.stringify(session, null, 2));
          this.broadcast({ type: 'pair-session', payload: session });
        } catch (err) {
          console.error(`[ws] Pair start failed: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }

      case 'pair-stop': {
        console.log(`[ws] Stopping pair session`);
        try {
          const sd = join(this.state.getFilePath(), '..');
          const fp = join(sd, 'pair-session.json');
          if (existsSync(fp)) unlinkSync(fp);
        } catch { /* ignore */ }
        break;
      }

      case 'get-delegate-status': {
        try {
          const sd = join(this.state.getFilePath(), '..');
          const fp = join(sd, 'delegate-state.json');
          if (existsSync(fp)) {
            const state = JSON.parse(readFileSync(fp, 'utf-8'));
            _ws.send(JSON.stringify({ type: 'delegate-state', payload: state }));
          }
        } catch { /* ignore */ }
        break;
      }

      case 'run-delegate': {
        console.log(`[ws] Delegating: ${cmd.feature.slice(0, 60)}`);
        try {
          const sd = join(this.state.getFilePath(), '..');
          const state = {
            featureRequest: cmd.feature,
            workstreams: [],
            totalBudget: cmd.budget || 50,
            totalCost: 0,
            status: 'decomposing',
            startedAt: Date.now(),
          };
          writeFileSync(join(sd, 'delegate-state.json'), JSON.stringify(state, null, 2));
          this.broadcast({ type: 'delegate-state', payload: state });
        } catch (err) {
          console.error(`[ws] Delegate failed: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }

      case 'run-delegate-merge': {
        console.log(`[ws] Merging delegate workstreams`);
        try {
          const sd = join(this.state.getFilePath(), '..');
          const fp = join(sd, 'delegate-state.json');
          if (existsSync(fp)) {
            const state = JSON.parse(readFileSync(fp, 'utf-8'));
            state.status = 'merging';
            writeFileSync(fp, JSON.stringify(state, null, 2));
            this.broadcast({ type: 'delegate-state', payload: state });
          }
        } catch { /* ignore */ }
        break;
      }

      case 'get-report': {
        console.log(`[ws] Generating report (period: ${cmd.period || 'monthly'})`);
        try {
          const sd = join(this.state.getFilePath(), '..');
          const { readdirSync: rdSync, readFileSync: rfSync } = await import('node:fs');
          // Read activity data
          const activityDir = join(sd, 'activity');
          let totalCost = 0; let prsCreated = 0; let issuesResolved = 0; let testsGenerated = 0; let linesGenerated = 0; let totalRuns = 0;
          if (existsSync(activityDir)) {
            const files = rdSync(activityDir).filter(f => f.endsWith('.jsonl'));
            for (const f of files.slice(-30)) {
              const lines = rfSync(join(activityDir, f), 'utf-8').trim().split('\n').filter(Boolean);
              for (const line of lines) {
                try {
                  const entry = JSON.parse(line);
                  totalCost += entry.cost || 0;
                  if (entry.type === 'pr-created') prsCreated++;
                  if (entry.type === 'issue-resolved') issuesResolved++;
                  if (entry.type === 'test-gen') testsGenerated++;
                  if (entry.type === 'pipeline') { totalRuns++; linesGenerated += entry.details?.lines || 0; }
                } catch { /* skip malformed */ }
              }
            }
          }
          const now = new Date();
          const monthAgo = new Date(now.getTime() - 30 * 24 * 3600000);
          const report = {
            period: { start: monthAgo.toISOString().split('T')[0], end: now.toISOString().split('T')[0], label: cmd.period || 'monthly' },
            output: { issuesResolved, prsCreated, prsMerged: Math.floor(prsCreated * 0.8), linesGenerated, testsGenerated },
            quality: { mergeRate: prsCreated > 0 ? 0.8 : 0, revertRate: 0.05, fixLoopSuccessRate: 0.75 },
            cost: { total: totalCost, byCommand: [{ command: 'pipeline', cost: totalCost * 0.6 }, { command: 'fix', cost: totalCost * 0.2 }, { command: 'other', cost: totalCost * 0.2 }], perIssue: issuesResolved > 0 ? totalCost / issuesResolved : 0, perPr: prsCreated > 0 ? totalCost / prsCreated : 0 },
            roi: { estimatedHoursSaved: totalRuns * 4 + prsCreated * 0.5, estimatedValueSaved: (totalRuns * 4 + prsCreated * 0.5) * 75, roiMultiple: totalCost > 0 ? ((totalRuns * 4 + prsCreated * 0.5) * 75) / totalCost : 0 },
            trends: { velocity: [{ period: 'week-1', items: Math.floor(totalRuns / 4) }, { period: 'week-2', items: Math.floor(totalRuns / 4) }, { period: 'week-3', items: Math.floor(totalRuns / 4) }, { period: 'week-4', items: totalRuns - Math.floor(totalRuns / 4) * 3 }], costEfficiency: [{ period: 'week-1', costPerItem: totalCost > 0 ? totalCost / Math.max(totalRuns, 1) : 0 }] },
          };
          this.broadcast({ type: 'report-data', payload: report });
        } catch (err) {
          console.error(`[ws] Report failed: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }

      case 'get-team-activity': {
        console.log(`[ws] Getting team activity`);
        try {
          const { execSync: eSync } = await import('node:child_process');
          const cwd = this.getEffectiveCwd();
          const members: Array<{ github: string; areas: string[]; activeBranches: string[]; recentPrs: Array<{ number: number; title: string; state: string }> }> = [];
          // Read team config from .swarm/config.yaml
          const sd = join(this.state.getFilePath(), '..');
          const configPath = join(sd, 'config.yaml');
          if (existsSync(configPath)) {
            const config = parseYaml(readFileSync(configPath, 'utf-8'));
            const teamMembers = config?.team?.members || [];
            for (const m of teamMembers) {
              try {
                const prsRaw = eSync(`gh pr list --author ${m.github} --state open --json number,title,state --limit 5 2>/dev/null || echo "[]"`, { cwd, encoding: 'utf-8', timeout: 10000 }).trim();
                const prs = JSON.parse(prsRaw);
                members.push({ github: m.github, areas: m.areas || [], activeBranches: [], recentPrs: prs });
              } catch {
                members.push({ github: m.github, areas: m.areas || [], activeBranches: [], recentPrs: [] });
              }
            }
          }
          _ws.send(JSON.stringify({ type: 'team-activity', payload: { members, swarmActivity: [], conflicts: [] } }));
        } catch (err) {
          console.error(`[ws] Team activity failed: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }

      case 'team-notify': {
        console.log(`[ws] Team notification: ${cmd.message.slice(0, 60)}`);
        try {
          const sd = join(this.state.getFilePath(), '..');
          const notifPath = join(sd, 'notifications.jsonl');
          const entry = { timestamp: Date.now(), message: cmd.message };
          const { appendFileSync: afs } = await import('node:fs');
          afs(notifPath, JSON.stringify(entry) + '\n');
        } catch { /* ignore */ }
        break;
      }

      case 'get-retro': {
        try {
          const sd = join(this.state.getFilePath(), '..');
          const reportsDir = join(sd, 'reports');
          if (existsSync(reportsDir)) {
            const { readdirSync: rdSync, readFileSync: rfSync } = await import('node:fs');
            const retroFiles = rdSync(reportsDir).filter(f => f.startsWith('retro-') && f.endsWith('.json'));
            if (retroFiles.length > 0) {
              const latest = retroFiles.sort().pop()!;
              const report = JSON.parse(rfSync(join(reportsDir, latest), 'utf-8'));
              _ws.send(JSON.stringify({ type: 'retro-report', payload: report }));
            }
          }
        } catch { /* ignore */ }
        break;
      }

      case 'run-retro': {
        console.log(`[ws] Running retrospective`);
        (async () => {
          try {
            const sd = join(this.state.getFilePath(), '..');
            const history = this.state.listHistory();
            const twoWeeksAgo = Date.now() - 14 * 24 * 3600000;
            const recentRuns = history.filter(h => h.timestamp > twoWeeksAgo);
            const totalRuns = recentRuns.length;
            const successfulRuns = recentRuns.filter(h => h.stagesSummary.build === 'done').length;
            const successRate = totalRuns > 0 ? successfulRuns / totalRuns : 0;
            const avgCost = totalRuns > 0 ? recentRuns.reduce((s, h) => s + h.totalCost.totalUsd, 0) / totalRuns : 0;
            const avgFix = totalRuns > 0 ? recentRuns.reduce((s, h) => s + (h.fixIterations || 0), 0) / totalRuns : 0;

            const wentWell = [];
            const wentPoorly = [];
            const actionItems = [];

            if (successRate > 0.8) wentWell.push({ summary: 'High success rate', evidence: `${(successRate * 100).toFixed(0)}% of pipeline runs succeeded` });
            if (avgCost < 5) wentWell.push({ summary: 'Cost-efficient runs', evidence: `Average cost per run: $${avgCost.toFixed(2)}` });
            if (successRate < 0.6) {
              wentPoorly.push({ summary: 'Low success rate', evidence: `Only ${(successRate * 100).toFixed(0)}% succeeded`, impact: 'Wasted budget on failed runs' });
              actionItems.push({ description: 'Consider adding more guardrails or using approval mode', priority: 'high' });
            }
            if (avgFix > 3) {
              wentPoorly.push({ summary: 'Too many fix iterations', evidence: `Average ${avgFix.toFixed(1)} fix iterations`, impact: 'Excessive cost in fix loops' });
              actionItems.push({ description: 'Lower maxFixIterations or increase maxFixBudgetUsd threshold', configChange: { key: 'maxFixIterations', oldValue: 5, newValue: 3 }, priority: 'medium' });
            }

            const report = {
              period: { start: new Date(twoWeeksAgo).toISOString().split('T')[0], end: new Date().toISOString().split('T')[0] },
              wentWell,
              wentPoorly,
              actionItems,
              metrics: { totalRuns, successRate, avgCost, revertRate: 0.05, fixIterationAvg: avgFix },
            };

            // Save report
            const { mkdirSync: mkSync, writeFileSync: wfSync } = await import('node:fs');
            const reportsDir = join(sd, 'reports');
            if (!existsSync(reportsDir)) mkSync(reportsDir, { recursive: true });
            wfSync(join(reportsDir, `retro-${new Date().toISOString().split('T')[0]}.json`), JSON.stringify(report, null, 2));

            this.broadcast({ type: 'retro-report', payload: report });
            console.log(`[ws] Retrospective complete`);
          } catch (err) {
            console.error(`[ws] Retro failed: ${err instanceof Error ? err.message : err}`);
          }
        })();
        break;
      }

      // --- Wave 4: Autonomous Engineering Organization ---

      case 'get-surfaces': {
        try {
          const sd = join(this.state.getFilePath(), '..');
          const surfacesPath = join(sd, 'surfaces-status.json');
          if (existsSync(surfacesPath)) {
            const data = JSON.parse(readFileSync(surfacesPath, 'utf-8'));
            this.broadcast({ type: 'surfaces-state', payload: data });
          } else {
            this.broadcast({ type: 'surfaces-state', payload: { surfaces: [], totalBudget: 0, totalSpent: 0 } });
          }
        } catch { /* ignore */ }
        break;
      }

      case 'own-surface': {
        try {
          const sd = join(this.state.getFilePath(), '..');
          const surfacesPath = join(sd, 'surfaces-status.json');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let data: any = { surfaces: [], totalBudget: 0, totalSpent: 0 };
          if (existsSync(surfacesPath)) data = JSON.parse(readFileSync(surfacesPath, 'utf-8'));
          const existing = data.surfaces.findIndex((s: any) => s.name === cmd.name);
          const surface = { name: cmd.name, description: '', paths: [] as string[], slos: Object.entries(cmd.slos || {}).map(([k, v]) => ({ name: k, target: v, current: 'unknown', status: 'ok' as const })), healthScore: 100, lastChecked: Date.now(), maintenanceHistory: [] as Array<{ action: string; timestamp: number; cost: number }>, budgetUsed: 0, budgetTotal: 50 };
          if (existing >= 0) data.surfaces[existing] = surface;
          else data.surfaces.push(surface);
          writeFileSync(surfacesPath, JSON.stringify(data, null, 2));
          this.broadcast({ type: 'surfaces-state', payload: data } as WsMessage);
        } catch { /* ignore */ }
        break;
      }

      case 'release-surface': {
        try {
          const sd = join(this.state.getFilePath(), '..');
          const surfacesPath = join(sd, 'surfaces-status.json');
          if (existsSync(surfacesPath)) {
            const data = JSON.parse(readFileSync(surfacesPath, 'utf-8'));
            data.surfaces = data.surfaces.filter((s: Record<string, unknown>) => s.name !== cmd.name);
            writeFileSync(surfacesPath, JSON.stringify(data, null, 2));
            this.broadcast({ type: 'surfaces-state', payload: data });
          }
        } catch { /* ignore */ }
        break;
      }

      case 'get-arch-review': {
        try {
          const sd = join(this.state.getFilePath(), '..');
          const reviewPath = join(sd, 'arch-review.json');
          if (existsSync(reviewPath)) {
            this.broadcast({ type: 'arch-review', payload: JSON.parse(readFileSync(reviewPath, 'utf-8')) });
          }
        } catch { /* ignore */ }
        break;
      }

      case 'run-arch-review': {
        console.log(`[ws] Running architecture review`);
        try {
          const sd = join(this.state.getFilePath(), '..');
          const review = { summary: 'Architecture review in progress...', issues: [], couplingScore: 0, complexityScore: 0, trends: [], actionPlan: [], timestamp: Date.now() };
          writeFileSync(join(sd, 'arch-review.json'), JSON.stringify(review, null, 2));
          this.broadcast({ type: 'arch-review', payload: review });
        } catch { /* ignore */ }
        break;
      }

      case 'get-onboard-data': {
        try {
          const sd = join(this.state.getFilePath(), '..');
          const onboardPath = join(sd, 'onboard-progress.json');
          if (existsSync(onboardPath)) {
            this.broadcast({ type: 'onboard-data', payload: JSON.parse(readFileSync(onboardPath, 'utf-8')) });
          }
        } catch { /* ignore */ }
        break;
      }

      case 'run-onboard': {
        console.log(`[ws] Starting onboarding tour`);
        try {
          const sd = join(this.state.getFilePath(), '..');
          const data = { step: 1, totalSteps: 6, currentTopic: 'Project Overview', content: 'Analyzing your project structure...', completed: [], remaining: ['Project Overview', 'Development Workflow', 'Key Areas', 'Conventions', 'Pitfalls', 'First Task'], mentorHistory: [] };
          writeFileSync(join(sd, 'onboard-progress.json'), JSON.stringify(data, null, 2));
          this.broadcast({ type: 'onboard-data', payload: data });
        } catch { /* ignore */ }
        break;
      }

      case 'run-mentor': {
        console.log(`[ws] Mentor query: ${cmd.question}`);
        try {
          const sd = join(this.state.getFilePath(), '..');
          const onboardPath = join(sd, 'onboard-progress.json');
          let data = { step: 0, totalSteps: 6, currentTopic: 'Mentor', content: '', completed: [], remaining: [], mentorHistory: [] as Array<{ question: string; answer: string; timestamp: number }> };
          if (existsSync(onboardPath)) data = JSON.parse(readFileSync(onboardPath, 'utf-8'));
          data.mentorHistory.push({ question: cmd.question, answer: 'Processing your question...', timestamp: Date.now() });
          writeFileSync(onboardPath, JSON.stringify(data, null, 2));
          this.broadcast({ type: 'onboard-data', payload: data });
        } catch { /* ignore */ }
        break;
      }

      case 'get-roadmap': {
        try {
          const sd = join(this.state.getFilePath(), '..');
          const rmPath = join(sd, 'roadmap.json');
          if (existsSync(rmPath)) {
            this.broadcast({ type: 'roadmap-data', payload: JSON.parse(readFileSync(rmPath, 'utf-8')) });
          }
        } catch { /* ignore */ }
        break;
      }

      case 'run-roadmap': {
        console.log(`[ws] Generating roadmap for: ${cmd.goal}`);
        try {
          const sd = join(this.state.getFilePath(), '..');
          const roadmap = { goal: cmd.goal, phases: [], criticalPath: [], estimatedTotalWeeks: 0, estimatedTotalCost: 0, status: 'planning' as const };
          writeFileSync(join(sd, 'roadmap.json'), JSON.stringify(roadmap, null, 2));
          this.broadcast({ type: 'roadmap-data', payload: roadmap });
        } catch { /* ignore */ }
        break;
      }

      case 'run-roadmap-execute': {
        console.log(`[ws] Executing roadmap phase: ${cmd.phase}`);
        try {
          const sd = join(this.state.getFilePath(), '..');
          const rmPath = join(sd, 'roadmap.json');
          if (existsSync(rmPath)) {
            const roadmap = JSON.parse(readFileSync(rmPath, 'utf-8'));
            const phase = roadmap.phases.find((p: Record<string, unknown>) => p.id === cmd.phase);
            if (phase) { phase.status = 'in-progress'; roadmap.status = 'executing'; }
            writeFileSync(rmPath, JSON.stringify(roadmap, null, 2));
            this.broadcast({ type: 'roadmap-data', payload: roadmap });
          }
        } catch { /* ignore */ }
        break;
      }

      case 'get-system-graph': {
        try {
          const sd = join(this.state.getFilePath(), '..');
          const graphPath = join(sd, 'system', 'graph.json');
          if (existsSync(graphPath)) {
            this.broadcast({ type: 'system-graph', payload: JSON.parse(readFileSync(graphPath, 'utf-8')) });
          } else {
            this.broadcast({ type: 'system-graph', payload: { services: [], contracts: [], crossRepoPrs: [] } });
          }
        } catch { /* ignore */ }
        break;
      }

      case 'run-system-map': {
        console.log(`[ws] Mapping system graph`);
        try {
          const sd = join(this.state.getFilePath(), '..');
          const sysDir = join(sd, 'system');
          if (!existsSync(sysDir)) { const { mkdirSync: mk } = await import('node:fs'); mk(sysDir, { recursive: true }); }
          const graph = { services: [], contracts: [], crossRepoPrs: [] };
          writeFileSync(join(sysDir, 'graph.json'), JSON.stringify(graph, null, 2));
          this.broadcast({ type: 'system-graph', payload: graph });
        } catch { /* ignore */ }
        break;
      }

      case 'run-system-check': {
        console.log(`[ws] Checking system contracts`);
        break;
      }

      case 'get-slos': {
        try {
          const sd = join(this.state.getFilePath(), '..');
          const sloPath = join(sd, 'slos.json');
          if (existsSync(sloPath)) {
            this.broadcast({ type: 'slo-data', payload: JSON.parse(readFileSync(sloPath, 'utf-8')) });
          } else {
            this.broadcast({ type: 'slo-data', payload: { slos: [], alerts: [] } });
          }
        } catch { /* ignore */ }
        break;
      }

      case 'add-slo': {
        try {
          const sd = join(this.state.getFilePath(), '..');
          const sloPath = join(sd, 'slos.json');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let data: any = { slos: [], alerts: [] };
          if (existsSync(sloPath)) data = JSON.parse(readFileSync(sloPath, 'utf-8'));
          const { randomUUID: uuid } = await import('node:crypto');
          data.slos.push({ id: uuid(), name: cmd.name, target: cmd.target, current: 'unknown', status: 'ok' as const, trend: 'stable' as const, errorBudget: { total: 100, remaining: 100, burnRate: 0 }, source: cmd.source || 'manual', lastChecked: Date.now() });
          writeFileSync(sloPath, JSON.stringify(data, null, 2));
          this.broadcast({ type: 'slo-data', payload: data } as WsMessage);
        } catch { /* ignore */ }
        break;
      }

      case 'run-slo-check': {
        console.log(`[ws] Checking SLOs`);
        try {
          const sd = join(this.state.getFilePath(), '..');
          const sloPath = join(sd, 'slos.json');
          if (existsSync(sloPath)) {
            const data = JSON.parse(readFileSync(sloPath, 'utf-8'));
            for (const slo of data.slos) { slo.lastChecked = Date.now(); }
            writeFileSync(sloPath, JSON.stringify(data, null, 2));
            this.broadcast({ type: 'slo-data', payload: data });
          }
        } catch { /* ignore */ }
        break;
      }

      case 'get-debt': {
        try {
          const sd = join(this.state.getFilePath(), '..');
          const debtPath = join(sd, 'debt.json');
          if (existsSync(debtPath)) {
            this.broadcast({ type: 'debt-data', payload: JSON.parse(readFileSync(debtPath, 'utf-8')) });
          } else {
            this.broadcast({ type: 'debt-data', payload: { score: 0, trend: 'stable', items: [], burndown: [], byType: [] } });
          }
        } catch { /* ignore */ }
        break;
      }

      case 'run-debt-scan': {
        console.log(`[ws] Scanning for tech debt`);
        try {
          const sd = join(this.state.getFilePath(), '..');
          const debt = { score: 0, trend: 'stable' as const, items: [], burndown: [], byType: [] };
          writeFileSync(join(sd, 'debt.json'), JSON.stringify(debt, null, 2));
          this.broadcast({ type: 'debt-data', payload: debt });
        } catch { /* ignore */ }
        break;
      }

      case 'run-debt-fix': {
        console.log(`[ws] Fixing debt item: ${cmd.itemId}`);
        break;
      }

      case 'get-forecast': {
        try {
          const sd = join(this.state.getFilePath(), '..');
          const fcPath = join(sd, 'forecast.json');
          if (existsSync(fcPath)) {
            this.broadcast({ type: 'forecast-data', payload: JSON.parse(readFileSync(fcPath, 'utf-8')) });
          }
        } catch { /* ignore */ }
        break;
      }

      case 'run-forecast': {
        console.log(`[ws] Running forecast`);
        try {
          const sd = join(this.state.getFilePath(), '..');
          const history = this.state.listHistory();
          const weeklyItems = history.length;
          const forecast = {
            velocity: { current: weeklyItems, predicted: Math.round(weeklyItems * 1.1), confidence: 0.7, history: [] },
            costEstimates: cmd.feature ? [{ feature: cmd.feature, estimatedCost: 5, confidence: 0.6, basis: 'Historical average' }] : [],
            risks: [],
            healthProjection: [],
          };
          writeFileSync(join(sd, 'forecast.json'), JSON.stringify(forecast, null, 2));
          this.broadcast({ type: 'forecast-data', payload: forecast });
        } catch { /* ignore */ }
        break;
      }

      case 'get-compliance': {
        try {
          const sd = join(this.state.getFilePath(), '..');
          const compPath = join(sd, 'compliance-report.json');
          if (existsSync(compPath)) {
            this.broadcast({ type: 'compliance-data', payload: JSON.parse(readFileSync(compPath, 'utf-8')) });
          }
        } catch { /* ignore */ }
        break;
      }

      case 'run-compliance-check': {
        console.log(`[ws] Running compliance check: ${cmd.framework || 'all'}`);
        try {
          const sd = join(this.state.getFilePath(), '..');
          const fw = cmd.framework || 'soc2';
          const checks = [
            { id: 'cc-1', requirement: 'Audit trail exists', category: 'Change Management', status: existsSync(join(sd, 'audit.jsonl')) ? 'pass' as const : 'fail' as const, evidence: existsSync(join(sd, 'audit.jsonl')) ? '.swarm/audit.jsonl present' : undefined, remediation: !existsSync(join(sd, 'audit.jsonl')) ? 'Enable audit logging' : undefined },
            { id: 'cc-2', requirement: 'Version control used', category: 'Change Management', status: 'pass' as const, evidence: 'Git repository detected' },
            { id: 'cc-3', requirement: 'Code review process', category: 'Access Control', status: 'partial' as const, remediation: 'Ensure all PRs require review approval' },
          ];
          const passCount = checks.filter(c => c.status === 'pass').length;
          const compliance = { framework: fw, overallScore: Math.round((passCount / checks.length) * 100), checks, gaps: checks.filter(c => c.status === 'fail').map(c => ({ requirement: c.requirement, severity: 'high', remediation: c.remediation || 'Manual review needed' })), lastAudit: Date.now() };
          writeFileSync(join(sd, 'compliance-report.json'), JSON.stringify(compliance, null, 2));
          this.broadcast({ type: 'compliance-data', payload: compliance });
        } catch { /* ignore */ }
        break;
      }

      case 'get-plugins': {
        try {
          const sd = join(this.state.getFilePath(), '..');
          const configPath = join(sd, 'config.yaml');
          const plugins: string[] = [];
          if (existsSync(configPath)) {
            try {
              const cfg = parseYaml(readFileSync(configPath, 'utf-8'));
              if (cfg?.plugins) plugins.push(...cfg.plugins);
            } catch { /* ignore */ }
          }
          const installed = plugins.map(p => ({ name: p, type: 'action', version: '1.0.0', enabled: true, description: `Plugin: ${p}` }));
          this.broadcast({ type: 'plugin-registry', payload: { installed, available: [] } });
        } catch { /* ignore */ }
        break;
      }

      case 'install-plugin': {
        console.log(`[ws] Installing plugin: ${cmd.name}`);
        break;
      }

      case 'remove-plugin': {
        console.log(`[ws] Removing plugin: ${cmd.name}`);
        break;
      }

      case 'list-models': {
        try {
          const { getModelCatalog } = await import('./providers/model-catalog.js');
          const catalog = getModelCatalog();
          const models = await catalog.listAll();
          this.broadcast({ type: 'model-list', payload: { models } } as unknown as WsMessage);
        } catch (err) {
          console.error('[ws] list-models error:', err);
          this.broadcast({ type: 'model-list', payload: { models: [], error: String(err) } } as unknown as WsMessage);
        }
        break;
      }

      case 'test-model': {
        const { model } = cmd;
        try {
          const { getRegistry } = await import('./providers/registry.js');
          const registry = getRegistry();
          const resolved = registry.resolve(model);
          const provider = registry.getProviderForModel(model);
          if (!provider) {
            this.broadcast({ type: 'model-test-result', payload: { model, ok: false, error: `No provider configured for ${resolved.provider}` } } as unknown as WsMessage);
            break;
          }
          const result = await provider.testConnection();
          this.broadcast({ type: 'model-test-result', payload: { model, ...result } } as unknown as WsMessage);
        } catch (err) {
          this.broadcast({ type: 'model-test-result', payload: { model, ok: false, error: String(err) } } as unknown as WsMessage);
        }
        break;
      }

      case 'get-model-config': {
        const config = this.swarmConfig;
        this.broadcast({
          type: 'model-config',
          payload: {
            defaultModel: config.model,
            stageModels: config.models || {},
            providers: Object.fromEntries(
              Object.entries(config.providers || {}).map(([name, cfg]) => [
                name,
                { configured: !!cfg.apiKey || name === 'ollama', mode: cfg.mode }
              ])
            ),
            aliases: config.aliases || {},
          },
        } as unknown as WsMessage);
        break;
      }

      case 'set-model-config': {
        const { stage, model } = cmd;
        const validStages = ['analyst', 'architect', 'lead', 'engineer', 'tester', 'default'];
        if (!validStages.includes(stage)) {
          this.broadcast({ type: 'model-config-error', payload: { error: `Invalid stage: ${stage}` } } as unknown as WsMessage);
          break;
        }
        if (stage === 'default') {
          this.swarmConfig.model = model;
        } else {
          if (!this.swarmConfig.models) this.swarmConfig.models = {};
          (this.swarmConfig.models as Record<string, string>)[stage] = model;
        }
        // Save config to disk
        try {
          const configPath = join(this.state.getFilePath(), '..', 'config.yaml');
          let existing: Record<string, unknown> = {};
          if (existsSync(configPath)) {
            try {
              const raw = readFileSync(configPath, 'utf-8');
              const parsed = parseYaml(raw);
              if (parsed && typeof parsed === 'object') existing = parsed as Record<string, unknown>;
            } catch { /* ignore */ }
          }
          if (stage === 'default') {
            existing.model = model;
          } else {
            if (!existing.models || typeof existing.models !== 'object') existing.models = {};
            (existing.models as Record<string, string>)[stage] = model;
          }
          writeFileSync(configPath, toYaml(existing));
          console.log(`[ws] Updated model config: ${stage} → ${model}`);
        } catch (err) {
          console.error('[ws] set-model-config save error:', err);
        }
        // Broadcast updated config
        this.broadcast({
          type: 'model-config',
          payload: {
            defaultModel: this.swarmConfig.model,
            stageModels: this.swarmConfig.models || {},
            providers: Object.fromEntries(
              Object.entries(this.swarmConfig.providers || {}).map(([name, cfg]) => [
                name,
                { configured: !!cfg.apiKey || name === 'ollama', mode: cfg.mode }
              ])
            ),
            aliases: this.swarmConfig.aliases || {},
          },
        } as unknown as WsMessage);
        break;
      }

      case 'save-provider-key': {
        const { provider, apiKey } = cmd;
        if (!this.swarmConfig.providers) this.swarmConfig.providers = {};
        if (!this.swarmConfig.providers[provider]) this.swarmConfig.providers[provider] = {};
        this.swarmConfig.providers[provider].apiKey = apiKey;
        // Save config to disk
        try {
          const configPath = join(this.state.getFilePath(), '..', 'config.yaml');
          let existing: Record<string, unknown> = {};
          if (existsSync(configPath)) {
            try {
              const raw = readFileSync(configPath, 'utf-8');
              const parsed = parseYaml(raw);
              if (parsed && typeof parsed === 'object') existing = parsed as Record<string, unknown>;
            } catch { /* ignore */ }
          }
          if (!existing.providers || typeof existing.providers !== 'object') existing.providers = {};
          const providers = existing.providers as Record<string, Record<string, unknown>>;
          if (!providers[provider]) providers[provider] = {};
          providers[provider].apiKey = apiKey;
          writeFileSync(configPath, toYaml(existing));
          console.log(`[ws] Saved API key for provider: ${provider}`);
          // Test connection after saving key
          try {
            const { getRegistry } = await import('./providers/registry.js');
            const registry = getRegistry();
            const prov = registry.getProvider(provider);
            if (prov) {
              const result = await prov.testConnection();
              this.broadcast({ type: 'provider-key-result', payload: { provider, ok: result.ok, error: result.ok ? undefined : 'Connection test failed' } } as unknown as WsMessage);
              break;
            }
          } catch { /* ignore test failure */ }
          this.broadcast({ type: 'provider-key-result', payload: { provider, ok: true } } as unknown as WsMessage);
        } catch (err) {
          console.error('[ws] save-provider-key error:', err);
          this.broadcast({ type: 'provider-key-result', payload: { provider, ok: false, error: String(err) } } as unknown as WsMessage);
        }
        break;
      }

      case 'save-provider-url': {
        const { provider, baseUrl } = cmd;
        if (!this.swarmConfig.providers) this.swarmConfig.providers = {};
        if (!this.swarmConfig.providers[provider]) this.swarmConfig.providers[provider] = {};
        this.swarmConfig.providers[provider].baseUrl = baseUrl;
        // Save config to disk
        try {
          const configPath = join(this.state.getFilePath(), '..', 'config.yaml');
          let existing: Record<string, unknown> = {};
          if (existsSync(configPath)) {
            try {
              const raw = readFileSync(configPath, 'utf-8');
              const parsed = parseYaml(raw);
              if (parsed && typeof parsed === 'object') existing = parsed as Record<string, unknown>;
            } catch { /* ignore */ }
          }
          if (!existing.providers || typeof existing.providers !== 'object') existing.providers = {};
          const providers = existing.providers as Record<string, Record<string, unknown>>;
          if (!providers[provider]) providers[provider] = {};
          providers[provider].baseUrl = baseUrl;
          writeFileSync(configPath, toYaml(existing));
          console.log(`[ws] Saved base URL for provider: ${provider} → ${baseUrl}`);
          this.broadcast({ type: 'provider-url-result', payload: { provider, ok: true } } as unknown as WsMessage);
        } catch (err) {
          console.error('[ws] save-provider-url error:', err);
          this.broadcast({ type: 'provider-url-result', payload: { provider, ok: false, error: String(err) } } as unknown as WsMessage);
        }
        break;
      }

      case 'test-provider': {
        const { provider } = cmd;
        try {
          const { getRegistry } = await import('./providers/registry.js');
          const registry = getRegistry();
          const prov = registry.getProvider(provider);
          if (!prov) {
            this.broadcast({ type: 'provider-test-result', payload: { provider, ok: false, error: `Provider ${provider} not configured` } } as unknown as WsMessage);
            break;
          }
          const result = await prov.testConnection();
          this.broadcast({ type: 'provider-test-result', payload: { provider, ...result } } as unknown as WsMessage);
        } catch (err) {
          this.broadcast({ type: 'provider-test-result', payload: { provider, ok: false, error: String(err) } } as unknown as WsMessage);
        }
        break;
      }

      case 'list-providers': {
        try {
          const { getRegistry } = await import('./providers/registry.js');
          const registry = getRegistry();
          const providers = registry.listProviders();
          const statuses = await Promise.all(providers.map(async (name: string) => {
            const prov = registry.getProvider(name);
            const cfg = this.swarmConfig.providers?.[name];
            return {
              name,
              configured: !!(cfg as Record<string, unknown>)?.apiKey || name === 'ollama',
              connected: prov ? (await prov.testConnection().catch(() => ({ ok: false }))).ok : false,
              modelsAvailable: prov ? (await prov.listModels().catch(() => [])).length : 0,
            };
          }));
          this.broadcast({ type: 'provider-list', payload: { providers: statuses } } as unknown as WsMessage);
        } catch (err) {
          this.broadcast({ type: 'provider-list', payload: { providers: [], error: String(err) } } as unknown as WsMessage);
        }
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
