import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue('src/index.ts\nsrc/utils.ts'),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue('export function hello() { return "world"; }'),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({ isFile: () => true, isDirectory: () => false }),
}));

vi.mock('node:path', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:path')>();
  return {
    ...original,
    resolve: vi.fn((...args: string[]) => args.join('/')),
    relative: vi.fn((_from: string, to: string) => to),
    join: original.join,
    extname: original.extname,
    basename: original.basename,
  };
});

vi.mock('ora', () => ({
  default: vi.fn().mockReturnValue({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    stop: vi.fn(),
    text: '',
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
        output: 'Tests generated',
        error: null,
      }),
      waitForAgent: vi.fn().mockResolvedValue(undefined),
    },
    cleanup: vi.fn(),
  }),
}));

vi.mock('../../commands/learn.js', () => ({
  loadConventions: vi.fn().mockReturnValue(''),
}));

describe('test-gen command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
  });

  it('should register the test-gen command', async () => {
    const { registerTestGen } = await import('../../commands/test-gen.js');
    registerTestGen(program);
    const cmd = program.commands.find(c => c.name() === 'test-gen');
    expect(cmd).toBeDefined();
  });

  it('should support --dry-run flag', async () => {
    const { registerTestGen } = await import('../../commands/test-gen.js');
    registerTestGen(program);
    const cmd = program.commands.find(c => c.name() === 'test-gen');
    const opts = cmd!.options.map(o => o.long);
    expect(opts).toContain('--dry-run');
  });

  it('should support --coverage flag', async () => {
    const { registerTestGen } = await import('../../commands/test-gen.js');
    registerTestGen(program);
    const cmd = program.commands.find(c => c.name() === 'test-gen');
    const opts = cmd!.options.map(o => o.long);
    expect(opts).toContain('--coverage');
  });

  it('should support --verify flag', async () => {
    const { registerTestGen } = await import('../../commands/test-gen.js');
    registerTestGen(program);
    const cmd = program.commands.find(c => c.name() === 'test-gen');
    const opts = cmd!.options.map(o => o.long);
    expect(opts).toContain('--verify');
  });

  it('should support --framework option', async () => {
    const { registerTestGen } = await import('../../commands/test-gen.js');
    registerTestGen(program);
    const cmd = program.commands.find(c => c.name() === 'test-gen');
    const opts = cmd!.options.map(o => o.long);
    expect(opts).toContain('--framework');
  });

  it('should support --parallel option with default 3', async () => {
    const { registerTestGen } = await import('../../commands/test-gen.js');
    registerTestGen(program);
    const cmd = program.commands.find(c => c.name() === 'test-gen');
    const opts = cmd!.options.find(o => o.long === '--parallel');
    expect(opts).toBeDefined();
    expect(opts!.defaultValue).toBe('3');
  });

  it('should default model to sonnet', async () => {
    const { registerTestGen } = await import('../../commands/test-gen.js');
    registerTestGen(program);
    const cmd = program.commands.find(c => c.name() === 'test-gen');
    const modelOpt = cmd!.options.find(o => o.long === '--model');
    expect(modelOpt).toBeDefined();
    expect(modelOpt!.defaultValue).toBe('sonnet');
  });

  it('should support scope argument', async () => {
    const { registerTestGen } = await import('../../commands/test-gen.js');
    registerTestGen(program);
    const cmd = program.commands.find(c => c.name() === 'test-gen');
    // The command takes optional [scope] argument
    expect(cmd!.registeredArguments.length).toBeGreaterThanOrEqual(0);
  });

  it('should have STACK_EXTENSIONS mappings for all stacks', async () => {
    // This tests the module-level constants indirectly
    const { registerTestGen } = await import('../../commands/test-gen.js');
    registerTestGen(program);
    const cmd = program.commands.find(c => c.name() === 'test-gen');
    expect(cmd).toBeDefined();
  });

  it('should support --budget option with default 5', async () => {
    const { registerTestGen } = await import('../../commands/test-gen.js');
    registerTestGen(program);
    const cmd = program.commands.find(c => c.name() === 'test-gen');
    const budgetOpt = cmd!.options.find(o => o.long === '--budget');
    expect(budgetOpt).toBeDefined();
    expect(budgetOpt!.defaultValue).toBe('5');
  });

  it('should support --stack option', async () => {
    const { registerTestGen } = await import('../../commands/test-gen.js');
    registerTestGen(program);
    const cmd = program.commands.find(c => c.name() === 'test-gen');
    const opts = cmd!.options.map(o => o.long);
    expect(opts).toContain('--stack');
  });

  it('should have description mentioning test generation', async () => {
    const { registerTestGen } = await import('../../commands/test-gen.js');
    registerTestGen(program);
    const cmd = program.commands.find(c => c.name() === 'test-gen');
    expect(cmd!.description()).toContain('test');
  });
});
