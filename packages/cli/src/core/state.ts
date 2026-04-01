import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { PipelineState, Agent, StageName, StageState, MaydayState, HistoryEntry } from '../types.js';
import { createEmptyPipeline, emptyCost, addCosts } from '../types.js';

export class StateManager extends EventEmitter {
  private state: PipelineState;
  private filePath: string;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private namespace: string;

  constructor(private swarmDir: string, namespace = 'default') {
    super();
    this.namespace = namespace;
    this.filePath = namespace === 'default'
      ? join(swarmDir, 'state.json')
      : join(swarmDir, 'pipelines', `${namespace}.json`);

    this.state = this.loadStateWithRecovery();
  }

  getNamespace(): string {
    return this.namespace;
  }

  /** List all pipeline namespaces */
  static listPipelines(swarmDir: string): string[] {
    const names = ['default'];
    const pipelinesDir = join(swarmDir, 'pipelines');
    if (existsSync(pipelinesDir)) {
      try {
        const files = readdirSync(pipelinesDir).filter(f => f.endsWith('.json'));
        for (const f of files) {
          names.push(f.replace('.json', ''));
        }
      } catch { /* ignore */ }
    }
    return names;
  }

  /** Switch to a different pipeline namespace */
  switchTo(namespace: string): void {
    this.flush();
    this.namespace = namespace;
    this.filePath = namespace === 'default'
      ? join(this.swarmDir, 'state.json')
      : join(this.swarmDir, 'pipelines', `${namespace}.json`);
    if (namespace !== 'default') {
      const dir = join(this.swarmDir, 'pipelines');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    this.state = this.loadStateWithRecovery();
  }

  /** Try loading state.json, fall back to state.json.bak, then empty state */
  private loadStateWithRecovery(): PipelineState {
    const backupPath = this.filePath + '.bak';

    // Try primary file
    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, 'utf-8');
        const state = JSON.parse(raw) as PipelineState;
        this.migrateStages(state);
        return state;
      } catch {
        console.error('[state] Failed to parse state.json — trying backup...');
      }
    }

    // Try backup
    if (existsSync(backupPath)) {
      try {
        const raw = readFileSync(backupPath, 'utf-8');
        const state = JSON.parse(raw) as PipelineState;
        this.migrateStages(state);
        console.log('[state] Recovered from state.json.bak');
        return state;
      } catch {
        console.error('[state] Backup also corrupted — starting fresh.');
      }
    }

    return createEmptyPipeline('unknown', 'react');
  }

  /** Ensure all expected stages exist after loading */
  private migrateStages(state: PipelineState): void {
    const emptyStage = (): StageState => ({ status: 'pending', agentIds: [], artifact: null });
    const expectedStages: StageName[] = ['analyze', 'architect', 'plan', 'build', 'test', 'evaluate'];
    for (const stage of expectedStages) {
      if (!state.stages[stage]) {
        state.stages[stage] = emptyStage();
      }
    }
  }

  getState(): PipelineState {
    return this.state;
  }

  getFilePath(): string {
    return this.filePath;
  }

  /** Returns the path to .swarm/logs/, creating it on first call. */
  getLogsDir(): string {
    const logsDir = join(this.swarmDir, 'logs');
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }
    return logsDir;
  }

  /** Replace in-memory state with data from disk (cross-process sync) */
  reloadFrom(newState: PipelineState): void {
    this.state = newState;
  }

  init(projectName: string, stack: import('../types.js').TechStack): void {
    this.state = createEmptyPipeline(projectName, stack);
    this.save();
  }

  /**
   * Kill OS processes for agents that are still marked as running/pending.
   * These are orphans from a previous swarm session that crashed.
   * Should be called before cleanupStaleAgents().
   */
  killOrphanProcesses(): void {
    for (const agent of this.state.agents) {
      if ((agent.status === 'running' || agent.status === 'pending') && agent.pid) {
        try {
          // signal 0 = existence check, throws if process doesn't exist
          process.kill(agent.pid, 0);
          // Process is alive — kill it
          console.log(`[state] Killing orphaned process PID ${agent.pid} (agent: ${agent.name})`);
          process.kill(agent.pid, 'SIGTERM');
          // Schedule SIGKILL as fallback
          const pid = agent.pid;
          setTimeout(() => {
            try {
              process.kill(pid, 'SIGKILL');
            } catch { /* already dead */ }
          }, 3000);
        } catch {
          // Process doesn't exist — already dead, nothing to do
        }
      }
    }
  }

  /**
   * Remove completed/error/killed agents and reset any "running" agents
   * to "error" (they can't still be running if the process restarted).
   * Called on dashboard startup to clean stale state.
   */
  cleanupStaleAgents(): void {
    // Mark any "running" agents as error (orphaned from a previous process)
    for (const agent of this.state.agents) {
      if (agent.status === 'running' || agent.status === 'pending') {
        agent.status = 'error';
        agent.error = 'Orphaned: process that spawned this agent is no longer running';
        agent.finishedAt = agent.finishedAt ?? Date.now();
      }
    }

    // Remove all finished agents (done, error, killed)
    this.state.agents = [];

    // Reset all stages to pending since we're starting fresh
    for (const stage of Object.values(this.state.stages)) {
      stage.status = 'pending';
      stage.agentIds = [];
    }

    this.recalcTotalCost();
    this.state.updatedAt = Date.now();
    this.save();
  }

  addAgent(agent: Agent): void {
    this.state.agents.push(agent);
    this.state.updatedAt = Date.now();
    this.scheduleSave();
    this.emit('agent-update', agent);
  }

  updateAgent(agent: Agent): void {
    const idx = this.state.agents.findIndex((a) => a.id === agent.id);
    if (idx >= 0) {
      this.state.agents[idx] = agent;
    } else {
      this.state.agents.push(agent);
    }
    this.recalcTotalCost();
    this.state.updatedAt = Date.now();
    this.scheduleSave();
    this.emit('agent-update', agent);
  }

  removeAgent(agentId: string): void {
    this.state.agents = this.state.agents.filter((a) => a.id !== agentId);
    this.recalcTotalCost();
    this.state.updatedAt = Date.now();
    this.scheduleSave();
    this.emit('state-change', this.state);
  }

  getAgent(agentId: string): Agent | undefined {
    return this.state.agents.find((a) => a.id === agentId);
  }

  updateStage(name: StageName, update: Partial<StageState>): void {
    Object.assign(this.state.stages[name], update);
    this.state.updatedAt = Date.now();
    this.scheduleSave();
    this.emit('state-change', this.state);
  }

  getMayday(): MaydayState | undefined {
    return this.state.mayday;
  }

  updateMayday(update: Partial<MaydayState>): void {
    if (!this.state.mayday) return;
    Object.assign(this.state.mayday, update);
    this.state.updatedAt = Date.now();
    this.scheduleSave();
    this.emit('state-change', this.state);
  }

  setMayday(mayday: MaydayState | undefined): void {
    this.state.mayday = mayday;
    this.state.updatedAt = Date.now();
    this.scheduleSave();
    this.emit('state-change', this.state);
  }

  /** Push a user message into the mayday queue */
  pushMaydayMessage(text: string): void {
    if (!this.state.mayday) return;
    this.state.mayday.userMessages.push(text);
    this.state.updatedAt = Date.now();
    this.scheduleSave();
    this.emit('state-change', this.state);
  }

  /** Consume and clear all queued mayday user messages */
  consumeMaydayMessages(): string[] {
    if (!this.state.mayday) return [];
    const msgs = [...this.state.mayday.userMessages];
    this.state.mayday.userMessages = [];
    this.scheduleSave();
    return msgs;
  }

  /** Returns the path to .swarm/history/, creating it on first call. */
  getHistoryDir(): string {
    const historyDir = join(this.swarmDir, 'history');
    if (!existsSync(historyDir)) {
      mkdirSync(historyDir, { recursive: true });
    }
    return historyDir;
  }

  /** Copy current state to .swarm/history/{timestamp}-{projectName}.json, return the runId. */
  archiveRun(): string {
    this.flush(); // ensure state is fully written before archiving

    const runId = randomUUID();
    const now = Date.now();
    const safeProjectName = this.state.projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${now}-${safeProjectName}.json`;
    const historyDir = this.getHistoryDir();

    // Build a HistoryEntry
    const stagesSummary: Record<string, string> = {};
    for (const [name, stage] of Object.entries(this.state.stages)) {
      stagesSummary[name] = stage.status === 'running' ? 'error' : stage.status;
    }

    const startedAt = this.state.mayday?.startedAt
      ?? Math.min(...this.state.agents.filter(a => a.startedAt).map(a => a.startedAt!), now);
    const durationMs = now - startedAt;

    const entry: HistoryEntry = {
      runId,
      timestamp: now,
      projectName: this.state.projectName,
      stack: this.state.stack,
      totalCost: { ...this.state.totalCost },
      stagesSummary: stagesSummary as HistoryEntry['stagesSummary'],
      featureRequest: this.state.mayday?.featureRequest,
      durationMs,
    };

    try {
      writeFileSync(join(historyDir, filename), JSON.stringify(entry, null, 2));
      console.log(`[state] Archived run to history/${filename}`);
    } catch (err) {
      console.error(`[state] Failed to archive run: ${err instanceof Error ? err.message : err}`);
    }

    return runId;
  }

  /** Read all JSON files in history dir, parse each, return sorted by timestamp desc. */
  listHistory(): HistoryEntry[] {
    const historyDir = join(this.swarmDir, 'history');
    if (!existsSync(historyDir)) return [];

    const entries: HistoryEntry[] = [];
    try {
      const files = readdirSync(historyDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = readFileSync(join(historyDir, file), 'utf-8');
          const entry: HistoryEntry = JSON.parse(raw);
          entries.push(entry);
        } catch {
          // Skip malformed history files
        }
      }
    } catch {
      // History dir unreadable
    }

    return entries.sort((a, b) => b.timestamp - a.timestamp);
  }

  private recalcTotalCost(): void {
    this.state.totalCost = this.state.agents.reduce(
      (acc, a) => addCosts(acc, a.cost),
      emptyCost(),
    );
  }

  /** Trigger a debounced save (public for Pipeline quality scoring) */
  scheduleSavePublic(): void {
    this.scheduleSave();
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (!this.writeTimer) {
      this.writeTimer = setTimeout(() => {
        this.writeTimer = null;
        if (this.dirty) {
          this.save();
          this.dirty = false;
        }
      }, 100);
    }
  }

  save(): void {
    const dir = this.swarmDir;
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const tmpPath = this.filePath + '.tmp';
    const backupPath = this.filePath + '.bak';
    try {
      // Create backup of current state before overwriting
      if (existsSync(this.filePath)) {
        try { copyFileSync(this.filePath, backupPath); } catch { /* non-critical */ }
      }
      writeFileSync(tmpPath, JSON.stringify(this.state, null, 2));
      renameSync(tmpPath, this.filePath);
    } catch (err) {
      // Clean up temp file on failure (e.g. disk full)
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
      console.error(`[state] Failed to save state: ${err instanceof Error ? err.message : err}`);
    }
  }

  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (this.dirty) {
      this.save();
      this.dirty = false;
    }
  }
}
