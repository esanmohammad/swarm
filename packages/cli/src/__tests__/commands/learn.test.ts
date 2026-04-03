import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('# Project Conventions\nUse ESM'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('ora', () => ({
  default: vi.fn().mockReturnValue({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    stop: vi.fn(),
  }),
}));

vi.mock('../../core/config.js', () => ({
  requireSwarmDir: vi.fn().mockReturnValue('/tmp/.swarm'),
  loadConfig: vi.fn().mockReturnValue({ model: 'sonnet', stack: 'react' }),
  autoDetectStack: vi.fn().mockReturnValue('react'),
  autoInit: vi.fn().mockReturnValue('/tmp/.swarm'),
}));

vi.mock('../../core/convention-extractor.js', () => ({
  extractConventions: vi.fn().mockReturnValue('## Naming\ncamelCase for variables'),
  buildConventionPrompt: vi.fn().mockReturnValue('Convention prompt text'),
}));

describe('learn command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
  });

  it('should register the learn command', async () => {
    const { registerLearn } = await import('../../commands/learn.js');
    registerLearn(program);
    const cmd = program.commands.find(c => c.name() === 'learn');
    expect(cmd).toBeDefined();
  });

  it('should write conventions to file on fresh run', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { registerLearn } = await import('../../commands/learn.js');
    registerLearn(program);
    await program.parseAsync(['node', 'script', 'learn']);

    expect(fs.writeFileSync).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('should print conventions with --show flag', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerLearn } = await import('../../commands/learn.js');
    registerLearn(program);
    await program.parseAsync(['node', 'script', 'learn', '--show']);

    expect(logSpy).toHaveBeenCalledWith('Convention prompt text');
    logSpy.mockRestore();
  });

  it('should export loadConventions function', async () => {
    const { loadConventions } = await import('../../commands/learn.js');
    expect(typeof loadConventions).toBe('function');
  });
});
