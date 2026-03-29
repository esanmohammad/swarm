import { watch, readFileSync, existsSync, FSWatcher } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import type { WsMessage, WsCommand, PipelineState, Persona, AgentActivity } from '../types.js';
import { StateManager } from './state.js';
import { AgentManager } from './agent-manager.js';
import { Pipeline } from './pipeline.js';
import type { Agent, SwarmConfig } from '../types.js';

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
    'SYSTEM ENFORCEMENT: Organize into phases: Setup → Foundational (GATE) → User Stories (parallel after gate) → Polish.',
  ].join('\n'),
};

function isNonEngineer(persona: Persona): boolean {
  return persona === 'analyst' || persona === 'architect' || persona === 'lead';
}

export class SwarmWsServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private fileWatcher: FSWatcher | null = null;
  private lastStateJson = '';
  private projectCwd: string;
  private pipeline: Pipeline;

  constructor(
    private state: StateManager,
    private agentManager: AgentManager,
    config: SwarmConfig,
    projectCwd?: string,
  ) {
    // The working directory where artifacts live (REQUIREMENTS.md, etc.)
    this.projectCwd = projectCwd ?? process.cwd();
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

  start(port: number): void {
    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);

      // Send current state on connect — read fresh from disk
      const freshState = this.readStateFromDisk();
      const msg: WsMessage = { type: 'state', payload: freshState ?? this.state.getState() };
      ws.send(JSON.stringify(msg));

      ws.on('message', async (data) => {
        try {
          const cmd: WsCommand = JSON.parse(data.toString());
          await this.handleCommand(cmd, ws);
        } catch (err) {
          // Send error back to the client that sent the command
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[ws] Command error: ${errMsg}`);
          ws.send(JSON.stringify({
            type: 'agent-update',
            payload: { error: errMsg, status: 'error' },
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

      const newState: PipelineState = JSON.parse(newJson);
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
      return JSON.parse(raw);
    } catch {
      return null;
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
        'Ask clarifying questions first, then produce REQUIREMENTS.md. Once done, STOP.',
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
        'Phases: Setup → Foundational (GATE) → User Stories (parallel) → Polish.',
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
          cwd: this.projectCwd,
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
        await this.agentManager.sendInput(cmd.agentId, cmd.text);
        break;
      }

      case 'get-state':
        this.broadcast({ type: 'state', payload: this.state.getState() });
        break;

      case 'run-stage': {
        const stageStack = this.state.getState().stack;
        const stageOpts = { stack: stageStack, interactive: false };

        console.log(`[ws] Running pipeline stage: ${cmd.stage}`);

        // Run in background — don't block the WS command handler
        (async () => {
          try {
            switch (cmd.stage) {
              case 'analyze':
                await this.pipeline.runAnalyze(cmd.prompt || 'Analyze the project', stageOpts);
                break;
              case 'architect':
                await this.pipeline.runArchitect(stageOpts);
                break;
              case 'plan':
                await this.pipeline.runPlan(stageOpts);
                break;
              case 'build':
                await this.pipeline.runBuild({
                  stack: stageStack,
                  parallel: cmd.parallel ?? 3,
                  taskId: cmd.taskId,
                });
                break;
            }
            console.log(`[ws] Pipeline stage "${cmd.stage}" complete`);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(`[ws] Pipeline stage "${cmd.stage}" failed: ${errMsg}`);
          }
        })();
        break;
      }
    }
  }

  get port(): number | undefined {
    const addr = this.wss?.address();
    return typeof addr === 'object' ? addr?.port : undefined;
  }
}
