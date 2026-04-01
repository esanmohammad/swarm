import { EventEmitter } from 'node:events';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { v4 as uuid } from 'uuid';
import { AgentProcess } from './agent-process.js';
import { StateManager } from './state.js';
import { CostTracker } from './cost-tracker.js';
import { PromptLoader } from '../prompts/loader.js';
import type { Agent, Persona, TechStack, SwarmConfig, CostInfo, AgentActivity } from '../types.js';
import { emptyCost, PERSONA_STAGE_MAP } from '../types.js';

export interface SpawnOptions {
  name: string;
  persona: Persona;
  stack: TechStack;
  prompt: string;
  model?: string;
  maxBudgetUsd?: number | null;
  cwd: string;
  /** Run in interactive mode (stdio inherited, user can converse) */
  interactive?: boolean;
  /** Override permission mode for this agent */
  permissionMode?: import('../types.js').PermissionMode;
  /** ID of parent orchestrator agent (for sub-engineers) */
  parentId?: string;
  /** Override allowed tools for this agent */
  allowedTools?: string[];
  /** Override disallowed tools for this agent */
  disallowedTools?: string[];
  /** Appended system prompt — system-level enforcement the agent cannot ignore */
  appendSystemPrompt?: string;
  /** Timeout in ms — kill agent if no output for this duration. Default: 30 min */
  timeoutMs?: number;
}

/** Max in-memory output per agent (50KB). Full output is in JSONL logs. */
const MAX_OUTPUT_BYTES = 50 * 1024;
/** Max output stored in state.json per agent (2KB) to keep state file small. */
const MAX_STATE_OUTPUT_BYTES = 2 * 1024;

export class AgentManager extends EventEmitter {
  private agents = new Map<string, { agent: Agent; process: AgentProcess }>();
  /** Maps Claude-internal Agent tool_use_id → virtual agent id */
  private subAgentMap = new Map<string, string>();

  /** Cap agent output to MAX_OUTPUT_BYTES, keeping the tail (ring-buffer style) */
  private appendOutput(agent: Agent, chunk: string): void {
    agent.output += chunk;
    if (agent.output.length > MAX_OUTPUT_BYTES) {
      agent.output = agent.output.slice(-MAX_OUTPUT_BYTES);
    }
  }

  /** Get truncated output for state.json (last 2KB) */
  getStateOutput(agent: Agent): string {
    if (agent.output.length <= MAX_STATE_OUTPUT_BYTES) return agent.output;
    return agent.output.slice(-MAX_STATE_OUTPUT_BYTES);
  }

  /** Append a JSONL log entry for an agent to .swarm/logs/{agentId}.jsonl */
  private appendLog(agentId: string, entry: Record<string, unknown>): void {
    try {
      const logsDir = this.state.getLogsDir();
      const logPath = join(logsDir, `${agentId}.jsonl`);
      appendFileSync(logPath, JSON.stringify(entry) + '\n');
    } catch {
      // Non-critical — don't crash if logging fails
    }
  }

  constructor(
    private state: StateManager,
    private costTracker: CostTracker,
    private promptLoader: PromptLoader,
    private config: SwarmConfig,
  ) {
    super();

    // Listen for aggregate budget exceeded — kill all agents immediately
    this.costTracker.on('budget-exceeded', (total: CostInfo) => {
      const budget = this.costTracker.getBudget();
      console.error(`\n\x1b[31mBudget reached: $${total.totalUsd.toFixed(2)} spent (limit: $${budget})\x1b[0m`);
      console.error(`To increase: swarm mayday --budget 15 or edit .swarm/config.yaml (maxBudgetUsd)`);
      console.error(`To remove limit: swarm init --budget 0\n`);
      this.killAll();
      this.emit('budget-exceeded', total);
    });
  }

