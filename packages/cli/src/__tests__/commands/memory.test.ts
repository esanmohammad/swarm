import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../../core/config.js', () => ({
  requireSwarmDir: vi.fn().mockReturnValue('/tmp/.swarm'),
  autoDetectStack: vi.fn().mockReturnValue('react'),
  autoInit: vi.fn().mockReturnValue('/tmp/.swarm'),
}));

const mockList = vi.fn().mockReturnValue([]);
const mockAdd = vi.fn().mockReturnValue({ id: 'mem-1' });
const mockClear = vi.fn();
const mockRemove = vi.fn().mockReturnValue(true);
const mockBuildMemoryContext = vi.fn().mockReturnValue('Memory context text');

vi.mock('../../core/memory-store.js', () => ({
  MemoryStore: class {
    list = mockList;
    add = mockAdd;
    clear = mockClear;
    remove = mockRemove;
    buildMemoryContext = mockBuildMemoryContext;
  },
}));

describe('memory command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockReturnValue([]);
    mockAdd.mockReturnValue({ id: 'mem-1' });
    mockRemove.mockReturnValue(true);
    mockBuildMemoryContext.mockReturnValue('Memory context text');
    program = new Command();
    program.exitOverride();
  });

  it('should register the memory command with subcommands', async () => {
    const { registerMemory } = await import('../../commands/memory.js');
    registerMemory(program);
    const cmd = program.commands.find(c => c.name() === 'memory');
    expect(cmd).toBeDefined();
    // Should have subcommands: list, add, clear, remove, show
    const subCmds = cmd!.commands.map(c => c.name());
    expect(subCmds).toContain('list');
    expect(subCmds).toContain('add');
    expect(subCmds).toContain('clear');
    expect(subCmds).toContain('remove');
    expect(subCmds).toContain('show');
  });

  it('memory list should call store.list()', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerMemory } = await import('../../commands/memory.js');
    registerMemory(program);
    await program.parseAsync(['node', 'script', 'memory', 'list']);

    expect(mockList).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('memory add should call store.add() with content', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerMemory } = await import('../../commands/memory.js');
    registerMemory(program);
    await program.parseAsync(['node', 'script', 'memory', 'add', 'use ESM imports']);

    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'use ESM imports', kind: 'manual' }),
    );
    logSpy.mockRestore();
  });

  it('memory clear should call store.clear()', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerMemory } = await import('../../commands/memory.js');
    registerMemory(program);
    await program.parseAsync(['node', 'script', 'memory', 'clear']);

    expect(mockClear).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('memory show should call store.buildMemoryContext()', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerMemory } = await import('../../commands/memory.js');
    registerMemory(program);
    await program.parseAsync(['node', 'script', 'memory', 'show']);

    expect(mockBuildMemoryContext).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('Memory context text');
    logSpy.mockRestore();
  });
});
