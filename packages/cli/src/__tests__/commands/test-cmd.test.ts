import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

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

vi.mock('../../core/input-listener.js', () => ({
  InputListener: class {
    start = vi.fn();
    stop = vi.fn();
  },
}));

const mockRunTest = vi.fn().mockResolvedValue(undefined);
const mockFormatTotal = vi.fn().mockReturnValue('Total: $0.05');

vi.mock('../../commands/shared.js', () => ({
  createContext: vi.fn().mockReturnValue({
    pipeline: {
      runTest: mockRunTest,
    },
    agentManager: {
      getRunningAgents: vi.fn().mockReturnValue([]),
      sendInput: vi.fn(),
    },
    costTracker: {
      formatTotal: mockFormatTotal,
    },
    cleanup: vi.fn(),
  }),
}));

describe('test command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
  });

  it('should register the test command', async () => {
    const { registerTest } = await import('../../commands/test.js');
    registerTest(program);
    const cmd = program.commands.find(c => c.name() === 'test');
    expect(cmd).toBeDefined();
  });

  it('should call pipeline.runTest with default parallel=2 in headless mode', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerTest } = await import('../../commands/test.js');
    registerTest(program);
    await program.parseAsync(['node', 'script', 'test', '--headless']);
    expect(mockRunTest).toHaveBeenCalledWith(
      expect.objectContaining({ parallel: 2 }),
    );
    logSpy.mockRestore();
  });

  it('should support --figma option', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerTest } = await import('../../commands/test.js');
    registerTest(program);
    await program.parseAsync(['node', 'script', 'test', '--figma', 'https://figma.com/x', '--headless']);
    expect(mockRunTest).toHaveBeenCalledWith(
      expect.objectContaining({ figmaUrl: 'https://figma.com/x' }),
    );
    logSpy.mockRestore();
  });

  it('should call pipeline.runTest with interactive=true when -i flag is passed', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerTest } = await import('../../commands/test.js');
    registerTest(program);
    await program.parseAsync(['node', 'script', 'test', '-i']);
    expect(mockRunTest).toHaveBeenCalledWith(
      expect.objectContaining({ interactive: true }),
    );
    logSpy.mockRestore();
  });
});