  async spawn(opts: SpawnOptions): Promise<Agent> {
    let systemPrompt: string | undefined;
    try {
      systemPrompt = await this.promptLoader.load(opts.persona, opts.stack);
    } catch {
      // No system prompt found — run without one
      systemPrompt = undefined;
    }

    const sessionId = uuid();
    const permissionMode = opts.permissionMode || this.config.permissions.permissionMode || 'default';
    const agent: Agent = {
      id: uuid(),
      name: opts.name,
      persona: opts.persona,
      stack: opts.stack,
      status: 'pending',
      pid: null,
      sessionId,
      model: opts.model || this.config.model,
      permissionMode: permissionMode as import('../types.js').PermissionMode,
      startedAt: null,
      finishedAt: null,
      cost: emptyCost(),
      output: '',
      error: null,
      parentId: opts.parentId ?? null,
      childIds: [],
      allowedTools: opts.allowedTools,
      disallowedTools: opts.disallowedTools,
      appendSystemPrompt: opts.appendSystemPrompt,
    };

    const agentProcess = new AgentProcess({
      prompt: opts.prompt,
      systemPrompt,
      appendSystemPrompt: opts.appendSystemPrompt,
      model: agent.model,
      sessionId,
      maxBudgetUsd: opts.maxBudgetUsd ?? this.config.maxBudgetUsd,
      permissionMode,
      allowedTools: opts.allowedTools ?? this.config.permissions.allowedTools,
      disallowedTools: opts.disallowedTools ?? this.config.permissions.disallowedTools,
      cwd: opts.cwd,
      interactive: opts.interactive,
      timeoutMs: opts.timeoutMs,
    });

    // Wire events
    agentProcess.on('content', (chunk) => {
      this.appendOutput(agent, chunk);
      this.emit('agent-output', { agentId: agent.id, chunk });
      this.appendLog(agent.id, { type: 'output', timestamp: Date.now(), chunk });
    });

    agentProcess.on('activity', (activity) => {
      const full: AgentActivity = { ...activity, agentId: agent.id };
      this.emit('agent-activity', full);
      this.appendLog(agent.id, { type: 'activity', timestamp: Date.now(), activity: full });
    });

    this.wireSubAgentEvents(agentProcess, agent);

    agentProcess.on('result', ({ result, cost, sessionId: sid }) => {
      agent.status = 'done';
      agent.cost = cost;
      agent.sessionId = sid;
      agent.finishedAt = Date.now();
      agent.output = result || agent.output;
      this.costTracker.record(agent.id, cost);
      this.state.updateAgent(agent);
      this.emit('agent-done', agent);
    });

    agentProcess.on('error-output', (text) => {
      if (!agent.error) agent.error = '';
      agent.error += text;
    });

    agentProcess.on('exit', (code) => {
      if (agent.status === 'done') return; // already handled by result event
      if (agentProcess.timedOut) {
        agent.status = 'error';
        agent.finishedAt = Date.now();
        agent.error = agent.error || 'Agent killed due to inactivity timeout';
        this.state.updateAgent(agent);
        this.emit('agent-error', agent);
      } else if (code !== 0) {
        agent.status = 'error';
        agent.finishedAt = Date.now();
        if (!agent.error) {
          agent.error = `Process exited with code ${code}`;
        }
        this.state.updateAgent(agent);
        this.emit('agent-error', agent);
      } else {
        // Exited cleanly but no result event yet (interactive mode)
        // Mark as done after a short delay to let result event fire first
        setTimeout(() => {
          if (agent.status === 'running') {
            agent.status = 'done';
            agent.finishedAt = Date.now();
            this.state.updateAgent(agent);
            this.emit('agent-done', agent);
          }
        }, 100);
      }
    });

    // Start the process
    agentProcess.start();
    agent.status = 'running';
    agent.pid = agentProcess.pid ?? null;
    agent.startedAt = Date.now();

    this.agents.set(agent.id, { agent, process: agentProcess });
    this.state.addAgent(agent);

    // Update pipeline stage
    const stage = PERSONA_STAGE_MAP[opts.persona];
    this.state.updateStage(stage, {
      status: 'running',
      agentIds: [...(this.state.getState().stages[stage].agentIds), agent.id],
    });

    this.emit('agent-spawned', agent);
    return agent;
  }

  kill(agentId: string): boolean {
    const entry = this.agents.get(agentId);
    if (!entry) return false;

    entry.process.kill();
    entry.agent.status = 'killed';
    entry.agent.finishedAt = Date.now();
    this.state.updateAgent(entry.agent);
    this.emit('agent-killed', entry.agent);
    return true;
  }

