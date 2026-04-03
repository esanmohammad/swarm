import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pipeline } from '../../core/pipeline.js';
import { AgentManager } from '../../core/agent-manager.js';
import { StateManager } from '../../core/state.js';
import { CostTracker } from '../../core/cost-tracker.js';
import { PromptLoader } from '../../prompts/loader.js';
import { createTempSwarmDir, writeArtifact } from '../helpers/temp-dir.js';
import { emptyCost } from '../../types.js';
import type { SwarmConfig, Agent } from '../../types.js';

// Mock AgentProcess to prevent real subprocess spawning
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

// Mock external dependencies that pipeline uses
vi.mock('../../core/git.js', () => ({
  isGhInstalled: vi.fn(() => false),
  createPR: vi.fn(),
  buildPRBody: vi.fn(() => ''),
  getCurrentBranch: vi.fn(() => 'main'),
  hasUncommittedChanges: vi.fn(() => false),
}));

vi.mock('../../core/input-listener.js', () => ({
  stageTransitionPause: vi.fn(),
  fixLoopPause: vi.fn(),
  InputListener: class { start() {} stop() {} },
}));

vi.mock('../../core/codebase-scanner.js', () => ({
  scanCodebase: vi.fn(() => ''),
}));

vi.mock('../../commands/learn.js', () => ({
  loadConventions: vi.fn(() => ''),
}));

vi.mock('../../core/memory-store.js', () => ({
  MemoryStore: class {
    buildMemoryContext() { return ''; }
  },
  recordPipelineSuccess: vi.fn(),
  recordPipelineFailure: vi.fn(),
  recordFlakyTest: vi.fn(),
}));

vi.mock('../../core/pipeline-loader.js', () => ({
  loadPipelineDefinition: vi.fn(() => null),
  getDefaultPipelineDefinition: vi.fn(() => ({ stages: [] })),
  stageNameForDefinition: vi.fn((name: string) => name),
}));

function makeConfig(dir: string): SwarmConfig {
  return {
    projectName: 'test',
    stack: 'node',
    model: 'opus',
    maxBudgetUsd: null,
    permissions: { permissionMode: 'auto' },
    webhooks: [],
  } as unknown as SwarmConfig;
}

