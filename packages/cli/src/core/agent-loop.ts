/**
 * Agentic Tool-Calling Loop
 *
 * The core loop that gives API-based models (GPT-4o, Gemini, Llama, etc.)
 * the ability to iteratively call tools, inspect results, and converge on
 * a solution — just like Claude CLI does internally.
 *
 * Flow:
 *   1. Send messages + tool definitions to the LLM
 *   2. If the response includes tool calls, execute them
 *   3. Feed tool results back as tool messages
 *   4. Repeat until the model stops calling tools or max iterations reached
 */

import { EventEmitter } from 'node:events';
import type {
  LLMProvider,
  ChatMessage,
  StreamChunk,
  ToolDefinition,
  ToolCall,
} from './providers/types.js';
import { ToolExecutor, type ToolResult } from './tools/executor.js';
import { SWARM_TOOLS } from './tools/definitions.js';

// ── Config & Event Types ─────────────────────────────────────────────────

export interface AgentLoopConfig {
  provider: LLMProvider;
  model: string;
  systemPrompt: string;
  projectRoot: string;
  maxIterations?: number;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
  tools?: ToolDefinition[];
  readOnly?: boolean;
}

export interface AgentLoopEvents {
  text: (text: string) => void;
  'tool-call': (call: { name: string; args: Record<string, unknown> }) => void;
  'tool-result': (result: { name: string; success: boolean; output: string }) => void;
  thinking: (text: string) => void;
  cost: (cost: { inputTokens: number; outputTokens: number; totalCostUsd: number }) => void;
  done: (result: { content: string; totalCost: number; iterations: number }) => void;
  error: (error: Error) => void;
}

// ── AgentLoop ────────────────────────────────────────────────────────────

export class AgentLoop extends EventEmitter {
  private messages: ChatMessage[] = [];
  private executor: ToolExecutor;
  private aborted = false;
  private totalCost = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;

  private readonly maxIterations: number;
  private readonly tools: ToolDefinition[];
  private readonly config: AgentLoopConfig;

  constructor(config: AgentLoopConfig) {
    super();
    this.config = config;
    this.maxIterations = config.maxIterations ?? 50;
    this.tools = config.tools ?? SWARM_TOOLS;

    this.executor = new ToolExecutor({
      projectRoot: config.projectRoot,
      readOnly: config.readOnly,
    });
  }

  /**
   * Run the agentic loop with an initial user prompt.
   * Returns the final text content from the model.
   */
  async run(userPrompt: string): Promise<string> {
    this.aborted = false;

    // Initialize conversation
    this.messages = [
      { role: 'system', content: this.config.systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    return this.loop();
  }

  /**
   * Send follow-up input for multi-turn conversations.
   * Appends to the existing conversation history.
   */
  async sendInput(text: string): Promise<string> {
    this.aborted = false;
    this.messages.push({ role: 'user', content: text });
    return this.loop();
  }

  /** Abort the current loop */
  abort(): void {
    this.aborted = true;
  }

  /** Get the full conversation history */
  getHistory(): ChatMessage[] {
    return [...this.messages];
  }

  // ── Core Loop ──────────────────────────────────────────────────────────

  private async loop(): Promise<string> {
    let lastContent = '';

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      if (this.aborted) {
        this.emit('error', new Error('Agent loop aborted'));
        return lastContent;
      }

      // ── Call the LLM with streaming ──
      let assistantContent = '';
      const pendingToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
      let hasToolCalls = false;

      try {
        const stream = this.config.provider.streamWithTools(
          this.messages,
          this.tools,
          {
            model: this.config.model,
            maxTokens: this.config.maxTokens,
            temperature: this.config.temperature,
            timeout: this.config.timeout,
          },
        );

        let toolCallIndex = 0;

        for await (const chunk of stream) {
          if (this.aborted) break;

          switch (chunk.type) {
            case 'text':
              if (chunk.text) {
                assistantContent += chunk.text;
                this.emit('text', chunk.text);
              }
              break;

            case 'tool_call_start':
              if (chunk.toolCall) {
                const idx = toolCallIndex++;
                pendingToolCalls.set(idx, {
                  id: chunk.toolCall.id ?? `call_${idx}`,
                  name: chunk.toolCall.name ?? '',
                  arguments: chunk.toolCall.arguments ?? '',
                });
                hasToolCalls = true;
              }
              break;

            case 'tool_call_delta':
              if (chunk.toolCall) {
                // Find the most recent tool call to append arguments to
                const current = pendingToolCalls.get(toolCallIndex - 1);
                if (current && chunk.toolCall.arguments) {
                  current.arguments += chunk.toolCall.arguments;
                }
              }
              break;

            case 'tool_call_end':
              // Tool call is complete, no action needed — it's already accumulated
              break;

            case 'thinking':
              if (chunk.thinking) {
                this.emit('thinking', chunk.thinking);
              }
              break;

            case 'usage':
              if (chunk.usage) {
                this.totalInputTokens += chunk.usage.inputTokens;
                this.totalOutputTokens += chunk.usage.outputTokens;
                // Estimate cost (will be refined by provider-specific pricing)
                this.emit('cost', {
                  inputTokens: this.totalInputTokens,
                  outputTokens: this.totalOutputTokens,
                  totalCostUsd: this.totalCost,
                });
              }
              break;

            case 'error':
              this.emit('error', new Error(chunk.error ?? 'Unknown streaming error'));
              break;

            case 'done':
              // Stream finished
              break;
          }
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.emit('error', error);
        return lastContent;
      }

      // ── Build the assistant message ──
      const toolCalls: ToolCall[] = [];
      for (const [, tc] of pendingToolCalls) {
        toolCalls.push({ id: tc.id, name: tc.name, arguments: tc.arguments });
      }

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: assistantContent,
      };
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls;
      }
      this.messages.push(assistantMsg);

      lastContent = assistantContent;

      // ── If no tool calls, we're done ──
      if (!hasToolCalls || toolCalls.length === 0) {
        this.emit('done', {
          content: assistantContent,
          totalCost: this.totalCost,
          iterations: iteration + 1,
        });
        return assistantContent;
      }

      // ── Execute tool calls and feed results back ──
      for (const tc of toolCalls) {
        if (this.aborted) break;

        let parsedArgs: Record<string, unknown>;
        try {
          parsedArgs = tc.arguments ? JSON.parse(tc.arguments) : {};
        } catch {
          parsedArgs = {};
          // Send parse error back to the model so it can fix its JSON
          const parseError: ToolResult = {
            success: false,
            output: '',
            error: `Failed to parse tool arguments as JSON: ${tc.arguments}`,
          };
          this.emit('tool-call', { name: tc.name, args: {} });
          this.emit('tool-result', { name: tc.name, success: false, output: parseError.error! });
          this.messages.push({
            role: 'tool',
            content: JSON.stringify(parseError),
            tool_call_id: tc.id,
          });
          continue;
        }

        this.emit('tool-call', { name: tc.name, args: parsedArgs });

        const result = await this.executor.execute(tc.name, parsedArgs);

        this.emit('tool-result', {
          name: tc.name,
          success: result.success,
          output: result.error ?? result.output,
        });

        // Add tool result message
        this.messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          tool_call_id: tc.id,
        });
      }
    }

    // Max iterations reached
    const warning = `[Agent loop reached maximum iterations (${this.maxIterations}). Returning last response.]`;
    this.emit('done', {
      content: lastContent + '\n' + warning,
      totalCost: this.totalCost,
      iterations: this.maxIterations,
    });
    return lastContent + '\n' + warning;
  }
}