  /**
   * Send a follow-up message to a completed/done agent by resuming its session.
   * This spawns a new `claude -p "<text>" --resume <session-id>` process,
   * allowing the user to answer questions or provide input the agent requested.
   */
  async sendInput(agentId: string, text: string): Promise<void> {
    const entry = this.agents.get(agentId);
    if (!entry) throw new Error(`Agent ${agentId} not found`);

    const { agent } = entry;

    // Resume the session with the user's input
    console.log(`[agent-manager] Sending input to "${agent.name}": ${text.slice(0, 80)}...`);

    // Update agent status back to running
    agent.status = 'running';
    agent.finishedAt = null;
    this.state.updateAgent(agent);
    const userChunk = `\n\n> User: ${text}\n\n`;
    this.emit('agent-output', { agentId, chunk: userChunk });
    this.appendLog(agentId, { type: 'output', timestamp: Date.now(), chunk: userChunk });

    // Spawn a new process that resumes the session — carry over ALL restrictions
    const resumeProcess = new AgentProcess({
      prompt: text,
      model: agent.model,
      sessionId: agent.sessionId,
      permissionMode: agent.permissionMode,
      allowedTools: agent.allowedTools,
      disallowedTools: agent.disallowedTools,
      appendSystemPrompt: agent.appendSystemPrompt,
      cwd: process.cwd(),
      resume: true,
    });

    // Wire events to the same agent
    resumeProcess.on('content', (chunk) => {
      this.appendOutput(agent, chunk);
      this.emit('agent-output', { agentId, chunk });
      this.appendLog(agentId, { type: 'output', timestamp: Date.now(), chunk });
    });

    resumeProcess.on('activity', (activity) => {
      const full: AgentActivity = { ...activity, agentId };
      this.emit('agent-activity', full);
      this.appendLog(agentId, { type: 'activity', timestamp: Date.now(), activity: full });
    });

    this.wireSubAgentEvents(resumeProcess, agent);

    resumeProcess.on('result', ({ result, cost, sessionId: sid }) => {
      agent.status = 'done';
      // Accumulate cost
      agent.cost = {
        totalUsd: agent.cost.totalUsd + cost.totalUsd,
        inputTokens: agent.cost.inputTokens + cost.inputTokens,
        outputTokens: agent.cost.outputTokens + cost.outputTokens,
        cacheReadTokens: agent.cost.cacheReadTokens + cost.cacheReadTokens,
        cacheWriteTokens: agent.cost.cacheWriteTokens + cost.cacheWriteTokens,
        durationMs: agent.cost.durationMs + cost.durationMs,
      };
      agent.finishedAt = Date.now();
      if (result) agent.output += result;
      this.costTracker.record(agent.id, agent.cost);
      this.state.updateAgent(agent);
      this.emit('agent-done', agent);
    });

    resumeProcess.on('error-output', (errText) => {
      console.error(`[agent-manager] ${agent.name} stderr: ${errText}`);
      if (!agent.error) agent.error = '';
      agent.error += errText;
      // Also show errors in the output stream so dashboard user can see them
      const errChunk = `\n[stderr] ${errText}`;
      this.emit('agent-output', { agentId, chunk: errChunk });
      this.appendLog(agentId, { type: 'output', timestamp: Date.now(), chunk: errChunk });
    });

    resumeProcess.on('exit', (code) => {
      if (code !== 0 && agent.status !== 'done') {
        agent.status = 'error';
        agent.finishedAt = Date.now();
        this.state.updateAgent(agent);
        this.emit('agent-error', agent);
      } else {
        setTimeout(() => {
          if (agent.status === 'running') {
            agent.status = 'done';
            agent.finishedAt = Date.now();
            this.state.updateAgent(agent);
            this.emit('agent-done', agent);
          }
        }, 100);
      }
    });

    // Replace the old process reference
    this.agents.set(agentId, { agent, process: resumeProcess });
    resumeProcess.start();
  }

  killAll(): void {
    for (const [id] of this.agents) {
      this.kill(id);
    }
  }

  list(): Agent[] {
    return Array.from(this.agents.values()).map((e) => e.agent);
  }

  get(agentId: string): Agent | undefined {
    return this.agents.get(agentId)?.agent;
  }

  getByName(name: string): Agent | undefined {
    for (const { agent } of this.agents.values()) {
      if (agent.name === name) return agent;
    }
    return undefined;
  }

