/**
 * Google Gemini Provider — Wave 8
 *
 * Uses Gemini's OpenAI-compatible endpoint for simplicity, delegating to
 * OpenAICompatProvider internally. Overrides model listing with known
 * Gemini models.
 */

import type {
  LLMProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ToolDefinition,
  StreamChunk,
  ModelInfo,
  ProviderConfig,
  CapabilityTier,
} from './types.js';
import { OpenAICompatProvider } from './openai-compat.js';

// ─── Known Gemini Models ─────────────────────────────────────────────────────

const GEMINI_MODELS: ModelInfo[] = [
  {
    id: 'gemini-2.5-pro',
    provider: 'google',
    fullId: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsThinking: true,
    costPer1MInput: 1.25,
    costPer1MOutput: 10,
    tier: 2 as CapabilityTier,
    tags: ['flagship', 'reasoning', 'long-context'],
  },
  {
    id: 'gemini-2.5-flash',
    provider: 'google',
    fullId: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsThinking: true,
    costPer1MInput: 0.15,
    costPer1MOutput: 0.6,
    tier: 2 as CapabilityTier,
    tags: ['fast', 'cheap', 'reasoning'],
  },
  {
    id: 'gemini-2.0-flash',
    provider: 'google',
    fullId: 'google/gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsThinking: false,
    costPer1MInput: 0.1,
    costPer1MOutput: 0.4,
    tier: 2 as CapabilityTier,
    tags: ['fast', 'cheap'],
  },
  {
    id: 'gemini-2.0-flash-lite',
    provider: 'google',
    fullId: 'google/gemini-2.0-flash-lite',
    name: 'Gemini 2.0 Flash Lite',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsThinking: false,
    costPer1MInput: 0.075,
    costPer1MOutput: 0.3,
    tier: 2 as CapabilityTier,
    tags: ['fastest', 'cheapest'],
  },
];

// ─── Provider ────────────────────────────────────────────────────────────────

export class GeminiProvider implements LLMProvider {
  readonly name = 'google';
  readonly type = 'api' as const;

  private delegate: OpenAICompatProvider;
  private apiKey: string;
  private timeout: number;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey || '';
    this.timeout = 120_000;

    // Gemini provides an OpenAI-compatible endpoint
    this.delegate = new OpenAICompatProvider('google', {
      ...config,
      baseUrl:
        config.baseUrl ||
        'https://generativelanguage.googleapis.com/v1beta/openai',
    });
  }

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<ChatResponse> {
    return this.delegate.chat(messages, {
      ...options,
      model: options?.model || 'gemini-2.5-flash',
    });
  }

  async *stream(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncIterable<StreamChunk> {
    yield* this.delegate.stream(messages, {
      ...options,
      model: options?.model || 'gemini-2.5-flash',
    });
  }

  async *streamWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    options?: ChatOptions,
  ): AsyncIterable<StreamChunk> {
    yield* this.delegate.streamWithTools(messages, tools, {
      ...options,
      model: options?.model || 'gemini-2.5-flash',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    // Try Gemini's native model listing, fall back to static list
    if (this.apiKey) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`,
          { signal: controller.signal },
        );

        clearTimeout(timeoutId);

        if (resp.ok) {
          const data = (await resp.json()) as Record<string, unknown>;
          const models = (data.models || []) as Record<string, unknown>[];

          const mapped: ModelInfo[] = models
            .filter((m) => {
              const methods = (m.supportedGenerationMethods || []) as string[];
              return methods.includes('generateContent');
            })
            .map((m) => {
              const rawName = (m.name as string) || '';
              const id = rawName.replace('models/', '');
              const displayName = (m.displayName as string) || id;

              // Find matching static entry for cost info
              const staticMatch = GEMINI_MODELS.find((s) => s.id === id);

              return {
                id,
                provider: 'google',
                fullId: `google/${id}`,
                name: displayName,
                contextWindow:
                  (m.inputTokenLimit as number) || 1_000_000,
                supportsTools: true,
                supportsStreaming: true,
                supportsThinking: staticMatch?.supportsThinking || false,
                costPer1MInput: staticMatch?.costPer1MInput || 0,
                costPer1MOutput: staticMatch?.costPer1MOutput || 0,
                tier: (staticMatch?.tier || 2) as CapabilityTier,
                tags: staticMatch?.tags || [],
              };
            });

          if (mapped.length > 0) return mapped;
        }
      } catch {
        // Fall through to static list
      }
    }

    return GEMINI_MODELS;
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
        { maxTokens: 16, model: 'gemini-2.5-flash' },
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
}
