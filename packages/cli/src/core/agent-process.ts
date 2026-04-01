import { spawn, ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import type { ClaudeStreamMessage, CostInfo, AgentActivity } from '../types.js';

export interface AgentProcessConfig {
  prompt: string;
  systemPrompt?: string;
  /** Appended to the default system prompt via --append-system-prompt (harder to override) */
  appendSystemPrompt?: string;
  model: string;
  sessionId: string;
  maxBudgetUsd?: number | null;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: string;
  cwd: string;
  /** Resume an existing session instead of starting a new one */
  resume?: boolean;
  /** Run in interactive mode — user can converse with the agent via terminal.
   *  stdio is inherited, no stream-json parsing. Used for analyst. */
  interactive?: boolean;
  /** Timeout in ms — if no output received for this duration, kill the agent. Default: 30 min */
  timeoutMs?: number;
}

export interface SubAgentInfo {
  toolUseId: string;
  description: string;
  prompt: string;
}

export interface AgentProcessEvents {
  content: (text: string) => void;
  result: (data: { result: string; cost: CostInfo; sessionId: string }) => void;
  'error-output': (text: string) => void;
  exit: (code: number | null) => void;
  message: (msg: ClaudeStreamMessage) => void;
  activity: (activity: Omit<AgentActivity, 'agentId'>) => void;
  'sub-agent-start': (info: SubAgentInfo) => void;
  'sub-agent-end': (info: { toolUseId: string; result: string }) => void;
}

export class AgentProcess extends EventEmitter {
  private proc: ChildProcess | null = null;
  private buffer = '';
  private config: AgentProcessConfig;
  private tempFiles: string[] = [];
  /** Track pending Agent tool_use IDs to correlate with tool_result */
  private pendingSubAgents = new Map<string, SubAgentInfo>();
  /** Watchdog timer — kills agent if no output for timeoutMs */
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private _timedOut = false;

  constructor(config: AgentProcessConfig) {
    super();
    this.config = config;
  }

  /** Whether this agent was killed due to inactivity timeout */
  get timedOut(): boolean {
    return this._timedOut;
  }

  override on<K extends keyof AgentProcessEvents>(event: K, listener: AgentProcessEvents[K]): this {
    return super.on(event, listener);
  }

  override emit<K extends keyof AgentProcessEvents>(event: K, ...args: Parameters<AgentProcessEvents[K]>): boolean {
    return super.emit(event, ...args);
  }

  start(): void {
    if (this.config.interactive) {
      this.startInteractive();
    } else {
      this.startNonInteractive();
    }
  }

  /**
   * Interactive mode (two-step):
   * 1. Send the initial prompt via `-p` (print mode) to bootstrap the session
   *    with the system prompt and get the first response.
   * 2. Resume that session with `--resume <session-id>` in interactive mode
   *    (stdio inherited) so the user can converse with the agent.
   */
  private startInteractive(): void {
    // Step 1: Bootstrap session with -p (non-interactive first turn)
    const bootstrapArgs = this.buildNonInteractiveArgs();

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
          const msg: ClaudeStreamMessage = JSON.parse(line);
          if (msg.type === 'assistant' && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === 'text' && block.text) {
                bootstrapOutput += block.text;
              }
            }
          }
        } catch { /* skip */ }
      }
    });

    bootstrap.stderr?.on('data', (data: Buffer) => {
      // Show stderr (e.g. permission prompts) to user
      process.stderr.write(data);
    });

    bootstrap.on('exit', (code) => {
      if (code !== 0) {
        this.emit('error-output', `Bootstrap exited with code ${code}`);
        this.emit('exit', code);
        return;
      }

      // Print the first response
      if (bootstrapOutput) {
        console.log('\n' + bootstrapOutput);
      }

      // Step 2: Resume the session interactively — carry over tool restrictions
      const resumeArgs = [
        '--resume', this.config.sessionId,
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

      this.proc = spawn('claude', resumeArgs, {
        cwd: this.config.cwd,
        stdio: 'inherit',
        env: { ...process.env },
      });

      this.proc.on('error', (err) => this.emit('error-output', err.message));
      this.proc.on('exit', (resumeCode) => {
        this.cleanupTempFiles();
        this.emit('exit', resumeCode);
        this.emit('result', {
          result: bootstrapOutput,
          cost: { totalUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 0 },
          sessionId: this.config.sessionId,
        });
      });
    });
  }

  /**
   * Non-interactive (print) mode: captures stream-json output for
   * programmatic tracking. Used for architect, lead, engineer.
   */
  private startNonInteractive(): void {
    const args = this.buildNonInteractiveArgs();

    this.proc = spawn('claude', args, {
      cwd: this.config.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    this.proc.stdin?.end();

    this.proc.stdout?.on('data', (data: Buffer) => {
      this.resetWatchdog();
      this.parseStreamJson(data);
    });
    this.proc.stderr?.on('data', (data: Buffer) => {
      this.resetWatchdog();
      this.emit('error-output', data.toString());
    });
    this.proc.on('error', (err) => this.emit('error-output', err.message));
    this.proc.on('exit', (code) => {
      this.stopWatchdog();
      this.cleanupTempFiles();
      this.emit('exit', code);
    });

    // Start the watchdog
    this.resetWatchdog();
  }

  kill(): void {
    this.stopWatchdog();
    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGTERM');
      setTimeout(() => {
        if (this.proc && !this.proc.killed) {
          this.proc.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  /** Start or reset the inactivity watchdog timer */
  private resetWatchdog(): void {
    const timeout = this.config.timeoutMs ?? 30 * 60 * 1000; // default 30 min
    if (timeout <= 0) return; // disabled
    this.stopWatchdog();
    this.watchdogTimer = setTimeout(() => {
      this._timedOut = true;
      this.emit('error-output', `Agent timed out after ${Math.round(timeout / 60000)}m of inactivity`);
      this.kill();
    }, timeout);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  get pid(): number | undefined {
    return this.proc?.pid;
  }

  get killed(): boolean {
    return this.proc?.killed ?? false;
  }

  private writeTempFile(prefix: string, content: string): string {
    const dir = join(tmpdir(), 'swarm-prompts');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${prefix}-${this.config.sessionId}.md`);
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

  private buildCommonArgs(): string[] {
    const args: string[] = [
      '--model', this.config.model,
    ];

    if (this.config.resume) {
      // Resume an existing session — don't set session-id or system-prompt
      args.push('--resume', this.config.sessionId);
    } else {
      args.push('--session-id', this.config.sessionId);
      if (this.config.systemPrompt) {
        args.push('--system-prompt', this.config.systemPrompt);
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
  private buildNonInteractiveArgs(): string[] {
    const args = [
      '-p', this.config.prompt,
      '--output-format', 'stream-json',
      '--verbose',
      ...this.buildCommonArgs(),
    ];
    return args;
  }

  private activityCounter = 0;

  private nextActivityId(): string {
    return `act-${this.config.sessionId.slice(0, 8)}-${++this.activityCounter}`;
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

      let msg: ClaudeStreamMessage;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        continue;
      }

      this.emit('message', msg);

      if (msg.type === 'result') {
        // Flush any pending sub-agents — parent is done, so all sub-agents must be done
        for (const [toolUseId] of this.pendingSubAgents) {
          this.emit('sub-agent-end', {
            toolUseId,
            result: 'Completed (parent process finished)',
          });
        }
        this.pendingSubAgents.clear();

        const cost: CostInfo = {
          totalUsd: msg.total_cost_usd ?? 0,
          inputTokens: msg.usage?.input_tokens ?? 0,
          outputTokens: msg.usage?.output_tokens ?? 0,
          cacheReadTokens: msg.usage?.cache_read_input_tokens ?? 0,
          cacheWriteTokens: msg.usage?.cache_creation_input_tokens ?? 0,
          durationMs: msg.duration_ms ?? 0,
        };
        this.emit('result', {
          result: msg.result ?? '',
          cost,
          sessionId: msg.session_id ?? this.config.sessionId,
        });
      } else if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            this.emit('content', block.text);
            // Also emit as text activity for the feed
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

            // Track Agent tool_use for sub-agent visibility
            if (block.name === 'Agent' && block.id) {
              const info: SubAgentInfo = {
                toolUseId: block.id,
                description: String(input.description ?? 'sub-agent'),
                prompt: String(input.prompt ?? '').slice(0, 500),
              };
              this.pendingSubAgents.set(block.id, info);
              this.emit('sub-agent-start', info);
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
            // tool_result as content block inside assistant message
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
              this.emit('sub-agent-end', {
                toolUseId,
                result: resultText.slice(0, 2000),
              });
            }
          }
        }
      } else if (msg.type === 'tool_result') {
        // Tool result — extract text content
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
          this.emit('sub-agent-end', {
            toolUseId: msg.tool_use_id,
            result: resultText.slice(0, 2000),
          });
        }
      }
    }
  }
}
