import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { AgentProcess } from '../../core/agent-process.js';
import type { AgentProcessConfig } from '../../core/agent-process.js';

// Mock child_process.spawn
vi.mock('node:child_process', () => {
  return {
    spawn: vi.fn(),
    execSync: vi.fn(),
  };
});

// Mock fs operations used by AgentProcess
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: { end: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
    pid: number;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdin = { end: vi.fn() };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.pid = 12345;
  proc.killed = false;
  proc.kill = vi.fn(() => { proc.killed = true; });
  return proc;
}

function defaultConfig(overrides: Partial<AgentProcessConfig> = {}): AgentProcessConfig {
  return {
    prompt: 'Test prompt',
    systemPrompt: 'You are a test agent.',
    model: 'opus',
    sessionId: 'test-session-123',
    cwd: '/tmp/test',
    timeoutMs: 0, // disable watchdog for tests
    ...overrides,
  };
}

function sendStreamLine(proc: ReturnType<typeof createMockProcess>, obj: Record<string, unknown>) {
  proc.stdout.emit('data', Buffer.from(JSON.stringify(obj) + '\n'));
}

describe('AgentProcess', () => {
  let mockProc: ReturnType<typeof createMockProcess>;

  beforeEach(async () => {
    mockProc = createMockProcess();
    const { spawn } = await import('node:child_process');
    (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProc);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should spawn with correct CLI args', async () => {
    const { spawn } = await import('node:child_process');
    const agent = new AgentProcess(defaultConfig());
    agent.start();

    expect(spawn).toHaveBeenCalledWith('claude', expect.arrayContaining([
      '-p', 'Test prompt',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', 'opus',
      '--session-id', 'test-session-123',
    ]), expect.objectContaining({ cwd: '/tmp/test' }));
  });

  it('should parse stream-json content events', () => {
    const agent = new AgentProcess(defaultConfig());
    const contentChunks: string[] = [];
    agent.on('content', (text) => contentChunks.push(text));
    agent.start();

    sendStreamLine(mockProc, {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Hello world' }],
      },
    });

    expect(contentChunks).toContain('Hello world');
  });

  it('should emit content events with output text', () => {
    const agent = new AgentProcess(defaultConfig());
    const chunks: string[] = [];
    agent.on('content', (text) => chunks.push(text));
    agent.start();

    sendStreamLine(mockProc, {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'First chunk' },
          { type: 'text', text: 'Second chunk' },
        ],
      },
    });

    expect(chunks).toEqual(['First chunk', 'Second chunk']);
  });

  it('should emit result event with cost', () => {
    const agent = new AgentProcess(defaultConfig());
    let resultData: unknown = null;
    agent.on('result', (data) => { resultData = data; });
    agent.start();

    sendStreamLine(mockProc, {
      type: 'result',
      result: 'Final output text',
      total_cost_usd: 0.05,
      duration_ms: 5000,
      session_id: 'sess-abc',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5,
      },
    });

    expect(resultData).toBeDefined();
    const rd = resultData as { result: string; cost: { totalUsd: number }; sessionId: string };
    expect(rd.result).toBe('Final output text');
    expect(rd.cost.totalUsd).toBe(0.05);
    expect(rd.sessionId).toBe('sess-abc');
  });

  it('should kill agent and clean up', () => {
    const agent = new AgentProcess(defaultConfig());
    agent.start();
    agent.kill();
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('should emit exit event on non-zero exit code', () => {
    const agent = new AgentProcess(defaultConfig());
    let exitCode: number | null = null;
    agent.on('exit', (code) => { exitCode = code; });
    agent.start();

    mockProc.emit('exit', 1);
    expect(exitCode).toBe(1);
  });

  it('should handle multiple content lines in a single data chunk', () => {
    const agent = new AgentProcess(defaultConfig());
    const chunks: string[] = [];
    agent.on('content', (text) => chunks.push(text));
    agent.start();

    // Send two JSON lines in a single buffer
    const line1 = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Line 1' }] } });
    const line2 = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Line 2' }] } });
    mockProc.stdout.emit('data', Buffer.from(line1 + '\n' + line2 + '\n'));

    expect(chunks).toEqual(['Line 1', 'Line 2']);
  });

  it('should use --resume flag when resume is true', async () => {
    const { spawn } = await import('node:child_process');
    const agent = new AgentProcess(defaultConfig({ resume: true }));
    agent.start();

    expect(spawn).toHaveBeenCalledWith('claude', expect.arrayContaining([
      '--resume', 'test-session-123',
    ]), expect.anything());
  });

  it('should emit activity events for tool_use blocks', () => {
    const agent = new AgentProcess(defaultConfig());
    const activities: Array<{ kind: string; tool?: string }> = [];
    agent.on('activity', (activity) => activities.push(activity));
    agent.start();

    sendStreamLine(mockProc, {
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          name: 'Read',
          input: { file_path: '/tmp/test.ts' },
        }],
      },
    });

    expect(activities).toHaveLength(1);
    expect(activities[0].kind).toBe('tool_use');
    expect(activities[0].tool).toBe('Read');
  });

  it('should expose pid from the subprocess', () => {
    const agent = new AgentProcess(defaultConfig());
    agent.start();
    expect(agent.pid).toBe(12345);
  });
});
