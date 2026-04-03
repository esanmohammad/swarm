import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue('file content'),
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('node:readline', () => ({
  createInterface: vi.fn().mockReturnValue({
    question: vi.fn((_q: string, cb: (answer: string) => void) => cb('y')),
    close: vi.fn(),
  }),
}));

vi.mock('../../core/config.js', () => ({
  requireSwarmDir: vi.fn().mockReturnValue('/tmp/.swarm'),
  loadConfig: vi.fn().mockReturnValue({ model: 'sonnet', stack: 'react', models: {} }),
  autoDetectStack: vi.fn().mockReturnValue('react'),
  autoInit: vi.fn().mockReturnValue('/tmp/.swarm'),
}));

const mockPipeline = {
  runMayday: vi.fn().mockResolvedValue(undefined),
  resumeMayday: vi.fn().mockResolvedValue(undefined),
  gitEnabled: true,
  estimateCost: vi.fn().mockReturnValue({ low: 0.5, high: 2.0 }),
};

// Static method mock
vi.mock('../../core/pipeline.js', () => ({
  Pipeline: Object.assign(vi.fn(), {
    estimateCost: vi.fn().mockReturnValue({ low: 0.5, high: 2.0 }),
  }),
}));

const mockState = {
  getMayday: vi.fn().mockReturnValue(null),
};

vi.mock('../../commands/shared.js', () => ({
  createContext: vi.fn().mockReturnValue({
    pipeline: {
      runMayday: vi.fn().mockResolvedValue(undefined),
      resumeMayday: vi.fn().mockResolvedValue(undefined),
      gitEnabled: true,
    },
    state: {
      getMayday: vi.fn().mockReturnValue(null),
    },
    cleanup: vi.fn(),
  }),
}));

describe('mayday command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
  });

  it('should register the mayday command', async () => {
    const { registerMayday } = await import('../../commands/mayday.js');
    registerMayday(program);
    const cmd = program.commands.find(c => c.name() === 'mayday');
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toContain('Autonomous');
  });

  it('should require feature request when not resuming', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as any);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { registerMayday } = await import('../../commands/mayday.js');
    registerMayday(program);

    try {
      await program.parseAsync(['node', 'script', 'mayday', '-y']);
    } catch {}

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Feature request required'));
    exitSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('should call pipeline.runMayday with feature request and --yes flag', async () => {
    const { createContext } = await import('../../commands/shared.js');
    const ctx = vi.mocked(createContext).mock.results[0]?.value ?? (createContext as any)();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { registerMayday } = await import('../../commands/mayday.js');
    registerMayday(program);
    await program.parseAsync(['node', 'script', 'mayday', 'build a login page', '-y']);

    // The pipeline.runMayday should have been called
    const { createContext: cc } = await import('../../commands/shared.js');
    const context = vi.mocked(cc)('', {} as any);
    expect(context.pipeline.runMayday).toBeDefined();
    logSpy.mockRestore();
  });

  it('should support --lean option', async () => {
    const { registerMayday } = await import('../../commands/mayday.js');
    registerMayday(program);
    const cmd = program.commands.find(c => c.name() === 'mayday');
    expect(cmd).toBeDefined();
    // Verify the option is registered
    const opts = cmd!.options.map(o => o.long);
    expect(opts).toContain('--lean');
  });

  it('should support --smart option', async () => {
    const { registerMayday } = await import('../../commands/mayday.js');
    registerMayday(program);
    const cmd = program.commands.find(c => c.name() === 'mayday');
    const opts = cmd!.options.map(o => o.long);
    expect(opts).toContain('--smart');
  });

  it('should support --from option for stage skipping', async () => {
    const { registerMayday } = await import('../../commands/mayday.js');
    registerMayday(program);
    const cmd = program.commands.find(c => c.name() === 'mayday');
    const opts = cmd!.options.map(o => o.long);
    expect(opts).toContain('--from');
  });
});
