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

const mockPipeline = {
  runBuild: vi.fn().mockResolvedValue(undefined),
};

const mockCostTracker = {
  formatTotal: vi.fn().mockReturnValue('Total: $0.05'),
};

const mockAgentManager = {
  getRunningAgents: vi.fn().mockReturnValue([]),
  sendInput: vi.fn(),
};

vi.mock('../../commands/shared.js', () => ({
  createContext: vi.fn().mockReturnValue({
    pipeline: mockPipeline,
    agentManager: mockAgentManager,
    costTracker: mockCostTracker,
    cleanup: vi.fn(),
  }),
}));

describe('build command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
  });

  it('should register the build command', async () => {
    const { registerBuild } = await import('../../commands/build.js');
    registerBuild(program);
    const cmd = program.commands.find(c => c.name() === 'build');
    expect(cmd).toBeDefined();
  });

  it('should call pipeline.runBuild with default parallel=3', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerBuild } = await import('../../commands/build.js');
    registerBuild(program);
    await program.parseAsync(['node', 'script', 'build']);
    expect(mockPipeline.runBuild).toHaveBeenCalledWith(
      expect.objectContaining({ parallel: 3 }),
    );
    logSpy.mockRestore();
  });

  it('should accept --task option for specific task ID', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerBuild } = await import('../../commands/build.js');
    registerBuild(program);
    await program.parseAsync(['node', 'test', 'build', '-t', 'FND-001']);
    expect(mockPipeline.runBuild).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'FND-001' }),
    );
    logSpy.mockRestore();
  });
});
