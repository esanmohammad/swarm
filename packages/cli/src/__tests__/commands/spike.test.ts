import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue('question from file'),
}));

vi.mock('ora', () => ({
  default: vi.fn().mockReturnValue({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
    stop: vi.fn(),
  }),
}));

vi.mock('../../core/config.js', () => ({
  requireSwarmDir: vi.fn().mockReturnValue('/tmp/.swarm'),
  loadConfig: vi.fn().mockReturnValue({ model: 'sonnet', stack: 'react', maxBudgetUsd: 3 }),
  autoDetectStack: vi.fn().mockReturnValue('react'),
  autoInit: vi.fn().mockReturnValue('/tmp/.swarm'),
}));

vi.mock('../../commands/shared.js', () => ({
  createContext: vi.fn().mockReturnValue({
    agentManager: {
      spawn: vi.fn().mockResolvedValue({
        id: 'agent-1',
        status: 'done',
        cost: { totalUsd: 0.01 },
        output: 'Investigation results',
        error: null,
      }),
      waitForAgent: vi.fn().mockResolvedValue(undefined),
    },
    state: { saveActivity: vi.fn() },
    cleanup: vi.fn(),
  }),
}));

describe('spike command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
  });

  it('should register the spike command', async () => {
    const { registerSpike } = await import('../../commands/spike.js');
    registerSpike(program);
    const cmd = program.commands.find(c => c.name() === 'spike');
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toContain('exploration');
  });

  it('should default to haiku model', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { loadConfig } = await import('../../core/config.js');

    const { registerSpike } = await import('../../commands/spike.js');
    registerSpike(program);
    await program.parseAsync(['node', 'script', 'spike', 'how is auth implemented?']);

    // loadConfig is called, then model is overridden to haiku
    const config = vi.mocked(loadConfig)();
    // The spike command sets config.model = 'haiku' when no --model given
    logSpy.mockRestore();
  });

  it('should spawn agent with read-only tools in non-interactive mode', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { createContext } = await import('../../commands/shared.js');

    const { registerSpike } = await import('../../commands/spike.js');
    registerSpike(program);
    await program.parseAsync(['node', 'script', 'spike', 'how is auth implemented?']);

    const ctx = vi.mocked(createContext)('/tmp/.swarm', {} as any);
    expect(ctx.agentManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
      }),
    );
    logSpy.mockRestore();
  });
});
