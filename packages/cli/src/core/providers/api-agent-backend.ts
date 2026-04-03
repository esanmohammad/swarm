/**
 * API Agent Backend
 *
 * Backend for API-based models with tool calling capability (Tier 2).
 * Uses the AgentLoop to run a full agent loop with tool execution against
 * any LLM provider that supports function calling (OpenAI, Anthropic API, etc.).
 */

import { EventEmitter } from 'node:events';
import type { AgentBackend, LLMProvider } from './types.js';

// AgentLoop is being created by another agent — import when available
// import { AgentLoop } from '../agent-loop.js';

export interface APIAgentConfig {
  provider: LLMProvider;
  model: string;
  cwd: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** If true, agent cannot modify files (read-only tools only) */
  readOnly?: boolean;
}

/**
 * Minimal AgentLoop interface — matches the contract being built by another agent.
 * Once agent-loop.ts lands, this can be replaced by the direct import.
 */
interface AgentLoopLike extends EventEmitter {
  run(userPrompt: string): Promise<string>;
  sendInput(text: string): Promise<string>;
  abort(): void;
}

/** Dynamic import helper — resolves AgentLoop at runtime */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadAgentLoop(): Promise<new (config: any) => AgentLoopLike> {
  try {
    const mod = await import('../agent-loop.js');
    return mod.AgentLoop;
  } catch (err) {
    throw new Error(
      `AgentLoop module not found. The API agent backend requires the agent-loop package. ` +
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export class APIAgentBackend extends EventEmitter implements AgentBackend {
  private loop: AgentLoopLike | null = null;
  private abortController: AbortController | null = null;
  private output = '';

  constructor(private config: APIAgentConfig) {
    super();
  }

  async start(prompt: string, systemPrompt: string): Promise<void> {
    const AgentLoop = await loadAgentLoop();

    this.abortController = new AbortController();

    this.loop = new AgentLoop({
      provider: this.config.provider,
      model: this.config.model,
      cwd: this.config.cwd,
      systemPrompt,
      maxTokens: this.config.maxTokens ?? 4096,
      temperature: this.config.temperature ?? 0,
      timeoutMs: this.config.timeoutMs ?? 10 * 60 * 1000,
      readOnly: this.config.readOnly ?? false,
      signal: this.abortController.signal,
    });

    // Wire AgentLoop events to backend events
    this.loop.on('text', (text: string) => {
      this.output += text;
      this.emit('output', text);
    });

    this.loop.on('activity', (activity: Record<string, unknown>) => {
      this.emit('activity', activity);
    });

    this.loop.on('tool_use', (toolUse: { name: string; input: Record<string, unknown> }) => {
      this.emit('activity', {
        type: 'tool_use',
        tool: toolUse.name,
        content: JSON.stringify(toolUse.input, null, 2),
      });
    });

    this.loop.on('tool_result', (result: { name: string; output: string }) => {
      this.emit('activity', {
        type: 'tool_result',
        content: result.output.slice(0, 2000),
      });
    });

    this.loop.on('thinking', (text: string) => {
      this.emit('activity', { type: 'thinking', content: text });
    });

    this.loop.on('cost', (cost: { inputTokens: number; outputTokens: number; totalCostUsd: number }) => {
      this.emit('cost', cost);
    });

    this.loop.on('error', (err: Error) => {
      this.emit('error', err);
    });

    // Run the loop in background — don't await so start() returns immediately
    this.runLoop(prompt).catch((err) => {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    });
  }

  private async runLoop(prompt: string): Promise<void> {
    if (!this.loop) return;

    try {
      const result = await this.loop.run(prompt);
      this.emit('done', {
        content: result || this.output,
        cost: 0, // Cost is emitted via 'cost' events during the loop
      });
    } catch (err) {
      if (this.abortController?.signal.aborted) {
        // Killed intentionally — not an error
        this.emit('done', {
          content: this.output,
          cost: 0,
        });
        return;
      }
      throw err;
    }
  }

  async sendInput(text: string): Promise<void> {
    if (!this.loop) {
      throw new Error('Agent loop not started. Call start() first.');
    }

    try {
      const result = await this.loop.sendInput(text);
      this.emit('done', {
        content: result || this.output,
        cost: 0,
      });
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  kill(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.loop) {
      this.loop.abort();
      this.loop.removeAllListeners();
      this.loop = null;
    }
  }
}
