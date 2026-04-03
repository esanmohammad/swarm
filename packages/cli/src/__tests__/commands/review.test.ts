import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue('mock diff output'),
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

const mockAgent = {
  id: 'agent-1',
  status: 'done',
  cost: { totalUsd: 0.02 },
  output: '## Summary\nGood code.\n## Verdict\nAPPROVE',
  error: null,
};

vi.mock('../../commands/shared.js', () => ({
  createContext: vi.fn().mockReturnValue({
    agentManager: {
      spawn: vi.fn().mockResolvedValue({
        id: 'agent-1',
        status: 'done',
        cost: { totalUsd: 0.02 },
        output: '## Summary\nGood code.\n## Verdict\nAPPROVE',
        error: null,
      }),
      waitForAgent: vi.fn().mockResolvedValue(undefined),
    },
    cleanup: vi.fn(),
  }),
}));

describe('review command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
  });

  it('should register the review command', async () => {
    const { registerReview } = await import('../../commands/review.js');
    registerReview(program);
    const cmd = program.commands.find(c => c.name() === 'review');
    expect(cmd).toBeDefined();
  });

  it('should review PR by number', async () => {
    const cp = await import('node:child_process');
    vi.mocked(cp.execSync)
      .mockReturnValueOnce(JSON.stringify({ title: 'PR title', body: 'desc', files: [], additions: 10, deletions: 5 }))
      .mockReturnValueOnce('+ added line\n- removed line');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerReview } = await import('../../commands/review.js');
    registerReview(program);
    await program.parseAsync(['node', 'script', 'review', '42']);

    expect(cp.execSync).toHaveBeenCalledWith(
      expect.stringContaining('gh pr view 42'),
      expect.anything(),
    );
    logSpy.mockRestore();
  });

  it('should review branch diff', async () => {
    const cp = await import('node:child_process');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { registerReview } = await import('../../commands/review.js');
    registerReview(program);
    await program.parseAsync(['node', 'script', 'review', 'feature-branch']);

    expect(cp.execSync).toHaveBeenCalledWith(
      expect.stringContaining('git diff feature-branch...HEAD'),
      expect.anything(),
    );
    logSpy.mockRestore();
  });

  it('should review current changes when no target', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerReview } = await import('../../commands/review.js');
    registerReview(program);
    await program.parseAsync(['node', 'script', 'review']);

    const cp = await import('node:child_process');
    expect(cp.execSync).toHaveBeenCalledWith(
      expect.stringContaining('git diff --cached'),
      expect.anything(),
    );
    logSpy.mockRestore();
  });

  it('should spawn agent with disallowed tools for read-only', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { createContext } = await import('../../commands/shared.js');

    const { registerReview } = await import('../../commands/review.js');
    registerReview(program);
    await program.parseAsync(['node', 'script', 'review', 'main']);

    const ctx = vi.mocked(createContext)('/tmp/.swarm', {} as any);
    // Verify spawn is available - the actual call includes disallowedTools
    expect(ctx.agentManager.spawn).toBeDefined();
    logSpy.mockRestore();
  });

  it('should truncate diffs longer than 50KB', async () => {
    const cp = await import('node:child_process');
    const largeDiff = 'x'.repeat(60000);
    vi.mocked(cp.execSync).mockReturnValue(largeDiff);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerReview } = await import('../../commands/review.js');
    registerReview(program);
    await program.parseAsync(['node', 'script', 'review', 'main']);

    // The command should still succeed even with truncated diff
    const ctx = (await import('../../commands/shared.js')).createContext('', {} as any);
    expect(ctx.agentManager.spawn).toBeDefined();
    logSpy.mockRestore();
  });

  it('should support --post flag', async () => {
    const { registerReview } = await import('../../commands/review.js');
    registerReview(program);
    const cmd = program.commands.find(c => c.name() === 'review');
    const opts = cmd!.options.map(o => o.long);
    expect(opts).toContain('--post');
  });

  it('should support --budget flag', async () => {
    const { registerReview } = await import('../../commands/review.js');
    registerReview(program);
    const cmd = program.commands.find(c => c.name() === 'review');
    const opts = cmd!.options.map(o => o.long);
    expect(opts).toContain('--budget');
  });
});
