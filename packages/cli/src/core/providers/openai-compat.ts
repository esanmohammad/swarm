/**
 * OpenAI-Compatible Provider — Wave 8
 *
 * Works with OpenAI, Ollama, Together, Groq, Fireworks, vLLM, DeepSeek,
 * Azure OpenAI, and any endpoint that speaks the OpenAI chat completions API.
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

// ─── SSE Parser ──────────────────────────────────────────────────────────────

async function* parseSSE(
  response: Response,
  signal?: AbortSignal,
): AsyncIterable<Record<string, unknown>> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith(':')) continue;
        if (trimmed === 'data: [DONE]') return;
        if (trimmed.startsWith('data: ')) {
          try {
            yield JSON.parse(trimmed.slice(6));
          } catch {
            // skip malformed JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getContentText(msg: ChatMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  return msg.content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!)
    .join('');
}

/** Convert our ChatMessage[] to OpenAI API format */
function toOpenAIMessages(
  messages: ChatMessage[],
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      out.push({
        role: 'tool',
        content: getContentText(msg),
        tool_call_id: msg.tool_call_id,
      });
      continue;
    }

    const entry: Record<string, unknown> = {
      role: msg.role,
      content: getContentText(msg),
    };

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      entry.tool_calls = msg.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      }));
    }

    out.push(entry);
  }

  return out;
}

/** Convert our ToolDefinition[] to OpenAI API format */
function toOpenAITools(
  tools: ToolDefinition[],
): Record<string, unknown>[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    },
  }));
}

function mapFinishReason(
  reason: string | null | undefined,
): ChatResponse['finishReason'] {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'tool_calls':
      return 'tool_calls';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'stop';
    default:
      return 'stop';
  }
}

