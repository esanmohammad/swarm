import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
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

  /**
   * Get the working directory for the current pipeline.
   * Non-default pipelines use a git worktree for isolation.
   * Falls back to the project root if no worktree is set.
   */
  getProjectCwd(): string {
    // If the pipeline has a worktree, use it
    if (this.state.worktreePath && existsSync(this.state.worktreePath)) {
      return this.state.worktreePath;
    }
    // Default pipeline or no worktree → use project root (parent of .swarm/)
    return join(this.swarmDir, '..');
  }

  /**
   * Create a git worktree for a non-default pipeline.
   * Worktrees are stored in .swarm/worktrees/{namespace}/.
   * Each gets its own branch: pipeline/{namespace}.
   */
  ensureWorktree(namespace: string): string | null {
    if (namespace === 'default') return null;

    const worktreesDir = join(this.swarmDir, 'worktrees');
    const worktreePath = join(worktreesDir, namespace);

    // Already exists and is valid
    if (this.state.worktreePath && existsSync(this.state.worktreePath)) {
      return this.state.worktreePath;
    }

    // Already exists on disk (e.g. from a previous run)
    if (existsSync(worktreePath)) {
      this.state.worktreePath = worktreePath;
      this.scheduleSave();
      return worktreePath;
    }

    // Create worktree
    try {
      if (!existsSync(worktreesDir)) {
        mkdirSync(worktreesDir, { recursive: true });
      }

      const projectRoot = join(this.swarmDir, '..');
      const branchName = `pipeline/${namespace}`;

      // Try creating with new branch
      try {
        execSync(`git worktree add "${worktreePath}" -b "${branchName}"`, {
          stdio: 'pipe',
          cwd: projectRoot,
        });
      } catch {
        // Branch might already exist — try without -b
        try {
          execSync(`git worktree add "${worktreePath}" "${branchName}"`, {
            stdio: 'pipe',
            cwd: projectRoot,
          });
        } catch {
          // If that also fails, create from HEAD
          execSync(`git worktree add "${worktreePath}"`, {
            stdio: 'pipe',
            cwd: projectRoot,
          });
        }
      }

      console.log(`[state] Created worktree for pipeline "${namespace}" at ${worktreePath}`);
      this.state.worktreePath = worktreePath;
      this.scheduleSave();
      return worktreePath;
    } catch (err) {
      console.error(`[state] Could not create worktree for "${namespace}": ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /**
   * Remove a git worktree for a pipeline.
   */
  removeWorktree(namespace: string): void {
    if (namespace === 'default') return;

    const worktreePath = this.state.worktreePath;
    if (!worktreePath) return;

    try {
      const projectRoot = join(this.swarmDir, '..');
      execSync(`git worktree remove "${worktreePath}" --force`, {
        stdio: 'pipe',
        cwd: projectRoot,
      });
      console.log(`[state] Removed worktree for pipeline "${namespace}"`);
    } catch {
      // Fallback: remove directory manually
      try {
        rmSync(worktreePath, { recursive: true, force: true });
        // Prune stale worktree entries
        const projectRoot = join(this.swarmDir, '..');
        execSync('git worktree prune', { stdio: 'pipe', cwd: projectRoot });
      } catch {
        console.error(`[state] Could not remove worktree at ${worktreePath}`);
      }
    }

    this.state.worktreePath = undefined;
    this.scheduleSave();
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
   * Clean up stale agents while preserving completed stage state.
   * - Running/pending agents → mark as error (orphaned)
   * - Remove error/killed agents (keep done agents for session history)
   * - Done stages → preserve (keep sessionId, artifact, contextSummary)
   * - Running stages → set to error (interrupted, but keep sessionId for resume)
   * - Pending/skipped stages → keep as-is
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

    // Remove only error/killed agents — keep done agents for session history
    this.state.agents = this.state.agents.filter(a => a.status === 'done');

    // Preserve completed stages, mark running stages as error
    for (const [, stage] of Object.entries(this.state.stages)) {
      if (stage.status === 'running') {
        // Interrupted — mark as error but keep sessionId for potential resume
        stage.status = 'error';
      }
      // done, pending, skipped, error — keep as-is
    }

    this.recalcTotalCost();
    this.state.updatedAt = Date.now();
    this.save();
  }

  /**
   * Get resume context for feeding into fresh-start prompts.
   * Returns context summaries from all completed prior stages.
   */
  getResumeContext(upToStage: StageName): string {
    const stageOrder: StageName[] = ['analyze', 'architect', 'plan', 'build', 'test', 'evaluate'];
    const targetIdx = stageOrder.indexOf(upToStage);
    const summaries: string[] = [];

    for (let i = 0; i < targetIdx; i++) {
      const stage = this.state.stages[stageOrder[i]];
      if (stage.status === 'done' && stage.contextSummary) {
        summaries.push(`[${stageOrder[i]}] ${stage.contextSummary}`);
      }
    }

    return summaries.length > 0
      ? `Context from prior stages:\n${summaries.join('\n')}\n`
      : '';
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
    // Ensure pipelines subdirectory exists for non-default namespaces
    if (this.namespace !== 'default') {
      const pipelinesDir = join(this.swarmDir, 'pipelines');
      if (!existsSync(pipelinesDir)) {
        mkdirSync(pipelinesDir, { recursive: true });
      }
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
