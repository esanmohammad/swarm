import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('yaml', () => ({
  stringify: vi.fn().mockReturnValue('yaml-content'),
}));

vi.mock('../../types.js', () => ({
  DEFAULT_CONFIG: {
    projectName: 'default',
    stack: 'react',
    model: 'sonnet',
    maxBudgetUsd: 5,
    wsPort: 9900,
    dashboardPort: 9901,
  },
  createEmptyPipeline: vi.fn().mockReturnValue({ projectName: 'test', stages: {} }),
}));

describe('init command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
  });

  it('should register the init command', async () => {
    const { registerInit } = await import('../../commands/init.js');
    registerInit(program);
    const cmd = program.commands.find(c => c.name() === 'init');
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toContain('Initialize');
  });

  it('should skip init if .swarm/ already exists', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { registerInit } = await import('../../commands/init.js');
    registerInit(program);
    await program.parseAsync(['node', 'script', 'init']);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('already exists'));
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('should create .swarm/ directory and files on fresh init', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { registerInit } = await import('../../commands/init.js');
    registerInit(program);
    await program.parseAsync(['node', 'script', 'init', '-s', 'node']);

    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('should accept model and budget options', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { registerInit } = await import('../../commands/init.js');
    registerInit(program);
    await program.parseAsync(['node', 'script', 'init', '-m', 'opus', '-b', '10']);

    expect(fs.writeFileSync).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('should use project name from --name option', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { registerInit } = await import('../../commands/init.js');
    registerInit(program);
    await program.parseAsync(['node', 'script', 'init', '-n', 'my-app']);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('my-app'));
    logSpy.mockRestore();
  });
});
