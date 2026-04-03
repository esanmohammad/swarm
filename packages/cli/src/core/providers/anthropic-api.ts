/**
 * Anthropic Native API Provider — Wave 8
 *
 * Direct integration with the Anthropic Messages API for using Claude models
 * via API key rather than the Claude CLI.
 */

import type {
  LLMProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ToolCall,
  ToolDefinition,
  TokenUsage,
  StreamChunk,
  ModelInfo,
  ProviderConfig,
  CapabilityTier,
} from './types.js';

// ─── Anthropic API Types (internal) ─────────────────────────────────────────

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | AnthropicContentBlock[];
  thinking?: string;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// ─── SSE Parser ──────────────────────────────────────────────────────────────

async function* parseAnthropicSSE(
  response: Response,
  signal?: AbortSignal,
): AsyncIterable<{ event: string; data: Record<string, unknown> }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';

      for (const chunk of chunks) {
        const lines = chunk.split('\n');
        let event = '';
        let data = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            event = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            data = line.slice(6);
          }
        }

        if (event && data) {
          try {
            yield { event, data: JSON.parse(data) };
          } catch {
            // skip malformed
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Message Format Conversion ───────────────────────────────────────────────

function getContentText(msg: ChatMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  return msg.content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!)
    .join('');
}

function toAnthropicMessages(
  messages: ChatMessage[],
): { system?: string; messages: AnthropicMessage[] } {
  let system: string | undefined;
  const anthropicMessages: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = getContentText(msg);
      continue;
    }

    if (msg.role === 'assistant') {
      const content: AnthropicContentBlock[] = [];

      // Add text content
      const text = getContentText(msg);
      if (text) {
        content.push({ type: 'text', text });
      }

      // Convert tool_calls to tool_use blocks
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let parsedInput: Record<string, unknown> = {};
          try {
            parsedInput = JSON.parse(tc.arguments);
          } catch {
            // keep empty
          }
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: parsedInput,
          });
        }
      }

      anthropicMessages.push({
        role: 'assistant',
        content: content.length === 1 && content[0].type === 'text'
          ? content[0].text!
          : content,
      });
      continue;
    }

    if (msg.role === 'tool') {
      // Tool results go into a user message with tool_result content blocks.
      // Check if we can merge with the previous user message.
      const block: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id,
        content: getContentText(msg),
      };

      const last = anthropicMessages[anthropicMessages.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        (last.content as AnthropicContentBlock[]).push(block);
      } else {
        anthropicMessages.push({ role: 'user', content: [block] });
      }
      continue;
    }

    // User message
    anthropicMessages.push({ role: 'user', content: getContentText(msg) });
  }

  // Anthropic requires alternating user/assistant. Merge consecutive same-role.
  const merged: AnthropicMessage[] = [];
  for (const m of anthropicMessages) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) {
      // Merge content
      const prevBlocks = toBlockArray(prev.content);
      const curBlocks = toBlockArray(m.content);
      prev.content = [...prevBlocks, ...curBlocks];
    } else {
      merged.push(m);
    }
  }

  return { system, messages: merged };
}

function toBlockArray(
  content: string | AnthropicContentBlock[],
): AnthropicContentBlock[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  return content;
}

