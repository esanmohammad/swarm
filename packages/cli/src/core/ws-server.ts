import { watch, readFileSync, existsSync, FSWatcher } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import type { WsMessage, WsCommand, PipelineState } from '../types.js';
import { StateManager } from './state.js';
import { AgentManager } from './agent-manager.js';
import type { Agent } from '../types.js';

export class SwarmWsServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private fileWatcher: FSWatcher | null = null;
  private lastStateJson = '';
  private projectCwd: string;

  constructor(
    private state: StateManager,
    private agentManager: AgentManager,
    projectCwd?: string,
  ) {
    // The working directory where artifacts live (REQUIREMENTS.md, etc.)
    this.projectCwd = projectCwd ?? process.cwd();

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

    this.fileWatcher = watch(stateFile, { persistent: false }, () => {
      this.debouncedFileCheck(stateFile);
    });
  }

  private fileCheckTimer: ReturnType<typeof setTimeout> | null = null;

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

  private async handleCommand(cmd: WsCommand, _ws: WebSocket): Promise<void> {
    switch (cmd.action) {
      case 'spawn': {
        const prompt = cmd.prompt?.trim()
          || `Execute the ${cmd.persona} workflow for a ${cmd.stack} project`;

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
    }
  }

  get port(): number | undefined {
    const addr = this.wss?.address();
    return typeof addr === 'object' ? addr?.port : undefined;
  }
}
