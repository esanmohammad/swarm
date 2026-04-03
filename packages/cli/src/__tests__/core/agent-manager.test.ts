import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentManager } from '../../core/agent-manager.js';
import { StateManager } from '../../core/state.js';
import { CostTracker } from '../../core/cost-tracker.js';
import { PromptLoader } from '../../prompts/loader.js';
import { createTempSwarmDir } from '../helpers/temp-dir.js';
import type { SwarmConfig } from '../../types.js';

// Mock AgentProcess so we don't spawn real subprocesses
vi.mock('../../core/agent-process.js', async () => {
  const { EventEmitter } = await import('node:events');
  class MockAgentProcess extends EventEmitter {
    private _pid = Math.floor(Math.random() * 10000);
    private _killed = false;
    private _timedOut = false;
    constructor(public config: Record<string, unknown>) {
      super();
    }
    start() {}
    kill() { this._killed = true; }
    get pid() { return this._pid; }
    get killed() { return this._killed; }
    get timedOut() { return this._timedOut; }
  }
  return { AgentProcess: MockAgentProcess };
});

function makeConfig(): SwarmConfig {
  return {
    projectName: 'test',
    stack: 'node',
    model: 'opus',
    maxBudgetUsd: null,
    permissions: { permissionMode: 'auto' },
  } as SwarmConfig;
}

describe('AgentManager', () => {
  let swarmDir: string;
  let cleanup: () => void;
  let state: StateManager;
  let costTracker: CostTracker;
  let promptLoader: PromptLoader;
  let manager: AgentManager;

  beforeEach(() => {
    const tmp = createTempSwarmDir();
    swarmDir = tmp.swarmDir;
    cleanup = tmp.cleanup;

    state = new StateManager(swarmDir);
    state.init('test-project', 'node');
    costTracker = new CostTracker();
    promptLoader = new PromptLoader();
    manager = new AgentManager(state, costTracker, promptLoader, makeConfig());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('should spawn agent and track in map', async () => {
    const agent = await manager.spawn({
      name: 'test-agent',
      persona: 'engineer',
      stack: 'node',
      prompt: 'Do something',
      cwd: '/tmp/test',
    });

    expect(agent.id).toBeDefined();
    expect(agent.name).toBe('test-agent');
    expect(agent.status).toBe('running');
    expect(manager.get(agent.id)).toBeDefined();
  });

  it('should kill agent by ID', async () => {
    const agent = await manager.spawn({
      name: 'kill-test',
      persona: 'engineer',
      stack: 'node',
      prompt: 'Do something',
      cwd: '/tmp/test',
    });

    const result = manager.kill(agent.id);
    expect(result).toBe(true);
    expect(agent.status).toBe('killed');
  });

  it('should return false when killing non-existent agent', () => {
    const result = manager.kill('non-existent-id');
    expect(result).toBe(false);
  });

  it('should list running agents', async () => {
    await manager.spawn({
      name: 'agent-1',
      persona: 'engineer',
      stack: 'node',
      prompt: 'Task 1',
      cwd: '/tmp/test',
    });
    await manager.spawn({
      name: 'agent-2',
      persona: 'analyst',
      stack: 'node',
      prompt: 'Task 2',
      cwd: '/tmp/test',
    });

    const running = manager.getRunningAgents();
    expect(running).toHaveLength(2);
  });

  it('should list all agents', async () => {
    const agent1 = await manager.spawn({
      name: 'agent-1',
      persona: 'engineer',
      stack: 'node',
      prompt: 'Task 1',
      cwd: '/tmp/test',
    });
    await manager.spawn({
      name: 'agent-2',
      persona: 'analyst',
      stack: 'node',
      prompt: 'Task 2',
      cwd: '/tmp/test',
    });

    manager.kill(agent1.id);

    const all = manager.list();
    expect(all).toHaveLength(2);
  });

  it('should find agent by name', async () => {
    await manager.spawn({
      name: 'named-agent',
      persona: 'engineer',
      stack: 'node',
      prompt: 'Task',
      cwd: '/tmp/test',
    });

    const found = manager.getByName('named-agent');
    expect(found).toBeDefined();
    expect(found!.name).toBe('named-agent');
  });

  it('should emit agent-spawned event', async () => {
    let spawned = false;
    manager.on('agent-spawned', () => { spawned = true; });

    await manager.spawn({
      name: 'event-test',
      persona: 'engineer',
      stack: 'node',
      prompt: 'Task',
      cwd: '/tmp/test',
    });

    expect(spawned).toBe(true);
  });

  it('should killAll agents', async () => {
    const a1 = await manager.spawn({
      name: 'a1',
      persona: 'engineer',
      stack: 'node',
      prompt: 'Task',
      cwd: '/tmp/test',
    });
    const a2 = await manager.spawn({
      name: 'a2',
      persona: 'analyst',
      stack: 'node',
      prompt: 'Task',
      cwd: '/tmp/test',
    });

    manager.killAll();
    expect(a1.status).toBe('killed');
    expect(a2.status).toBe('killed');
  });
});
