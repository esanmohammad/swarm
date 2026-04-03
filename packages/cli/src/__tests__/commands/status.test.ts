import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockState = {
  projectName: 'test-project',
  stack: 'react',
  stages: {
    analyze: { status: 'done', agentIds: ['a1'], artifact: 'REQUIREMENTS.md' },
    architect: { status: 'pending', agentIds: [], artifact: null },
    plan: { status: 'pending', agentIds: [], artifact: null },
    build: { status: 'pending', agentIds: [], artifact: null },
    test: { status: 'pending', agentIds: [], artifact: null },
    evaluate: { status: 'pending', agentIds: [], artifact: null },
  },
  agents: [],
  totalCost: { totalUsd: 0.05, inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 1000 },
  violations: [],
  updatedAt: Date.now(),
};

vi.mock('../../core/config.js', () => ({
  requireSwarmDir: vi.fn().mockReturnValue('/tmp/.swarm'),
}));

vi.mock('../../core/state.js', () => ({
  StateManager: class {
    getState = vi.fn().mockReturnValue(mockState);
  },
}));

describe('status command', () => {
  let program: Command;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should register the status command', async () => {
    const { registerStatus } = await import('../../commands/status.js');
    registerStatus(program);
    const cmd = program.commands.find(c => c.name() === 'status');
    expect(cmd).toBeDefined();
  });

  it('should display project name and stack', async () => {
    const { registerStatus } = await import('../../commands/status.js');
    registerStatus(program);
    await program.parseAsync(['node', 'script', 'status']);
    const calls = logSpy.mock.calls.flat().join(' ');
    expect(calls).toContain('test-project');
    logSpy.mockRestore();
  });

  it('should display pipeline stages', async () => {
    const { registerStatus } = await import('../../commands/status.js');
    registerStatus(program);
    await program.parseAsync(['node', 'script', 'status']);
    const calls = logSpy.mock.calls.flat().join(' ');
    expect(calls).toContain('Pipeline');
    expect(calls).toContain('Analyze');
    logSpy.mockRestore();
  });
});