function mapUsage(raw: Record<string, unknown> | undefined): TokenUsage {
  if (!raw) return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const input = (raw.prompt_tokens as number) || 0;
  const output = (raw.completion_tokens as number) || 0;
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: (raw.prompt_tokens_details as Record<string, number>)?.cached_tokens,
    totalTokens: input + output,
  };
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class OpenAICompatProvider implements LLMProvider {
  readonly name: string;
  readonly type = 'api' as const;

  private baseUrl: string;
  private apiKey: string;
  private defaultModel: string;
  private timeout: number;
  private extraHeaders: Record<string, string>;
  private isAzure: boolean;

  constructor(name: string, config: ProviderConfig) {
    this.name = name;
    this.baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(
      /\/$/,
      '',
    );
    this.apiKey = config.apiKey || '';
    this.defaultModel = 'gpt-4o';
    this.timeout = 120_000;
    this.extraHeaders = config.headers || {};

    // Azure uses a different auth header
    this.isAzure =
      this.baseUrl.includes('.openai.azure.com') ||
      this.name.toLowerCase() === 'azure';
  }

  // ── Internal fetch helper ──────────────────────────────────────────────

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders,
    };

    if (this.apiKey) {
      if (this.isAzure) {
        headers['api-key'] = this.apiKey;
      } else {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }
    }

    return headers;
  }

  private async fetchJSON(
    url: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    // Link external signal
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), {
        once: true,
      });
    }

    try {
      const resp = await fetch(url, {
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
    url: string,
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

    const resp = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
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
          `[${this.name}] Authentication failed (401). Check your API key.`,
        );
      case 403:
        throw new Error(
          `[${this.name}] Access forbidden (403). Check permissions.`,
        );
      case 429:
        throw new Error(
          `[${this.name}] Rate limited (429). Slow down or upgrade your plan.`,
        );
      case 500:
      case 502:
      case 503:
        throw new Error(
          `[${this.name}] Server error (${status}). Try again later. ${body}`,
        );
      default:
        throw new Error(
          `[${this.name}] HTTP ${status}: ${body.slice(0, 500)}`,
        );
    }
  }

  // ── LLMProvider implementation ─────────────────────────────────────────

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<ChatResponse> {
    const model = options?.model || this.defaultModel;
    const body: Record<string, unknown> = {
      model,
      messages: toOpenAIMessages(messages),
      stream: false,
    };

    if (options?.temperature !== undefined)
      body.temperature = options.temperature;
    if (options?.maxTokens !== undefined)
      body.max_tokens = options.maxTokens;
    if (options?.systemPrompt) {
      // Prepend system message if not already in messages
      const hasSystem = messages.some((m) => m.role === 'system');
      if (!hasSystem) {
        (body.messages as Record<string, unknown>[]).unshift({
          role: 'system',
          content: options.systemPrompt,
        });
      }
    }

    const url = `${this.baseUrl}/chat/completions`;
    const data = await this.fetchJSON(url, body, options?.signal);

    const choices = data.choices as Record<string, unknown>[];
    const choice = choices?.[0] || {};
    const message = choice.message as Record<string, unknown> | undefined;

    const content = (message?.content as string) || '';
    const toolCalls = this.extractToolCalls(message);
    const usage = mapUsage(data.usage as Record<string, unknown>);
    const finishReason = mapFinishReason(
      choice.finish_reason as string | undefined,
    );

    return { content, toolCalls, usage, model, finishReason };
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
    const body: Record<string, unknown> = {
      model,
      messages: toOpenAIMessages(messages),
      stream: true,
      stream_options: { include_usage: true },
    };

    if (options?.temperature !== undefined)
      body.temperature = options.temperature;
    if (options?.maxTokens !== undefined)
      body.max_tokens = options.maxTokens;
    if (options?.systemPrompt) {
      const hasSystem = messages.some((m) => m.role === 'system');
      if (!hasSystem) {
        (body.messages as Record<string, unknown>[]).unshift({
          role: 'system',
          content: options.systemPrompt,
        });
      }
    }
    if (tools && tools.length > 0) {
      body.tools = toOpenAITools(tools);
      body.tool_choice = 'auto';
    }

    const url = `${this.baseUrl}/chat/completions`;
    const response = await this.fetchStream(url, body, options?.signal);

    // Track active tool calls for delta accumulation
    const activeToolCalls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    for await (const chunk of parseSSE(response, options?.signal)) {
      const choices = chunk.choices as Record<string, unknown>[] | undefined;
      const delta = (choices?.[0]?.delta || {}) as Record<string, unknown>;
      const finishReason = choices?.[0]?.finish_reason as string | undefined;

      // Text content
      if (typeof delta.content === 'string' && delta.content) {
        yield { type: 'text', text: delta.content };
      }

      // Tool call deltas
      const toolCallDeltas = delta.tool_calls as
        | Record<string, unknown>[]
        | undefined;
      if (toolCallDeltas) {
        for (const tcd of toolCallDeltas) {
          const index = tcd.index as number;
          const fn = tcd.function as Record<string, unknown> | undefined;

          if (!activeToolCalls.has(index)) {
            // New tool call
            const tc = {
              id: (tcd.id as string) || `call_${index}`,
              name: (fn?.name as string) || '',
              arguments: (fn?.arguments as string) || '',
            };
            activeToolCalls.set(index, tc);
            yield {
              type: 'tool_call_start',
              toolCall: { id: tc.id, name: tc.name },
            };
            if (tc.arguments) {
              yield {
                type: 'tool_call_delta',
                toolCall: { id: tc.id, arguments: tc.arguments },
              };
            }
          } else {
            // Accumulate arguments
            const tc = activeToolCalls.get(index)!;
            const argDelta = (fn?.arguments as string) || '';
            if (argDelta) {
              tc.arguments += argDelta;
              yield {
                type: 'tool_call_delta',
                toolCall: { id: tc.id, arguments: argDelta },
              };
            }
          }
        }
      }

      // Finish reason — close any open tool calls
      if (finishReason === 'tool_calls' || finishReason === 'stop') {
        for (const [, tc] of activeToolCalls) {
          yield {
            type: 'tool_call_end',
            toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
          };
        }
        activeToolCalls.clear();
      }

      // Usage from final chunk
      if (chunk.usage) {
        yield {
          type: 'usage',
          usage: mapUsage(chunk.usage as Record<string, unknown>),
        };
      }
    }

    yield { type: 'done' };
  }

  async listModels(): Promise<ModelInfo[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const resp = await fetch(`${this.baseUrl}/models`, {
        headers: this.buildHeaders(),
        signal: controller.signal,
      });

      if (!resp.ok) return this.getStaticModels();

      const data = (await resp.json()) as Record<string, unknown>;
      const models = (data.data || data.models || []) as Record<
        string,
        unknown
      >[];

      return models
        .filter((m) => {
          const id = (m.id as string) || '';
          // Filter to likely chat models
          return (
            !id.includes('embed') &&
            !id.includes('whisper') &&
            !id.includes('tts') &&
            !id.includes('dall-e') &&
            !id.includes('moderation')
          );
        })
        .map((m) => {
          const id = (m.id as string) || 'unknown';
          return {
            id,
            provider: this.name,
            fullId: `${this.name}/${id}`,
            name: id,
            contextWindow: 128_000,
            supportsTools: true,
            supportsStreaming: true,
            supportsThinking: false,
            costPer1MInput: 0,
            costPer1MOutput: 0,
            tier: 2 as CapabilityTier,
            tags: [],
          };
        });
    } catch {
      return this.getStaticModels();
    } finally {
      clearTimeout(timeoutId);
    }
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
        { maxTokens: 5, model: this.defaultModel },
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

  private extractToolCalls(
    message: Record<string, unknown> | undefined,
  ): ToolCall[] | undefined {
    if (!message?.tool_calls) return undefined;

    const raw = message.tool_calls as Record<string, unknown>[];
    if (!raw.length) return undefined;

    return raw.map((tc) => {
      const fn = tc.function as Record<string, unknown>;
      return {
        id: (tc.id as string) || '',
        name: (fn?.name as string) || '',
        arguments: (fn?.arguments as string) || '',
      };
    });
  }

  private getStaticModels(): ModelInfo[] {
    if (this.name === 'openai' || this.baseUrl.includes('openai.com')) {
      return [
        {
          id: 'gpt-4o',
          provider: 'openai',
          fullId: 'openai/gpt-4o',
          name: 'GPT-4o',
          contextWindow: 128_000,
          supportsTools: true,
          supportsStreaming: true,
          supportsThinking: false,
          costPer1MInput: 2.5,
          costPer1MOutput: 10,
          tier: 2 as CapabilityTier,
          tags: ['flagship', 'multimodal'],
        },
        {
          id: 'gpt-4o-mini',
          provider: 'openai',
          fullId: 'openai/gpt-4o-mini',
          name: 'GPT-4o Mini',
          contextWindow: 128_000,
          supportsTools: true,
          supportsStreaming: true,
          supportsThinking: false,
          costPer1MInput: 0.15,
          costPer1MOutput: 0.6,
          tier: 2 as CapabilityTier,
          tags: ['fast', 'cheap'],
        },
        {
          id: 'o3-mini',
          provider: 'openai',
          fullId: 'openai/o3-mini',
          name: 'o3-mini',
          contextWindow: 200_000,
          supportsTools: true,
          supportsStreaming: true,
          supportsThinking: true,
          costPer1MInput: 1.1,
          costPer1MOutput: 4.4,
          tier: 2 as CapabilityTier,
          tags: ['reasoning'],
        },
      ];
    }
    return [];
  }
}