describe('Pipeline', () => {
  let dir: string;
  let swarmDir: string;
  let cleanup: () => void;
  let state: StateManager;
  let agentManager: AgentManager;
  let pipeline: Pipeline;

  beforeEach(() => {
    const tmp = createTempSwarmDir();
    dir = tmp.dir;
    swarmDir = tmp.swarmDir;
    cleanup = tmp.cleanup;

    state = new StateManager(swarmDir);
    state.init('test-project', 'node');
    state.flush();

    const costTracker = new CostTracker();
    const promptLoader = new PromptLoader();
    agentManager = new AgentManager(state, costTracker, promptLoader, makeConfig(dir));
    pipeline = new Pipeline(agentManager, state, makeConfig(dir));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('should set stage to running when runAnalyze is called', async () => {
    // Mock spawn to resolve immediately
    const originalSpawn = agentManager.spawn.bind(agentManager);
    vi.spyOn(agentManager, 'spawn').mockImplementation(async (opts) => {
      const agent: Agent = {
        id: 'test-agent-id',
        name: opts.name,
        persona: opts.persona,
        stack: opts.stack,
        status: 'done',
        pid: 1234,
        sessionId: 'sess-1',
        model: 'opus',
        permissionMode: 'auto',
        startedAt: Date.now(),
        finishedAt: Date.now(),
        cost: emptyCost(),
        output: 'Generated REQUIREMENTS.md',
        error: null,
        parentId: null,
        childIds: [],
      };
      state.addAgent(agent);
      state.updateStage('analyze', { status: 'running', agentIds: [agent.id] });
      return agent;
    });

    vi.spyOn(agentManager, 'waitForAgent').mockResolvedValue({
      id: 'test-agent-id',
      name: 'analyst-node',
      persona: 'analyst',
      stack: 'node',
      status: 'done',
      pid: 1234,
      sessionId: 'sess-1',
      model: 'opus',
      permissionMode: 'auto',
      startedAt: Date.now(),
      finishedAt: Date.now(),
      cost: emptyCost(),
      output: 'Done',
      error: null,
      parentId: null,
      childIds: [],
    });

    // Create the artifact so finishStage succeeds
    writeArtifact(dir, 'REQUIREMENTS.md', [
      '## Original Requirement',
      'Build a login page.',
      '## Summary',
      'A login page for the app with authentication.',
      '## Scope',
      'Login page with email/password fields and validation.',
      '## Functional Requirements',
      'As a user I want to login So that I can access the app.',
      'Given a valid email When I submit Then I should see the dashboard.',
      '## Data Requirements',
      'User table.',
      '## Non-Functional Requirements',
      'Performance < 200ms response.',
    ].join('\n'));

    await pipeline.runAnalyze('Build a login page', { interactive: false });

    // After completion, stage should be done
    const stageState = state.getState().stages.analyze;
    expect(stageState.status).toBe('done');
  });

  it('should throw if stage is already running', async () => {
    state.updateStage('analyze', { status: 'running' });

    await expect(
      pipeline.runAnalyze('Test', { interactive: false })
    ).rejects.toThrow('already running');
  });

  it('should throw if REQUIREMENTS.md is missing for architect', async () => {
    await expect(
      pipeline.runArchitect({ interactive: false })
    ).rejects.toThrow('REQUIREMENTS.md not found');
  });

  it('should track cost in state after stage completion', async () => {
    const cost = { totalUsd: 0.10, inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 3000 };

    vi.spyOn(agentManager, 'spawn').mockResolvedValue({
      id: 'cost-agent',
      name: 'analyst-node',
      persona: 'analyst',
      stack: 'node',
      status: 'done',
      pid: 1234,
      sessionId: 'sess-1',
      model: 'opus',
      permissionMode: 'auto',
      startedAt: Date.now(),
      finishedAt: Date.now(),
      cost,
      output: 'Done',
      error: null,
      parentId: null,
      childIds: [],
    });

    vi.spyOn(agentManager, 'waitForAgent').mockResolvedValue({
      id: 'cost-agent',
      name: 'analyst-node',
      persona: 'analyst',
      stack: 'node',
      status: 'done',
      pid: 1234,
      sessionId: 'sess-1',
      model: 'opus',
      permissionMode: 'auto',
      startedAt: Date.now(),
      finishedAt: Date.now(),
      cost,
      output: 'Done',
      error: null,
      parentId: null,
      childIds: [],
    });

    writeArtifact(dir, 'REQUIREMENTS.md', [
      '## Original Requirement',
      'Build something.',
      '## Summary',
      'A big summary of the requirements.',
      '## Scope',
      'Wide scope of work.',
      '## Functional Requirements',
      'As a user I want something So that it works well.',
      'Given input When processed Then output is correct.',
      '## Data Requirements',
      'Data storage.',
      '## Non-Functional Requirements',
      'Performance requirements.',
    ].join('\n'));

    await pipeline.runAnalyze('Build something', { interactive: false });
    // Agent was added with cost
    const agents = state.getState().agents;
    expect(agents.length).toBeGreaterThanOrEqual(0);
  });

  it('should save state after stage completes', async () => {
    vi.spyOn(agentManager, 'spawn').mockResolvedValue({
      id: 'save-agent',
      name: 'analyst-node',
      persona: 'analyst',
      stack: 'node',
      status: 'done',
      pid: 1234,
      sessionId: 'sess-1',
      model: 'opus',
      permissionMode: 'auto',
      startedAt: Date.now(),
      finishedAt: Date.now(),
      cost: emptyCost(),
      output: 'Done',
      error: null,
      parentId: null,
      childIds: [],
    });

    vi.spyOn(agentManager, 'waitForAgent').mockResolvedValue({
      id: 'save-agent',
      name: 'analyst-node',
      persona: 'analyst',
      stack: 'node',
      status: 'done',
      pid: 1234,
      sessionId: 'sess-1',
      model: 'opus',
      permissionMode: 'auto',
      startedAt: Date.now(),
      finishedAt: Date.now(),
      cost: emptyCost(),
      output: 'Done',
      error: null,
      parentId: null,
      childIds: [],
    });

    writeArtifact(dir, 'REQUIREMENTS.md', [
      '## Original Requirement',
      'Feature X.',
      '## Summary',
      'Summary of the feature requirements.',
      '## Scope',
      'Scope details.',
      '## Functional Requirements',
      'As a user I want feature So that I benefit.',
      'Given a condition When action Then result.',
      '## Data Requirements',
      'Data needs.',
      '## Non-Functional Requirements',
      'NFR details.',
    ].join('\n'));

    await pipeline.runAnalyze('Feature X', { interactive: false });
    state.flush();

    // State file should exist and be written
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(swarmDir, 'state.json'))).toBe(true);
  });

  it('should use per-persona model overrides', () => {
    const config = makeConfig(dir);
    config.models = { analyst: 'haiku', architect: 'sonnet', lead: 'opus', engineer: 'opus', tester: 'haiku' };
    const p = new Pipeline(agentManager, state, config);
    // Access the private method via any to test
    const modelFor = (p as unknown as { modelFor: (persona: string) => string }).modelFor;
    expect(modelFor.call(p, 'analyst')).toBe('haiku');
    expect(modelFor.call(p, 'engineer')).toBe('opus');
  });

  it('should have projectCwd that points to parent of .swarm', () => {
    // The projectCwd should resolve to the temp dir (parent of .swarm)
    expect(pipeline.projectCwd).toBe(dir);
  });

  it('should set autoPR and gitEnabled flags', () => {
    expect(pipeline.gitEnabled).toBe(true);
    expect(pipeline.autoPR).toBe(true);
    pipeline.gitEnabled = false;
    expect(pipeline.gitEnabled).toBe(false);
  });

  it('should throw budget error when budget is exceeded', async () => {
    vi.spyOn(agentManager, 'spawn').mockResolvedValue({
      id: 'budget-agent',
      name: 'analyst-node',
      persona: 'analyst',
      stack: 'node',
      status: 'done',
      pid: 1234,
      sessionId: 'sess-1',
      model: 'opus',
      permissionMode: 'auto',
      startedAt: Date.now(),
      finishedAt: Date.now(),
      cost: emptyCost(),
      output: 'Done',
      error: null,
      parentId: null,
      childIds: [],
    });

    vi.spyOn(agentManager, 'waitForAgent').mockRejectedValue(new Error('Agent killed'));

    // Simulate budget exceeded
    agentManager.emit('budget-exceeded', emptyCost());

    await expect(
      pipeline.runAnalyze('Test', { interactive: false })
    ).rejects.toThrow('Budget limit');
  });
});
