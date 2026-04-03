/**
 * Claude CLI Backend
 *
 * Extracted from agent-process.ts — wraps the `claude` CLI binary as an
 * AgentBackend. Supports interactive (two-step bootstrap+resume) and
 * non-interactive (stream-json) modes, watchdog timers, and sub-agent tracking.
 */

import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentBackend } from './types.js';

/** Information about a sub-agent spawned via the Agent tool */
export interface SubAgentInfo {
  toolUseId: string;
  description: string;
  prompt: string;
}

export interface ClaudeCLIConfig {
  model: string;
  sessionId: string;
  cwd: string;
  interactive?: boolean;
  resume?: boolean;
  maxBudgetUsd?: number | null;
  permissionMode?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  appendSystemPrompt?: string;
  /** Timeout in ms — if no output received for this duration, kill the agent. Default: 10 min */
  timeoutMs?: number;
}

/**
 * Stream-json message shape from the Claude CLI.
 * Subset of fields we actually use — the full type lives in types.ts.
 */
interface StreamMessage {
  type: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      tool_use_id?: string;
    }>;
  };
  result?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  duration_ms?: number;
  session_id?: string;
  content?: string | Array<{ type: string; text?: string }>;
  tool_use_id?: string;
}

export class ClaudeCLIBackend extends EventEmitter implements AgentBackend {
  private process: ChildProcess | null = null;
  private sessionId: string;
  private buffer = '';
  private output = '';
  private watchdog: NodeJS.Timeout | null = null;
  private _timedOut = false;
  private tempFiles: string[] = [];
  private activityCounter = 0;

  /** Track pending Agent tool_use IDs to correlate with tool_result */
  private pendingSubAgents = new Map<string, SubAgentInfo>();

  constructor(private config: ClaudeCLIConfig) {
    super();
    this.sessionId = config.sessionId;
  }

  /** Whether this agent was killed due to inactivity timeout */
  get timedOut(): boolean {
    return this._timedOut;
  }

  get pid(): number | undefined {
    return this.process?.pid;
  }

  get killed(): boolean {
    return this.process?.killed ?? false;
  }

  // ---------------------------------------------------------------------------
  // AgentBackend interface
  // ---------------------------------------------------------------------------

  async start(prompt: string, systemPrompt: string): Promise<void> {
    if (this.config.interactive) {
      this.startInteractive(prompt, systemPrompt);
    } else {
      this.startNonInteractive(prompt, systemPrompt);
    }
  }

  async sendInput(text: string): Promise<void> {
    // For Claude CLI, "send input" means spawning a new process that resumes
    // the session with the new prompt. The caller (AgentManager) already
    // handles this via a new AgentProcess, but we support it here for the
    // backend interface.
    const args = [
      '-p', text,
      '--output-format', 'stream-json',
      '--verbose',
      '--resume', this.sessionId,
    ];

    if (this.config.model) {
      args.push('--model', this.config.model);
    }
    if (this.config.permissionMode) {
      args.push('--permission-mode', this.config.permissionMode);
    }
    if (this.config.appendSystemPrompt) {
      args.push('--append-system-prompt', this.config.appendSystemPrompt);
    }

    this.process = spawn('claude', args, {
      cwd: this.config.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    this.process.stdin?.end();
    this.buffer = '';

    this.process.stdout?.on('data', (data: Buffer) => {
      this.resetWatchdog();
      this.parseStreamJson(data);
    });
    this.process.stderr?.on('data', (data: Buffer) => {
      this.resetWatchdog();
      this.emit('error', new Error(data.toString()));
    });
    this.process.on('error', (err) => this.emit('error', err));
    this.process.on('exit', (code) => {
      this.stopWatchdog();
      if (code !== 0 && code !== null) {
        this.emit('error', new Error(`Claude CLI exited with code ${code}`));
      }
    });

    this.resetWatchdog();
  }

  kill(): void {
    this.stopWatchdog();
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  // ---------------------------------------------------------------------------
  // Interactive mode (two-step)
  // ---------------------------------------------------------------------------

  /**
   * Interactive mode:
   * 1. Send the initial prompt via `-p` (print mode) to bootstrap the session
   *    with the system prompt and get the first response.
   * 2. Resume that session with `--resume <session-id>` in interactive mode
   *    (stdio inherited) so the user can converse with the agent.
   */
  private startInteractive(prompt: string, systemPrompt: string): void {
    const bootstrapArgs = this.buildNonInteractiveArgs(prompt, systemPrompt);

    const bootstrap = spawn('claude', bootstrapArgs, {
      cwd: this.config.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    bootstrap.stdin?.end();

    // Collect and display the first response so user sees it
    let bootstrapOutput = '';
    bootstrap.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg: StreamMessage = JSON.parse(line);
          if (msg.type === 'assistant' && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === 'text' && block.text) {
                bootstrapOutput += block.text;
              }
            }
          }
        } catch { /* skip non-JSON lines */ }
      }
    });

