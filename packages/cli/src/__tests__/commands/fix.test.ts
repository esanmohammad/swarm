import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue(''),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue('bug description from file'),
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

vi.mock('../../core/git.js', () => ({
  isGhInstalled: vi.fn().mockReturnValue(true),
}));

const mockAgent = {
  id: 'agent-1',
  status: 'done',
  cost: { totalUsd: 0.05 },
  output: 'Fixed the bug',
  error: null,
};

const mockAgentManager = {
  spawn: vi.fn().mockResolvedValue(mockAgent),
  waitForAgent: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../commands/shared.js', () => ({
  createContext: vi.fn().mockReturnValue({
    agentManager: {
      spawn: vi.fn().mockResolvedValue({
        id: 'agent-1',
        status: 'done',
        cost: { totalUsd: 0.05 },
        output: 'Fixed the bug',
        error: null,
      }),
      waitForAgent: vi.fn().mockResolvedValue(undefined),
    },
    cleanup: vi.fn(),
  }),
}));

describe('fix command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
  });

  it('should register the fix command', async () => {
    const { registerFix } = await import('../../commands/fix.js');
    registerFix(program);
    const cmd = program.commands.find(c => c.name() === 'fix');
    expect(cmd).toBeDefined();
  });

  it('should require a description or --issue flag', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as any);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { registerFix } = await import('../../commands/fix.js');
    registerFix(program);

    try {
      await program.parseAsync(['node', 'script', 'fix']);
    } catch {}

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Bug description required'));
    exitSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('should spawn an engineer agent with bug description', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { createContext } = await import('../../commands/shared.js');

    const { registerFix } = await import('../../commands/fix.js');
    registerFix(program);
    await program.parseAsync(['node', 'script', 'fix', 'button not working']);

    const ctx = vi.mocked(createContext)('/tmp/.swarm', {} as any);
    expect(ctx.agentManager.spawn).toBeDefined();
    logSpy.mockRestore();
  });

  it('should read from file when --file is used', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerFix } = await import('../../commands/fix.js');
    registerFix(program);
    await program.parseAsync(['node', 'script', 'fix', 'bug.txt', '-f']);

    const fs = await import('node:fs');
    expect(fs.readFileSync).toHaveBeenCalledWith('bug.txt', 'utf-8');
    logSpy.mockRestore();
  });

  it('should fetch GitHub issue when --issue is used', async () => {
    const cp = await import('node:child_process');
    vi.mocked(cp.execSync).mockReturnValue(JSON.stringify({
      title: 'Bug title',
      body: 'Bug body',
      labels: [{ name: 'bug' }],
      comments: [],
    }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { registerFix } = await import('../../commands/fix.js');
    registerFix(program);
    await program.parseAsync(['node', 'script', 'fix', '-i', '123']);

    expect(cp.execSync).toHaveBeenCalledWith(
      expect.stringContaining('gh issue view 123'),
      expect.anything(),
    );
    logSpy.mockRestore();
  });

  it('should handle gh not installed error', async () => {
    const { isGhInstalled } = await import('../../core/git.js');
    vi.mocked(isGhInstalled).mockReturnValue(false);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as any);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { registerFix } = await import('../../commands/fix.js');
    registerFix(program);

    try {
      await program.parseAsync(['node', 'script', 'fix', '-i', '123']);
    } catch {}

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('gh CLI is not installed'));
    exitSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('should support --budget option', async () => {
    const { registerFix } = await import('../../commands/fix.js');
    registerFix(program);
    const cmd = program.commands.find(c => c.name() === 'fix');
    const opts = cmd!.options.map(o => o.long);
    expect(opts).toContain('--budget');
    expect(opts).toContain('--fix-budget');
  });
});
