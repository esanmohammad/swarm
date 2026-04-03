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

const mockPipeline = {
  runPlan: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../commands/shared.js', () => ({
  createContext: vi.fn().mockReturnValue({
    pipeline: mockPipeline,
    cleanup: vi.fn(),
  }),
}));

describe('plan command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
  });

  it('should register the plan command', async () => {
    const { registerPlan } = await import('../../commands/plan.js');
    registerPlan(program);
    const cmd = program.commands.find(c => c.name() === 'plan');
    expect(cmd).toBeDefined();
  });

  it('should call pipeline.runPlan with interactive true by default', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerPlan } = await import('../../commands/plan.js');
    registerPlan(program);
    await program.parseAsync(['node', 'script', 'plan']);
    expect(mockPipeline.runPlan).toHaveBeenCalledWith(
      expect.objectContaining({ interactive: true }),
    );
    logSpy.mockRestore();
  });
});
