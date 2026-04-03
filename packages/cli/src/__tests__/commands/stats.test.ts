import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../../core/config.js', () => ({
  requireSwarmDir: vi.fn().mockReturnValue('/tmp/.swarm'),
  loadConfig: vi.fn().mockReturnValue({ projectName: 'test', stack: 'react' }),
}));

const mockHistory = [
  {
    runId: 'run-1',
    timestamp: Date.now() - 86400000,
    projectName: 'test',
    stack: 'react',
    totalCost: { totalUsd: 2.50, inputTokens: 5000, outputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 60000 },
    stagesSummary: { analyze: 'done', architect: 'done', plan: 'done', build: 'done', test: 'done', evaluate: 'done' },
    durationMs: 120000,
    fixIterations: 1,
    stageBreakdowns: [
      { name: 'analyze', cost: 0.50, durationMs: 20000, status: 'done' },
      { name: 'build', cost: 1.50, durationMs: 60000, status: 'done' },
    ],
  },
];

vi.mock('../../core/state.js', () => ({
  StateManager: class {
    init = vi.fn();
    listHistory = vi.fn().mockReturnValue(mockHistory);
  },
}));

describe('stats command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
  });

  it('should register the stats command', async () => {
    const { registerStats } = await import('../../commands/stats.js');
    registerStats(program);
    const cmd = program.commands.find(c => c.name() === 'stats');
    expect(cmd).toBeDefined();
  });

  it('should display stats overview', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerStats } = await import('../../commands/stats.js');
    registerStats(program);
    await program.parseAsync(['node', 'script', 'stats']);

    const calls = logSpy.mock.calls.flat().join(' ');
    expect(calls).toContain('Swarm Stats');
    expect(calls).toContain('Runs:');
    logSpy.mockRestore();
  });

  it('should support --json output', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { registerStats } = await import('../../commands/stats.js');
    registerStats(program);
    await program.parseAsync(['node', 'script', 'stats', '--json']);

    // JSON output should have been logged
    const jsonCall = logSpy.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('"totalRuns"')
    );
    expect(jsonCall).toBeDefined();
    logSpy.mockRestore();
  });

  it('should support --period option', async () => {
    const { registerStats } = await import('../../commands/stats.js');
    registerStats(program);
    const cmd = program.commands.find(c => c.name() === 'stats');
    const periodOpt = cmd!.options.find(o => o.long === '--period');
    expect(periodOpt).toBeDefined();
    expect(periodOpt!.defaultValue).toBe('30');
  });

  it('should export computeStats function', async () => {
    const { computeStats } = await import('../../commands/stats.js');
    expect(typeof computeStats).toBe('function');
  });

  it('should compute correct stats from history entries', async () => {
    const { computeStats } = await import('../../commands/stats.js');
    const stats = computeStats(mockHistory as any);
    expect(stats.totalRuns).toBe(1);
    expect(stats.totalCost).toBeCloseTo(2.50);
    expect(stats.successRate).toBe(100);
  });
});
