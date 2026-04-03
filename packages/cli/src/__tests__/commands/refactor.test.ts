import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue('refactor description from file'),
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
  loadConfig: vi.fn().mockReturnValue({ model: 'sonnet', stack: 'react', maxBudgetUsd: 5 }),
  autoDetectStack: vi.fn().mockReturnValue('react'),
  autoInit: vi.fn().mockReturnValue('/tmp/.swarm'),
}));

vi.mock('../../commands/shared.js', () => ({
  createContext: vi.fn().mockReturnValue({
    agentManager: {
      spawn: vi.fn().mockResolvedValue({
        id: 'agent-1',
        status: 'done',
        cost: { totalUsd: 0.05 },
        output: 'Analysis results here',
        error: null,
      }),
      waitForAgent: vi.fn().mockResolvedValue(undefined),
    },
    state: { saveActivity: vi.fn() },
    cleanup: vi.fn(),
  }),
}));

describe('refactor command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
  });

  it('should register the refactor command', async () => {
    const { registerRefactor } = await import('../../commands/refactor.js');
    registerRefactor(program);
    const cmd = program.commands.find(c => c.name() === 'refactor');
    expect(cmd).toBeDefined();
  });

  it('should spawn two agents: analyzer then engineer', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { createContext } = await import('../../commands/shared.js');

    const { registerRefactor } = await import('../../commands/refactor.js');
    registerRefactor(program);
    await program.parseAsync(['node', 'script', 'refactor', 'extract helper functions']);

    const ctx = vi.mocked(createContext)('/tmp/.swarm', {} as any);
    // spawn should have been called twice (analyst + engineer)
    expect(ctx.agentManager.spawn).toHaveBeenCalledTimes(2);
    logSpy.mockRestore();
  });

  it('should read from file when --file is used', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerRefactor } = await import('../../commands/refactor.js');
    registerRefactor(program);
    await program.parseAsync(['node', 'script', 'refactor', 'desc.txt', '-f']);

    const fs = await import('node:fs');
    expect(fs.readFileSync).toHaveBeenCalledWith('desc.txt', 'utf-8');
    logSpy.mockRestore();
  });

  it('should support --scope option', async () => {
    const { registerRefactor } = await import('../../commands/refactor.js');
    registerRefactor(program);
    const cmd = program.commands.find(c => c.name() === 'refactor');
    const opts = cmd!.options.map(o => o.long);
    expect(opts).toContain('--scope');
  });

  it('should handle analysis failure gracefully', async () => {
    const { createContext } = await import('../../commands/shared.js');
    vi.mocked(createContext).mockReturnValue({
      agentManager: {
        spawn: vi.fn().mockResolvedValue({
          id: 'agent-1',
          status: 'error',
          cost: { totalUsd: 0.01 },
          output: '',
          error: 'Analysis failed',
        }),
        waitForAgent: vi.fn().mockResolvedValue(undefined),
      },
      cleanup: vi.fn(),
    } as any);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as any);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { registerRefactor } = await import('../../commands/refactor.js');
    registerRefactor(program);

    try {
      await program.parseAsync(['node', 'script', 'refactor', 'extract helpers']);
    } catch {}

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    logSpy.mockRestore();
  });
});
