import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue('file content'),
  existsSync: vi.fn().mockReturnValue(true),
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
  loadConfig: vi.fn().mockReturnValue({ model: 'sonnet', stack: 'react' }),
}));

const mockPipeline = {
  runAnalyze: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../commands/shared.js', () => ({
  createContext: vi.fn().mockReturnValue({
    pipeline: mockPipeline,
    cleanup: vi.fn(),
  }),
}));

describe('analyze command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
  });

  it('should register the analyze command with correct description', async () => {
    const { registerAnalyze } = await import('../../commands/analyze.js');
    registerAnalyze(program);
    const cmd = program.commands.find(c => c.name() === 'analyze');
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toContain('Analyst');
  });

  it('should call pipeline.runAnalyze in interactive mode by default', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerAnalyze } = await import('../../commands/analyze.js');
    registerAnalyze(program);
    await program.parseAsync(['node', 'script', 'analyze', 'build a login page']);
    expect(mockPipeline.runAnalyze).toHaveBeenCalledWith(
      'build a login page',
      expect.objectContaining({ interactive: true }),
    );
    logSpy.mockRestore();
  });

  it('should read from file when --file flag is used', async () => {
    const fs = await import('node:fs');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerAnalyze } = await import('../../commands/analyze.js');
    registerAnalyze(program);
    await program.parseAsync(['node', 'script', 'analyze', 'requirements.txt', '-f']);
    expect(fs.readFileSync).toHaveBeenCalledWith('requirements.txt', 'utf-8');
    expect(mockPipeline.runAnalyze).toHaveBeenCalledWith(
      'file content',
      expect.anything(),
    );
    logSpy.mockRestore();
  });
});
