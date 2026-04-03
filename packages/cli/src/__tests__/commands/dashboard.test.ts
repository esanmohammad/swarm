import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('<html><head></head><body></body></html>'),
}));

vi.mock('node:http', () => ({
  createServer: vi.fn().mockReturnValue({
    listen: vi.fn((_port: number, cb: () => void) => cb()),
    close: vi.fn(),
    on: vi.fn(),
  }),
}));

vi.mock('node:crypto', () => ({
  randomBytes: vi.fn().mockReturnValue({ toString: () => 'mock-token-hex' }),
}));

vi.mock('open', () => ({
  default: vi.fn(),
}));

vi.mock('../../core/config.js', () => ({
  requireSwarmDir: vi.fn().mockReturnValue('/tmp/.swarm'),
  loadConfig: vi.fn().mockReturnValue({
    model: 'sonnet',
    stack: 'react',
    wsPort: 9900,
    dashboardPort: 9901,
    projectName: 'test',
  }),
}));

const mockWsServer = {
  start: vi.fn(),
  stop: vi.fn(),
};

const mockState = {
  killOrphanProcesses: vi.fn(),
  cleanupStaleAgents: vi.fn(),
  flush: vi.fn(),
};

vi.mock('../../commands/shared.js', () => ({
  createContext: vi.fn().mockReturnValue({
    state: {
      killOrphanProcesses: vi.fn(),
      cleanupStaleAgents: vi.fn(),
      flush: vi.fn(),
    },
    wsServer: {
      start: vi.fn(),
      stop: vi.fn(),
    },
    cleanup: vi.fn(),
  }),
}));

describe('dashboard command', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
  });

  it('should register the dashboard command', async () => {
    const { registerDashboard } = await import('../../commands/dashboard.js');
    registerDashboard(program);
    const cmd = program.commands.find(c => c.name() === 'dashboard');
    expect(cmd).toBeDefined();
  });

  it('should start WebSocket server', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { createContext } = await import('../../commands/shared.js');

    const { registerDashboard } = await import('../../commands/dashboard.js');
    registerDashboard(program);
    await program.parseAsync(['node', 'script', 'dashboard', '--no-open']);

    const ctx = vi.mocked(createContext)('/tmp/.swarm', {} as any);
    expect(ctx.wsServer.start).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('should cleanup stale agents on startup', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { createContext } = await import('../../commands/shared.js');

    const { registerDashboard } = await import('../../commands/dashboard.js');
    registerDashboard(program);
    await program.parseAsync(['node', 'script', 'dashboard', '--no-open']);

    const ctx = vi.mocked(createContext)('/tmp/.swarm', {} as any);
    expect(ctx.state.killOrphanProcesses).toHaveBeenCalled();
    expect(ctx.state.cleanupStaleAgents).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('should support --no-open flag', async () => {
    const { registerDashboard } = await import('../../commands/dashboard.js');
    registerDashboard(program);
    const cmd = program.commands.find(c => c.name() === 'dashboard');
    const opts = cmd!.options.map(o => o.long);
    expect(opts).toContain('--no-open');
  });
});