function toAnthropicTools(tools: ToolDefinition[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class AnthropicAPIProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly type = 'api' as const;

  private baseUrl: string;
  private apiKey: string;
  private apiVersion: string;
  private defaultModel: string;
  private timeout: number;
  private extraHeaders: Record<string, string>;

  constructor(config: ProviderConfig) {
    this.baseUrl = (config.baseUrl || 'https://api.anthropic.com/v1').replace(
      /\/$/,
      '',
    );
    this.apiKey = config.apiKey || '';
    this.apiVersion = config.apiVersion || '2023-06-01';
    this.defaultModel = 'claude-sonnet-4-20250514';
    this.timeout = 120_000;
    this.extraHeaders = config.headers || {};
  }

  // ── Internal fetch ─────────────────────────────────────────────────────

  private buildHeaders(streaming = false): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': this.apiVersion,
      ...this.extraHeaders,
    };
    if (streaming) {
      headers['Accept'] = 'text/event-stream';
    }
    return headers;
  }

  private async fetchJSON(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), {
        once: true,
      });
    }

    try {
      const resp = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        this.throwHTTPError(resp.status, text);
      }

      return (await resp.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async fetchStream(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), {
        once: true,
      });
    }

    const resp = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this.buildHeaders(true),
      body: JSON.stringify({ ...body, stream: true }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      this.throwHTTPError(resp.status, text);
    }

    return resp;
  }

  private throwHTTPError(status: number, body: string): never {
    switch (status) {
      case 401:
        throw new Error(
          '[anthropic] Authentication failed (401). Check your API key.',
        );
      case 403:
        throw new Error(
          '[anthropic] Access forbidden (403). Check permissions.',
        );
      case 429:
        throw new Error(
          '[anthropic] Rate limited (429). Slow down or upgrade your plan.',
        );
      case 500:
      case 502:
      case 503:
        throw new Error(
          `[anthropic] Server error (${status}). Try again later. ${body}`,
        );
      case 529:
        throw new Error(
          '[anthropic] API overloaded (529). Try again later.',
        );
      default:
        throw new Error(
          `[anthropic] HTTP ${status}: ${body.slice(0, 500)}`,
        );
    }
  }

  // ── LLMProvider implementation ─────────────────────────────────────────

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<ChatResponse> {
    const model = options?.model || this.defaultModel;
    const { system, messages: anthropicMsgs } = toAnthropicMessages(messages);

    const body: Record<string, unknown> = {
      model,
      messages: anthropicMsgs,
      max_tokens: options?.maxTokens || 4096,
    };

    if (system || options?.systemPrompt) {
      body.system = options?.systemPrompt || system;
    }
    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }
    if (options?.thinking) {
      body.thinking = {
        type: 'enabled',
        budget_tokens: Math.min(options.maxTokens || 4096, 10000),
      };
    }

    const data = await this.fetchJSON(body, options?.signal);
    return this.parseResponse(data, model);
  }

  async *stream(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncIterable<StreamChunk> {
    yield* this.streamInternal(messages, undefined, options);
  }

  async *streamWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    options?: ChatOptions,
  ): AsyncIterable<StreamChunk> {
    yield* this.streamInternal(messages, tools, options);
  }

  private async *streamInternal(
    messages: ChatMessage[],
    tools: ToolDefinition[] | undefined,
    options?: ChatOptions,
  ): AsyncIterable<StreamChunk> {
    const model = options?.model || this.defaultModel;
    const { system, messages: anthropicMsgs } = toAnthropicMessages(messages);

    const body: Record<string, unknown> = {
      model,
      messages: anthropicMsgs,
      max_tokens: options?.maxTokens || 4096,
    };

    if (system || options?.systemPrompt) {
      body.system = options?.systemPrompt || system;
    }
    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }
    if (tools && tools.length > 0) {
      body.tools = toAnthropicTools(tools);
    }
    if (options?.thinking) {
      body.thinking = {
        type: 'enabled',
        budget_tokens: Math.min(options.maxTokens || 4096, 10000),
      };
    }

    const response = await this.fetchStream(body, options?.signal);

    // Track current content block for tool calls
    let currentBlockType: string | null = null;
    let currentToolId = '';
    let currentToolName = '';
    let currentToolArgs = '';
    let inputUsage: TokenUsage | null = null;

    for await (const { event, data } of parseAnthropicSSE(
      response,
      options?.signal,
    )) {
      switch (event) {
        case 'message_start': {
          const msg = data.message as Record<string, unknown> | undefined;
          if (msg?.usage) {
            const u = msg.usage as Record<string, number>;
            inputUsage = {
              inputTokens: u.input_tokens || 0,
              outputTokens: 0,
              cacheReadTokens: u.cache_read_input_tokens,
              cacheWriteTokens: u.cache_creation_input_tokens,
              totalTokens: u.input_tokens || 0,
            };
          }
          break;
        }

        case 'content_block_start': {
          const block = data.content_block as Record<string, unknown>;
          currentBlockType = block.type as string;

          if (currentBlockType === 'tool_use') {
            currentToolId = (block.id as string) || '';
            currentToolName = (block.name as string) || '';
            currentToolArgs = '';
            yield {
              type: 'tool_call_start',
              toolCall: { id: currentToolId, name: currentToolName },
            };
          }
          break;
        }

        case 'content_block_delta': {
          const delta = data.delta as Record<string, unknown>;
          const deltaType = delta.type as string;

          if (deltaType === 'text_delta') {
            yield { type: 'text', text: delta.text as string };
          } else if (deltaType === 'input_json_delta') {
            const partial = delta.partial_json as string;
            if (partial) {
              currentToolArgs += partial;
              yield {
                type: 'tool_call_delta',
                toolCall: { id: currentToolId, arguments: partial },
              };
            }
          } else if (deltaType === 'thinking_delta') {
            yield { type: 'thinking', thinking: delta.thinking as string };
          }
          break;
        }

        case 'content_block_stop': {
          if (currentBlockType === 'tool_use') {
            yield {
              type: 'tool_call_end',
              toolCall: {
                id: currentToolId,
                name: currentToolName,
                arguments: currentToolArgs,
              },
            };
          }
          currentBlockType = null;
          break;
        }

        case 'message_delta': {
          const delta = data.delta as Record<string, unknown> | undefined;
          const usage = data.usage as Record<string, number> | undefined;

          if (usage) {
            const outputTokens = usage.output_tokens || 0;
            yield {
              type: 'usage',
              usage: {
                inputTokens: inputUsage?.inputTokens || 0,
                outputTokens,
                cacheReadTokens: inputUsage?.cacheReadTokens,
                cacheWriteTokens: inputUsage?.cacheWriteTokens,
                totalTokens: (inputUsage?.inputTokens || 0) + outputTokens,
              },
            };
          }
          break;
        }

        case 'message_stop': {
          yield { type: 'done' };
          break;
        }

        case 'error': {
          const err = data.error as Record<string, unknown> | undefined;
          yield {
            type: 'error',
            error: (err?.message as string) || 'Unknown Anthropic stream error',
          };
          break;
        }
      }
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    // Anthropic does not have a public model listing endpoint.
    // Return a curated static list of available models.
    return [
      {
        id: 'claude-opus-4-20250514',
        provider: 'anthropic',
        fullId: 'anthropic/claude-opus-4-20250514',
        name: 'Claude Opus 4',
        contextWindow: 200_000,
        maxOutputTokens: 32_000,
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: true,
        costPer1MInput: 15,
        costPer1MOutput: 75,
        tier: 2 as CapabilityTier,
        tags: ['flagship', 'reasoning', 'coding'],
      },
      {
        id: 'claude-sonnet-4-20250514',
        provider: 'anthropic',
        fullId: 'anthropic/claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        contextWindow: 200_000,
        maxOutputTokens: 16_000,
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: true,
        costPer1MInput: 3,
        costPer1MOutput: 15,
        tier: 2 as CapabilityTier,
        tags: ['balanced', 'coding'],
      },
      {
        id: 'claude-haiku-4-20250414',
        provider: 'anthropic',
        fullId: 'anthropic/claude-haiku-4-20250414',
        name: 'Claude Haiku 4',
        contextWindow: 200_000,
        maxOutputTokens: 8_000,
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: false,
        costPer1MInput: 0.8,
        costPer1MOutput: 4,
        tier: 2 as CapabilityTier,
        tags: ['fast', 'cheap'],
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        provider: 'anthropic',
        fullId: 'anthropic/claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: false,
        costPer1MInput: 3,
        costPer1MOutput: 15,
        tier: 2 as CapabilityTier,
        tags: ['balanced', 'legacy'],
      },
    ];
  }

  async testConnection(): Promise<{
    ok: boolean;
    latencyMs: number;
    error?: string;
  }> {
    const start = Date.now();
    try {
      await this.chat(
        [{ role: 'user', content: 'Hello' }],
        { maxTokens: 16, model: this.defaultModel },
      );
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private parseResponse(
    data: Record<string, unknown>,
    model: string,
  ): ChatResponse {
    const contentBlocks = (data.content || []) as Record<string, unknown>[];

    let text = '';
    const toolCalls: ToolCall[] = [];

    for (const block of contentBlocks) {
      if (block.type === 'text') {
        text += (block.text as string) || '';
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: (block.id as string) || '',
          name: (block.name as string) || '',
          arguments: JSON.stringify(block.input || {}),
        });
      }
      // thinking blocks are not surfaced in non-streaming response
    }

    const rawUsage = data.usage as Record<string, number> | undefined;
    const usage: TokenUsage = {
      inputTokens: rawUsage?.input_tokens || 0,
      outputTokens: rawUsage?.output_tokens || 0,
      cacheReadTokens: rawUsage?.cache_read_input_tokens,
      cacheWriteTokens: rawUsage?.cache_creation_input_tokens,
      totalTokens:
        (rawUsage?.input_tokens || 0) + (rawUsage?.output_tokens || 0),
    };

    const stopReason = data.stop_reason as string | undefined;
    let finishReason: ChatResponse['finishReason'] = 'stop';
    if (stopReason === 'tool_use') finishReason = 'tool_calls';
    else if (stopReason === 'max_tokens') finishReason = 'length';

    return {
      content: text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      model: (data.model as string) || model,
      finishReason,
    };
  }
}
