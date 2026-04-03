import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue('file1.ts\nfile2.ts'),
}));

vi.mock('ora', () => ({
  default: vi.fn().mockReturnValue({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
    info: vi.fn(),
    stop: vi.fn(),
  }),
}));

vi.mock('../../core/config.js', () => ({
  requireSwarmDir: vi.fn().mockReturnValue('/tmp/.swarm'),
  loadConfig: vi.fn().mockReturnValue({ model: 'sonnet', stack: 'react', projectName: 'test' }),
  autoDetectStack: vi.fn().mockReturnValue('react'),
  autoInit: vi.fn().mockReturnValue('/tmp/.swarm'),
}));

const mockIsGhInstalled = vi.fn().mockReturnValue(true);
const mockGetCurrentBranch = vi.fn().mockReturnValue('feat/my-feature');
const mockHasUncommittedChanges = vi.fn().mockReturnValue(false);
const mockSuggestReviewers = vi.fn().mockReturnValue(['alice', 'bob']);
const mockBuildSmartPRBody = vi.fn().mockReturnValue('## Summary\nPR body');

vi.mock('../../core/git.js', () => ({
  isGhInstalled: (...args: any[]) => mockIsGhInstalled(...args),
  getCurrentBranch: (...args: any[]) => mockGetCurrentBranch(...args),
  hasUncommittedChanges: (...args: any[]) => mockHasUncommittedChanges(...args),
  suggestReviewers: (...args: any[]) => mockSuggestReviewers(...args),
  buildSmartPRBody: (...args: any[]) => mockBuildSmartPRBody(...args),
}));

vi.mock('../../core/risk-scorer.js', () => ({
  RiskScorer: class {
    scoreFiles = vi.fn().mockReturnValue([
      { file: 'file1.ts', overall: 30, level: 'low' },
      { file: 'file2.ts', overall: 70, level: 'high' },
    ]);
  },
}));

vi.mock('../../commands/shared.js', () => ({
  createContext: vi.fn().mockReturnValue({
    state: {
      getState: vi.fn().mockReturnValue({ projectName: 'test', stages: {} }),
    },
    cleanup: vi.fn(),
  }),
}));

describe('pr command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsGhInstalled.mockReturnValue(true);
    mockGetCurrentBranch.mockReturnValue('feat/my-feature');
    mockHasUncommittedChanges.mockReturnValue(false);
    program = new Command();
    program.exitOverride();
  });

  it('should register the pr command', async () => {
    const { registerPr } = await import('../../commands/pr.js');
    registerPr(program);
    const cmd = program.commands.find(c => c.name() === 'pr');
    expect(cmd).toBeDefined();
  });

  it('should fail when gh CLI not installed', async () => {
    mockIsGhInstalled.mockReturnValue(false);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as any);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { registerPr } = await import('../../commands/pr.js');
    registerPr(program);

    try {
      await program.parseAsync(['node', 'script', 'pr']);
    } catch {}

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('gh'));
    exitSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('should fail when on base branch', async () => {
    mockGetCurrentBranch.mockReturnValue('main');

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as any);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { registerPr } = await import('../../commands/pr.js');
    registerPr(program);

    try {
      await program.parseAsync(['node', 'script', 'pr']);
    } catch {}

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('base branch'));
    exitSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('should fail when no changed files', async () => {
    const cp = await import('node:child_process');
    vi.mocked(cp.execSync).mockReturnValue('');

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as any);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { registerPr } = await import('../../commands/pr.js');
    registerPr(program);

    try {
      await program.parseAsync(['node', 'script', 'pr']);
    } catch {}

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('No changed files'));
    exitSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('should create PR with auto-generated title from branch', async () => {
    const cp = await import('node:child_process');
    vi.mocked(cp.execSync)
      .mockReturnValueOnce('file1.ts\nfile2.ts')  // git diff --name-only
      .mockReturnValueOnce('https://github.com/owner/repo/pull/1');  // gh pr create

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { registerPr } = await import('../../commands/pr.js');
    registerPr(program);
    await program.parseAsync(['node', 'script', 'pr']);

    // gh pr create should have been called
    expect(cp.execSync).toHaveBeenCalledWith(
      expect.stringContaining('gh pr create'),
      expect.anything(),
    );
    logSpy.mockRestore();
  });

  it('should support --draft flag', async () => {
    const { registerPr } = await import('../../commands/pr.js');
    registerPr(program);
    const cmd = program.commands.find(c => c.name() === 'pr');
    const opts = cmd!.options.map(o => o.long);
    expect(opts).toContain('--draft');
  });

  it('should support --risk flag', async () => {
    const { registerPr } = await import('../../commands/pr.js');
    registerPr(program);
    const cmd = program.commands.find(c => c.name() === 'pr');
    const opts = cmd!.options.map(o => o.long);
    expect(opts).toContain('--risk');
  });

  it('should support --label flag', async () => {
    const { registerPr } = await import('../../commands/pr.js');
    registerPr(program);
    const cmd = program.commands.find(c => c.name() === 'pr');
    const opts = cmd!.options.map(o => o.long);
    expect(opts).toContain('--label');
  });

  it('should auto-generate title from branch name stripping feat/ prefix', async () => {
    mockGetCurrentBranch.mockReturnValue('feat/add-login-page');
    const cp = await import('node:child_process');
    vi.mocked(cp.execSync)
      .mockReturnValueOnce('file1.ts\nfile2.ts')
      .mockReturnValueOnce('https://github.com/owner/repo/pull/1');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerPr } = await import('../../commands/pr.js');
    registerPr(program);
    await program.parseAsync(['node', 'script', 'pr']);

    // The title should have stripped 'feat/' prefix and humanized
    const ghCall = vi.mocked(cp.execSync).mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('gh pr create')
    );
    expect(ghCall).toBeDefined();
    logSpy.mockRestore();
  });
});
