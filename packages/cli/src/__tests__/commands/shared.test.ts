import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock classes that are used as constructors — use class-based mocks
const mockFlush = vi.fn();
const mockKillOrphanProcesses = vi.fn();
const mockKillAll = vi.fn();
const mockWsStop = vi.fn();
const mockAgentOn = vi.fn();

vi.mock('../../core/state.js', () => ({
  StateManager: class {
    init = vi.fn();
    getState = vi.fn().mockReturnValue({ agents: [] });
    flush = mockFlush;
    killOrphanProcesses = mockKillOrphanProcesses;
  },
}));

vi.mock('../../core/cost-tracker.js', () => ({
  CostTracker: class {
    setBudget = vi.fn();
  },
}));

vi.mock('../../prompts/loader.js', () => ({
  PromptLoader: class {},
}));

vi.mock('../../core/agent-manager.js', () => ({
  AgentManager: class {
    on = mockAgentOn;
    killAll = mockKillAll;
  },
}));

vi.mock('../../core/pipeline.js', () => ({
  Pipeline: class {},
}));

vi.mock('../../core/ws-server.js', () => ({
  SwarmWsServer: class {
    stop = mockWsStop;
  },
}));

vi.mock('../../core/audit.js', () => ({
  AuditLog: class {
    agentSpawned = vi.fn();
    agentDone = vi.fn();
    agentError = vi.fn();
  },
}));

vi.mock('../../core/preflight.js', () => ({
  requireClaudeCli: vi.fn(),
}));

describe('shared.ts — createContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export createContext function', async () => {
    const { createContext } = await import('../../commands/shared.js');
    expect(typeof createContext).toBe('function');
  });

  it('should return a SwarmContext with all required fields', async () => {
    const { createContext } = await import('../../commands/shared.js');
    const config = {
      projectName: 'test',
      stack: 'react' as const,
      model: 'sonnet',
      maxBudgetUsd: 5,
      wsPort: 3000,
      dashboardPort: 3001,
      promptsDir: undefined,
    };
    const ctx = createContext('/tmp/.swarm', config as any);
    expect(ctx).toHaveProperty('state');
    expect(ctx).toHaveProperty('costTracker');
    expect(ctx).toHaveProperty('promptLoader');
    expect(ctx).toHaveProperty('agentManager');
    expect(ctx).toHaveProperty('pipeline');
    expect(ctx).toHaveProperty('wsServer');
    expect(ctx).toHaveProperty('cleanup');
    expect(typeof ctx.cleanup).toBe('function');
  });

  it('should call requireClaudeCli on context creation', async () => {
    const { requireClaudeCli } = await import('../../core/preflight.js');
    const { createContext } = await import('../../commands/shared.js');
    const config = {
      projectName: 'test',
      stack: 'react' as const,
      model: 'sonnet',
      maxBudgetUsd: 5,
      wsPort: 3000,
      dashboardPort: 3001,
      promptsDir: undefined,
    };
    createContext('/tmp/.swarm', config as any);
    expect(requireClaudeCli).toHaveBeenCalled();
  });

  it('cleanup should call killAll, stop, and flush', async () => {
    const { createContext } = await import('../../commands/shared.js');
    const config = {
      projectName: 'test',
      stack: 'react' as const,
      model: 'sonnet',
      maxBudgetUsd: 5,
      wsPort: 3000,
      dashboardPort: 3001,
      promptsDir: undefined,
    };
    const ctx = createContext('/tmp/.swarm', config as any);
    ctx.cleanup();
    expect(mockKillAll).toHaveBeenCalled();
    expect(mockWsStop).toHaveBeenCalled();
    expect(mockFlush).toHaveBeenCalled();
  });
});
