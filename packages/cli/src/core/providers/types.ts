/**
 * Multi-LLM Provider Types
 *
 * Foundation types for the provider abstraction layer. Every LLM backend
 * (Claude CLI, OpenAI API, Ollama, etc.) implements the LLMProvider interface.
 */

/** LLM Provider interface — every backend implements this */
export interface LLMProvider {
  readonly name: string;
  readonly type: 'claude-cli' | 'api' | 'text-only';

  /** Send a chat completion request and get the full response */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;

  /** Stream a chat completion, yielding chunks as they arrive */
  stream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<StreamChunk>;

  /** Stream a chat completion with tool definitions */
  streamWithTools(messages: ChatMessage[], tools: ToolDefinition[], options?: ChatOptions): AsyncIterable<StreamChunk>;

  /** List models available from this provider */
  listModels(): Promise<ModelInfo[]>;

  /** Test connectivity and measure latency */
  testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
}

/** A single message in a chat conversation */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/** Structured content block within a message */
export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
  thinking?: string;
}

/** Options for chat/stream requests */
export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  thinking?: boolean;
  timeout?: number;
  signal?: AbortSignal;
}

/** Full response from a chat completion */
export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
  model: string;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

/** A tool call requested by the model */
export interface ToolCall {
  id: string;
  name: string;
  /** JSON-encoded arguments string */
  arguments: string;
}

/** Tool definition for function calling */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Token usage from a request */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
}

/** A chunk from a streaming response */
export interface StreamChunk {
  type: 'text' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'thinking' | 'usage' | 'done' | 'error';
  text?: string;
  toolCall?: Partial<ToolCall>;
  thinking?: string;
  usage?: TokenUsage;
  error?: string;
}

/** Metadata about a model */
export interface ModelInfo {
  /** Provider-specific model ID, e.g. 'gpt-4o', 'claude-sonnet-4' */
  id: string;
  /** Provider name, e.g. 'openai', 'anthropic' */
  provider: string;
  /** Full qualified ID, e.g. 'openai/gpt-4o' */
  fullId: string;
  /** Human-readable name, e.g. 'GPT-4o' */
  name: string;
  /** Maximum context window in tokens */
  contextWindow: number;
  /** Maximum output tokens (if known) */
  maxOutputTokens?: number;
  /** Whether the model supports tool/function calling */
  supportsTools: boolean;
  /** Whether the model supports streaming */
  supportsStreaming: boolean;
  /** Whether the model supports extended thinking */
  supportsThinking: boolean;
  /** Cost in USD per 1M input tokens */
  costPer1MInput: number;
  /** Cost in USD per 1M output tokens */
  costPer1MOutput: number;
  /** Cache read discount multiplier (e.g. 0.1 = 90% discount) */
  cacheReadDiscount?: number;
  /** Capability tier: 1=text-only, 2=tool-calling, 3=full-agent (Claude CLI) */
  tier: CapabilityTier;
  /** Descriptive tags for model selection */
  tags: string[];
}

/** Provider-specific configuration */
export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  organization?: string;
  apiVersion?: string;
  headers?: Record<string, string>;
  /** For Anthropic: CLI (default) or direct API mode */
  mode?: 'cli' | 'api';
}

/**
 * Agent backend abstraction — replaces direct claude CLI spawning.
 * Each provider creates an AgentBackend that wraps its specific process model.
 */
export interface AgentBackend {
  start(prompt: string, systemPrompt: string): Promise<void>;
  sendInput(text: string): Promise<void>;
  kill(): void;
  on(event: 'output', handler: (text: string) => void): void;
  on(event: 'activity', handler: (activity: { type: string; content?: string }) => void): void;
  on(event: 'cost', handler: (cost: { inputTokens: number; outputTokens: number; totalCostUsd: number }) => void): void;
  on(event: 'done', handler: (result: { content: string; cost: number }) => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  removeAllListeners(): void;
}

/** Capability tier levels */
export type CapabilityTier = 1 | 2 | 3;

/** Human-readable labels for capability tiers */
export const TIER_LABELS: Record<CapabilityTier, string> = {
  1: 'Text Only',
  2: 'Tool Calling',
  3: 'Full Agent',
};