  /**
   * Wire sub-agent events: when an agent uses Claude's Agent tool internally,
   * create virtual child agent entries so they appear in the dashboard sidebar.
   */
  private wireSubAgentEvents(process: AgentProcess, parentAgent: Agent): void {
    process.on('sub-agent-start', (info) => {
      const virtualId = uuid();
      this.subAgentMap.set(info.toolUseId, virtualId);

      const virtualAgent: Agent = {
        id: virtualId,
        name: `sub:${info.description.slice(0, 30)}`,
        persona: 'engineer',
        stack: parentAgent.stack,
        status: 'running',
        pid: null,
        sessionId: `virtual-${info.toolUseId}`,
        model: parentAgent.model,
        permissionMode: parentAgent.permissionMode,
        startedAt: Date.now(),
        finishedAt: null,
        cost: emptyCost(),
        output: '',
        error: null,
        parentId: parentAgent.id,
        childIds: [],
      };

      // Register as child of parent
      if (!parentAgent.childIds.includes(virtualId)) {
        parentAgent.childIds.push(virtualId);
        this.state.updateAgent(parentAgent);
      }

      // Add to state
      this.state.addAgent(virtualAgent);
      this.emit('agent-spawned', virtualAgent);

      // Emit initial activity + output so dashboard has something to show
      const startMsg = `Spawned by ${parentAgent.name}\nTask: ${info.description}\n\nRunning...`;
      this.emit('agent-output', { agentId: virtualId, chunk: startMsg });
      this.emit('agent-activity', {
        id: `vact-${virtualId}-start`,
        agentId: virtualId,
        kind: 'text' as const,
        summary: `Spawned by ${parentAgent.name} — ${info.description}`,
        content: info.prompt || undefined,
        timestamp: Date.now(),
      });
    });

    process.on('sub-agent-end', (info) => {
      const virtualId = this.subAgentMap.get(info.toolUseId);
      if (!virtualId) return;
      this.subAgentMap.delete(info.toolUseId);

      // Find the virtual agent in state and mark done
      const stateAgents = this.state.getState().agents;
      const virtualAgent = stateAgents.find((a) => a.id === virtualId);
      if (virtualAgent) {
        virtualAgent.status = 'done';
        virtualAgent.finishedAt = Date.now();
        virtualAgent.output = info.result;
        this.state.updateAgent(virtualAgent);

        // Emit result as output + activity so dashboard shows it
        this.emit('agent-output', { agentId: virtualId, chunk: `\n\n--- Result ---\n${info.result}` });
        this.emit('agent-activity', {
          id: `vact-${virtualId}-end`,
          agentId: virtualId,
          kind: 'text' as const,
          summary: info.result.slice(0, 200),
          content: info.result,
          timestamp: Date.now(),
        });

        this.emit('agent-done', virtualAgent);
      }
    });
  }

  /** Register a child agent under a parent orchestrator */
  addChild(parentId: string, childId: string): void {
    const parent = this.agents.get(parentId);
    if (parent && !parent.agent.childIds.includes(childId)) {
      parent.agent.childIds.push(childId);
      this.state.updateAgent(parent.agent);
    }
  }

  waitForAgent(agentId: string): Promise<Agent> {
    return new Promise((resolve, reject) => {
      const entry = this.agents.get(agentId);
      if (!entry) {
        reject(new Error(`Agent ${agentId} not found`));
        return;
      }
      if (entry.agent.status === 'done') {
        resolve(entry.agent);
        return;
      }
      if (entry.agent.status === 'error' || entry.agent.status === 'killed') {
        reject(new Error(`Agent ${entry.agent.name} ${entry.agent.status}: ${entry.agent.error}`));
        return;
      }

      const onDone = (agent: Agent) => {
        if (agent.id === agentId) {
          this.off('agent-done', onDone);
          this.off('agent-error', onError);
          resolve(agent);
        }
      };
      const onError = (agent: Agent) => {
        if (agent.id === agentId) {
          this.off('agent-done', onDone);
          this.off('agent-error', onError);
          reject(new Error(`Agent ${agent.name} failed: ${agent.error}`));
        }
      };
      this.on('agent-done', onDone);
      this.on('agent-error', onError);
    });
  }
}