    bootstrap.stderr?.on('data', (data: Buffer) => {
      // Show stderr (e.g. permission prompts) to user
      process.stderr.write(data);
    });

    bootstrap.on('exit', (code) => {
      if (code !== 0) {
        this.emit('error', new Error(`Bootstrap exited with code ${code}`));
        return;
      }

      // Emit the first response as output
      if (bootstrapOutput) {
        this.output += bootstrapOutput;
        this.emit('output', bootstrapOutput);
        console.log('\n' + bootstrapOutput);
      }

      // Step 2: Resume the session interactively
      const resumeArgs = [
        '--resume', this.sessionId,
      ];
      if (this.config.disallowedTools?.length) {
        resumeArgs.push('--disallowedTools', this.config.disallowedTools.join(','));
      }
      if (this.config.allowedTools?.length) {
        resumeArgs.push('--allowedTools', this.config.allowedTools.join(','));
      }
      if (this.config.permissionMode) {
        resumeArgs.push('--permission-mode', this.config.permissionMode);
      }
      if (this.config.appendSystemPrompt) {
        resumeArgs.push('--append-system-prompt', this.config.appendSystemPrompt);
      }

      this.process = spawn('claude', resumeArgs, {
        cwd: this.config.cwd,
        stdio: 'inherit',
        env: { ...process.env },
      });

      this.process.on('error', (err) => this.emit('error', err));
      this.process.on('exit', (resumeCode) => {
        this.cleanupTempFiles();
        this.emit('done', {
          content: bootstrapOutput,
          cost: 0,
          sessionId: this.sessionId,
        });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Non-interactive (print) mode
  // ---------------------------------------------------------------------------

  /**
   * Non-interactive (print) mode: captures stream-json output for
   * programmatic tracking. Used for architect, lead, engineer.
   */
  private startNonInteractive(prompt: string, systemPrompt: string): void {
    const args = this.buildNonInteractiveArgs(prompt, systemPrompt);

    this.process = spawn('claude', args, {
      cwd: this.config.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    this.process.stdin?.end();

    this.process.stdout?.on('data', (data: Buffer) => {
      this.resetWatchdog();
      this.parseStreamJson(data);
    });
    this.process.stderr?.on('data', (data: Buffer) => {
      this.resetWatchdog();
      this.emit('error', new Error(data.toString()));
    });
    this.process.on('error', (err) => this.emit('error', err));
    this.process.on('exit', (code) => {
      this.stopWatchdog();
      this.cleanupTempFiles();
      if (code !== 0 && code !== null) {
        this.emit('error', new Error(`Claude CLI exited with code ${code}`));
      }
    });

    // Start the watchdog
    this.resetWatchdog();
  }

  // ---------------------------------------------------------------------------
  // Arg builders
  // ---------------------------------------------------------------------------

  private buildCommonArgs(systemPrompt: string): string[] {
    const args: string[] = [
      '--model', this.config.model,
    ];

    if (this.config.resume) {
      // Resume an existing session -- don't set session-id or system-prompt
      args.push('--resume', this.sessionId);
    } else {
      args.push('--session-id', this.sessionId);
      if (systemPrompt) {
        args.push('--system-prompt', systemPrompt);
      }
    }
    if (this.config.maxBudgetUsd != null && this.config.maxBudgetUsd > 0) {
      args.push('--max-budget-usd', String(this.config.maxBudgetUsd));
    }
    if (this.config.permissionMode) {
      args.push('--permission-mode', this.config.permissionMode);
    }
    if (this.config.appendSystemPrompt) {
      args.push('--append-system-prompt', this.config.appendSystemPrompt);
    }
    if (this.config.allowedTools?.length) {
      args.push('--allowedTools', ...this.config.allowedTools);
    }
    if (this.config.disallowedTools?.length) {
      args.push('--disallowedTools', ...this.config.disallowedTools);
    }

    return args;
  }

  /**
   * Non-interactive (print) mode args: -p for single-shot, stream-json output.
   */
  private buildNonInteractiveArgs(prompt: string, systemPrompt: string): string[] {
    return [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      ...this.buildCommonArgs(systemPrompt),
    ];
  }

  // ---------------------------------------------------------------------------
  // Stream-json parser
  // ---------------------------------------------------------------------------

  private nextActivityId(): string {
    return `act-${this.sessionId.slice(0, 8)}-${++this.activityCounter}`;
  }

  /** Summarize a tool_use block for the activity feed */
  private summarizeToolUse(name: string, input: Record<string, unknown>): string {
    switch (name) {
      case 'Read':
        return `Reading ${input.file_path ?? 'file'}`;
      case 'Edit':
        return `Editing ${input.file_path ?? 'file'}`;
      case 'Write':
        return `Writing ${input.file_path ?? 'file'}`;
      case 'Bash':
        return `Running: ${String(input.command ?? input.description ?? '').slice(0, 120)}`;
      case 'Grep':
        return `Searching for "${String(input.pattern ?? '').slice(0, 60)}"${input.path ? ` in ${input.path}` : ''}`;
      case 'Glob':
        return `Finding files: ${input.pattern ?? ''}`;
      case 'Agent':
        return `Spawning sub-agent: ${input.description ?? ''}`;
      case 'WebSearch':
        return `Searching web: ${input.query ?? ''}`;
      case 'WebFetch':
        return `Fetching: ${input.url ?? ''}`;
      default:
        return `Using ${name}`;
    }
  }

  private parseStreamJson(data: Buffer): void {
    this.buffer += data.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let msg: StreamMessage;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        continue;
      }

      if (msg.type === 'result') {
        // Flush any pending sub-agents
        for (const [toolUseId] of this.pendingSubAgents) {
          this.emit('activity', {
            id: this.nextActivityId(),
            kind: 'sub_agent_end',
            summary: `Sub-agent completed (parent finished)`,
            timestamp: Date.now(),
          });
        }
        this.pendingSubAgents.clear();

        const totalCost = msg.total_cost_usd ?? 0;
        this.emit('cost', {
          inputTokens: msg.usage?.input_tokens ?? 0,
          outputTokens: msg.usage?.output_tokens ?? 0,
          totalCostUsd: totalCost,
          cacheReadTokens: msg.usage?.cache_read_input_tokens ?? 0,
          cacheWriteTokens: msg.usage?.cache_creation_input_tokens ?? 0,
        });
        this.emit('done', {
          content: msg.result ?? this.output,
          cost: totalCost,
          sessionId: msg.session_id ?? this.sessionId,
        });
      } else if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            this.output += block.text;
            this.emit('output', block.text);
            this.emit('activity', {
              id: this.nextActivityId(),
              kind: 'text',
              summary: block.text.slice(0, 200),
              content: block.text,
              timestamp: Date.now(),
            });
          } else if (block.type === 'tool_use' && block.name) {
            const input = block.input ?? {};
            this.emit('activity', {
              id: this.nextActivityId(),
              kind: 'tool_use',
              tool: block.name,
              summary: this.summarizeToolUse(block.name, input),
              content: JSON.stringify(input, null, 2),
              timestamp: Date.now(),
            });

            // Extend watchdog for long-running tools (Bash commands like tests/builds)
            if (block.name === 'Bash') {
              this.resetWatchdogExtended(60 * 60 * 1000); // 60 min for bash commands
            }

            // Track Agent tool_use for sub-agent visibility
            if (block.name === 'Agent' && block.id) {
              const info: SubAgentInfo = {
                toolUseId: block.id,
                description: String(input.description ?? 'sub-agent'),
                prompt: String(input.prompt ?? '').slice(0, 500),
              };
              this.pendingSubAgents.set(block.id, info);
            }
          } else if (block.type === 'thinking' && block.text) {
            this.emit('activity', {
              id: this.nextActivityId(),
              kind: 'thinking',
              summary: block.text.slice(0, 200),
              content: block.text,
              timestamp: Date.now(),
            });
          } else if (block.type === 'tool_result') {
            const resultText = block.text ?? '';
            const toolUseId = (block as Record<string, unknown>).tool_use_id as string | undefined;
            if (resultText) {
              this.emit('activity', {
                id: this.nextActivityId(),
                kind: 'tool_result',
                summary: resultText.slice(0, 200),
                content: resultText.length > 200 ? resultText : undefined,
                timestamp: Date.now(),
              });
            }
            // Check if this is a sub-agent completion
            if (toolUseId && this.pendingSubAgents.has(toolUseId)) {
              this.pendingSubAgents.delete(toolUseId);
            }
          }
        }
      } else if (msg.type === 'tool_result') {
        // Top-level tool result message
        let resultText = '';
        if (typeof msg.content === 'string') {
          resultText = msg.content;
        } else if (Array.isArray(msg.content)) {
          resultText = msg.content
            .filter((b) => b.type === 'text' && b.text)
            .map((b) => b.text!)
            .join('\n');
        }
        if (resultText) {
          this.emit('activity', {
            id: this.nextActivityId(),
            kind: 'tool_result',
            summary: resultText.slice(0, 200),
            content: resultText.length > 200 ? resultText : undefined,
            timestamp: Date.now(),
          });
        }

        // Check if this is a sub-agent completion
        if (msg.tool_use_id && this.pendingSubAgents.has(msg.tool_use_id)) {
          this.pendingSubAgents.delete(msg.tool_use_id);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Watchdog
  // ---------------------------------------------------------------------------

  /** Start or reset the inactivity watchdog timer */
  private resetWatchdog(): void {
    const baseTimeout = this.config.timeoutMs ?? 10 * 60 * 1000; // default 10 min
    if (baseTimeout <= 0) return; // disabled
    this.stopWatchdog();
    this.watchdog = setTimeout(() => {
      this._timedOut = true;
      this.emit('error', new Error(
        `Agent timed out after ${Math.round(baseTimeout / 60000)}m of inactivity. ` +
        `Use 'hivemind mayday --resume' to continue, or increase timeout in .swarm/config.yaml.`
      ));
      this.kill();
    }, baseTimeout);
  }

  /** Reset watchdog with extended timeout (for long-running operations like tests) */
  resetWatchdogExtended(durationMs: number): void {
    if ((this.config.timeoutMs ?? 10 * 60 * 1000) <= 0) return;
    this.stopWatchdog();
    this.watchdog = setTimeout(() => {
      this._timedOut = true;
      this.emit('error', new Error(
        `Agent timed out after ${Math.round(durationMs / 60000)}m. ` +
        `Use 'hivemind mayday --resume' to continue.`
      ));
      this.kill();
    }, durationMs);
  }

  private stopWatchdog(): void {
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Temp file helpers
  // ---------------------------------------------------------------------------

  private writeTempFile(prefix: string, content: string): string {
    const dir = join(tmpdir(), 'swarm-prompts');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${prefix}-${this.sessionId}.md`);
    writeFileSync(filePath, content, 'utf-8');
    this.tempFiles.push(filePath);
    return filePath;
  }

  private cleanupTempFiles(): void {
    for (const f of this.tempFiles) {
      try { unlinkSync(f); } catch { /* ignore */ }
    }
    this.tempFiles = [];
  }
}
