import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { PipelineState, Agent, StageName, StageState, MaydayState } from '../types.js';
import { createEmptyPipeline, emptyCost, addCosts } from '../types.js';

export class StateManager extends EventEmitter {
  private state: PipelineState;
  private filePath: string;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(private swarmDir: string) {
    super();
    this.filePath = join(swarmDir, 'state.json');

    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, 'utf-8');
        this.state = JSON.parse(raw);
        // Migrate: ensure all expected stages exist (e.g. 'test' added later)
        const emptyStage = (): StageState => ({ status: 'pending', agentIds: [], artifact: null });
        const expectedStages: StageName[] = ['analyze', 'architect', 'plan', 'build', 'test', 'evaluate'];
        for (const stage of expectedStages) {
          if (!this.state.stages[stage]) {
            this.state.stages[stage] = emptyStage();
          }
        }
      } catch {
        this.state = createEmptyPipeline('unknown', 'react');
      }
    } else {
      this.state = createEmptyPipeline('unknown', 'react');
    }
  }

  getState(): PipelineState {
    return this.state;
  }

  getFilePath(): string {
    return this.filePath;
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

  private recalcTotalCost(): void {
    this.state.totalCost = this.state.agents.reduce(
      (acc, a) => addCosts(acc, a.cost),
      emptyCost(),
    );
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
    try {
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
