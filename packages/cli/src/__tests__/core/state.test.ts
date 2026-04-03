import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StateManager } from '../../core/state.js';
import { createEmptyPipeline, emptyCost } from '../../types.js';
import { createTempSwarmDir } from '../helpers/temp-dir.js';

describe('StateManager', () => {
  let dir: string;
  let swarmDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempSwarmDir();
    dir = tmp.dir;
    swarmDir = tmp.swarmDir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('should create a new state file on init', () => {
    const sm = new StateManager(swarmDir);
    sm.init('test-project', 'node');
    sm.flush();
    expect(existsSync(join(swarmDir, 'state.json'))).toBe(true);
    const raw = readFileSync(join(swarmDir, 'state.json'), 'utf-8');
    const state = JSON.parse(raw);
    expect(state.projectName).toBe('test-project');
    expect(state.stack).toBe('node');
  });

  it('should read existing state from disk', () => {
    const existing = createEmptyPipeline('existing-proj', 'react');
    writeFileSync(join(swarmDir, 'state.json'), JSON.stringify(existing));

    const sm = new StateManager(swarmDir);
    const state = sm.getState();
    expect(state.projectName).toBe('existing-proj');
    expect(state.stack).toBe('react');
  });

  it('should update stage without losing other fields', () => {
    const sm = new StateManager(swarmDir);
    sm.init('test-project', 'node');
    sm.updateStage('analyze', { status: 'running', startedAt: 12345 });
    sm.flush();

    const state = sm.getState();
    expect(state.stages.analyze.status).toBe('running');
    expect(state.stages.analyze.startedAt).toBe(12345);
    // Other stages should remain pending
    expect(state.stages.architect.status).toBe('pending');
    expect(state.stages.build.status).toBe('pending');
  });

  it('should create backup before write (state.json.bak)', () => {
    const sm = new StateManager(swarmDir);
    sm.init('test-project', 'node');
    sm.flush();
    // First save creates state.json but no .bak yet (nothing to back up before first write)
    // Second save should create .bak
    sm.updateStage('analyze', { status: 'done' });
    sm.flush();
    expect(existsSync(join(swarmDir, 'state.json.bak'))).toBe(true);
  });

  it('should recover from corrupted state using backup', () => {
    // Write a valid backup
    const validState = createEmptyPipeline('backup-proj', 'go');
    writeFileSync(join(swarmDir, 'state.json.bak'), JSON.stringify(validState));
    // Write corrupted primary
    writeFileSync(join(swarmDir, 'state.json'), '{invalid json!!!');

    const sm = new StateManager(swarmDir);
    const state = sm.getState();
    expect(state.projectName).toBe('backup-proj');
    expect(state.stack).toBe('go');
  });

  it('should emit state-change event on updateStage', () => {
    const sm = new StateManager(swarmDir);
    sm.init('test-project', 'node');

    let emitted = false;
    sm.on('state-change', () => { emitted = true; });
    sm.updateStage('analyze', { status: 'running' });
    expect(emitted).toBe(true);
  });

  it('should initialize with default pipeline stages', () => {
    const sm = new StateManager(swarmDir);
    const state = sm.getState();
    const expectedStages = ['analyze', 'architect', 'plan', 'build', 'test', 'evaluate'];
    for (const stage of expectedStages) {
      expect(state.stages[stage as keyof typeof state.stages]).toBeDefined();
      expect(state.stages[stage as keyof typeof state.stages].status).toBe('pending');
    }
  });

  it('should persist agent list', () => {
    const sm = new StateManager(swarmDir);
    sm.init('test-project', 'node');
    const agent = {
      id: 'agent-1',
      name: 'test-agent',
      persona: 'engineer' as const,
      stack: 'node' as const,
      status: 'running' as const,
      pid: 1234,
      sessionId: 'sess-1',
      model: 'opus',
      permissionMode: 'auto' as const,
      startedAt: Date.now(),
      finishedAt: null,
      cost: emptyCost(),
      output: '',
      error: null,
      parentId: null,
      childIds: [],
    };
    sm.addAgent(agent);
    sm.flush();

    const raw = readFileSync(join(swarmDir, 'state.json'), 'utf-8');
    const state = JSON.parse(raw);
    expect(state.agents).toHaveLength(1);
    expect(state.agents[0].id).toBe('agent-1');
  });

  it('should handle missing .swarm directory gracefully on load', () => {
    // StateManager with a non-existent swarmDir should create a default state
    const sm = new StateManager(join(dir, 'nonexistent-swarm'));
    const state = sm.getState();
    expect(state.projectName).toBe('unknown');
  });

  it('should return current state from getState', () => {
    const sm = new StateManager(swarmDir);
    sm.init('my-project', 'python');
    const state = sm.getState();
    expect(state.projectName).toBe('my-project');
    expect(state.stack).toBe('python');
    expect(state.agents).toEqual([]);
    expect(state.totalCost.totalUsd).toBe(0);
  });
});
