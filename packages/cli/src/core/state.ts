import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { PipelineState, Agent, StageName, StageState, CostInfo } from '../types.js';
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

  init(projectName: string, stack: import('../types.js').TechStack): void {
    this.state = createEmptyPipeline(projectName, stack);
    this.save();
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

    // Reset stage agentIds since those agents no longer exist
    for (const stage of Object.values(this.state.stages)) {
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
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
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
