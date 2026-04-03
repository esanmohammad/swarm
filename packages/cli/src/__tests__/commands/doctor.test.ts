import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue('/usr/local/bin/claude'),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue('projectName: test\nstack: react'),
}));

vi.mock('yaml', () => ({
  parse: vi.fn().mockReturnValue({ projectName: 'test', stack: 'react' }),
}));

describe('doctor command', () => {
  let program: Command;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should register the doctor command', async () => {
    const { registerDoctor } = await import('../../commands/doctor.js');
    registerDoctor(program);
    const cmd = program.commands.find(c => c.name() === 'doctor');
    expect(cmd).toBeDefined();
  });

  it('should run all checks and print results', async () => {
    const { registerDoctor } = await import('../../commands/doctor.js');
    registerDoctor(program);
    await program.parseAsync(['node', 'script', 'doctor']);
    // Should print "Swarm Doctor" header and check results
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Swarm Doctor'));
    logSpy.mockRestore();
  });

  it('should check Node.js version', async () => {
    const { registerDoctor } = await import('../../commands/doctor.js');
    registerDoctor(program);
    await program.parseAsync(['node', 'script', 'doctor']);
    const calls = logSpy.mock.calls.flat().join(' ');
    expect(calls).toContain('Node.js version');
    logSpy.mockRestore();
  });

  it('should check claude CLI installation', async () => {
    const { registerDoctor } = await import('../../commands/doctor.js');
    registerDoctor(program);
    await program.parseAsync(['node', 'script', 'doctor']);
    const calls = logSpy.mock.calls.flat().join(' ');
    expect(calls).toContain('claude CLI');
    logSpy.mockRestore();
  });

  it('should check .swarm/ directory existence', async () => {
    const { registerDoctor } = await import('../../commands/doctor.js');
    registerDoctor(program);
    await program.parseAsync(['node', 'script', 'doctor']);
    const calls = logSpy.mock.calls.flat().join(' ');
    expect(calls).toContain('.swarm/');
    logSpy.mockRestore();
  });

  it('should print pass/total checks summary', async () => {
    const { registerDoctor } = await import('../../commands/doctor.js');
    registerDoctor(program);
    await program.parseAsync(['node', 'script', 'doctor']);
    const calls = logSpy.mock.calls.flat().join(' ');
    expect(calls).toMatch(/\d+\/\d+ checks passed/);
    logSpy.mockRestore();
  });
});
