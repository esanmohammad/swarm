/**
 * Model Catalog
 *
 * Dynamic model discovery and catalog management. Combines static knowledge
 * of well-known models with runtime discovery from configured providers.
 * Provides model resolution, tier suggestions, and CLI help text.
 */

import type { ModelInfo, CapabilityTier } from './types.js';
import { getRegistry } from './registry.js';

/** Well-known models — used as fallback when provider discovery is unavailable */
const KNOWN_MODELS: ModelInfo[] = [
  // Anthropic
  {
    id: 'claude-opus-4', provider: 'anthropic', fullId: 'anthropic/claude-opus-4',
    name: 'Claude Opus 4', contextWindow: 200000, maxOutputTokens: 32000,
    supportsTools: true, supportsStreaming: true, supportsThinking: true,
    costPer1MInput: 15.00, costPer1MOutput: 75.00, cacheReadDiscount: 0.1,
    tier: 3, tags: ['reasoning', 'coding', 'agent', 'premium'],
  },
  {
    id: 'claude-sonnet-4', provider: 'anthropic', fullId: 'anthropic/claude-sonnet-4',
    name: 'Claude Sonnet 4', contextWindow: 200000, maxOutputTokens: 16000,
    supportsTools: true, supportsStreaming: true, supportsThinking: true,
    costPer1MInput: 3.00, costPer1MOutput: 15.00, cacheReadDiscount: 0.1,
    tier: 3, tags: ['coding', 'agent', 'balanced'],
  },
  {
    id: 'claude-haiku-4-5', provider: 'anthropic', fullId: 'anthropic/claude-haiku-4-5',
    name: 'Claude Haiku 4.5', contextWindow: 200000, maxOutputTokens: 8192,
    supportsTools: true, supportsStreaming: true, supportsThinking: false,
    costPer1MInput: 0.80, costPer1MOutput: 4.00, cacheReadDiscount: 0.1,
    tier: 2, tags: ['fast', 'cheap', 'coding'],
  },
  // OpenAI
  {
    id: 'gpt-4o', provider: 'openai', fullId: 'openai/gpt-4o',
    name: 'GPT-4o', contextWindow: 128000, maxOutputTokens: 16384,
    supportsTools: true, supportsStreaming: true, supportsThinking: false,
    costPer1MInput: 2.50, costPer1MOutput: 10.00,
    tier: 2, tags: ['coding', 'balanced', 'multimodal'],
  },
  {
    id: 'gpt-4o-mini', provider: 'openai', fullId: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini', contextWindow: 128000, maxOutputTokens: 16384,
    supportsTools: true, supportsStreaming: true, supportsThinking: false,
    costPer1MInput: 0.15, costPer1MOutput: 0.60,
    tier: 2, tags: ['fast', 'cheap'],
  },
  {
    id: 'o3', provider: 'openai', fullId: 'openai/o3',
    name: 'OpenAI o3', contextWindow: 200000, maxOutputTokens: 100000,
    supportsTools: true, supportsStreaming: true, supportsThinking: true,
    costPer1MInput: 10.00, costPer1MOutput: 40.00,
    tier: 2, tags: ['reasoning', 'premium'],
  },
  // Google
  {
    id: 'gemini-2.5-pro', provider: 'google', fullId: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro', contextWindow: 1000000, maxOutputTokens: 65536,
    supportsTools: true, supportsStreaming: true, supportsThinking: true,
    costPer1MInput: 1.25, costPer1MOutput: 10.00,
    tier: 2, tags: ['coding', 'reasoning', 'long-context'],
  },
  {
    id: 'gemini-2.5-flash', provider: 'google', fullId: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash', contextWindow: 1000000, maxOutputTokens: 65536,
    supportsTools: true, supportsStreaming: true, supportsThinking: true,
    costPer1MInput: 0.15, costPer1MOutput: 0.60,
    tier: 2, tags: ['fast', 'cheap', 'long-context'],
  },
  // DeepSeek
  {
    id: 'deepseek-chat', provider: 'deepseek', fullId: 'deepseek/deepseek-chat',
    name: 'DeepSeek Chat', contextWindow: 64000, maxOutputTokens: 8192,
    supportsTools: true, supportsStreaming: true, supportsThinking: false,
    costPer1MInput: 0.14, costPer1MOutput: 0.28,
    tier: 2, tags: ['cheap', 'coding'],
  },
  {
    id: 'deepseek-reasoner', provider: 'deepseek', fullId: 'deepseek/deepseek-reasoner',
    name: 'DeepSeek Reasoner', contextWindow: 64000, maxOutputTokens: 8192,
    supportsTools: true, supportsStreaming: true, supportsThinking: true,
    costPer1MInput: 0.55, costPer1MOutput: 2.19,
    tier: 2, tags: ['reasoning', 'coding'],
  },
  // Groq
  {
    id: 'llama-3.1-70b-versatile', provider: 'groq', fullId: 'groq/llama-3.1-70b-versatile',
    name: 'Llama 3.1 70B (Groq)', contextWindow: 131072, maxOutputTokens: 32768,
    supportsTools: true, supportsStreaming: true, supportsThinking: false,
    costPer1MInput: 0.59, costPer1MOutput: 0.79,
    tier: 2, tags: ['fast', 'open-source'],
  },
  // Together
  {
    id: 'meta-llama/Llama-3-70b', provider: 'together', fullId: 'together/meta-llama/Llama-3-70b',
    name: 'Llama 3 70B (Together)', contextWindow: 8192, maxOutputTokens: 4096,
    supportsTools: false, supportsStreaming: true, supportsThinking: false,
    costPer1MInput: 0.90, costPer1MOutput: 0.90,
    tier: 1, tags: ['open-source'],
  },
];

export class ModelCatalog {
  private cache: Map<string, ModelInfo[]> = new Map();
  private cacheTimestamp = 0;
  private static CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private defaultModel: string;
  private aliases: Record<string, string>;

  constructor(defaultModel?: string, aliases?: Record<string, string>) {
    this.defaultModel = defaultModel ?? 'anthropic/claude-sonnet-4';
    this.aliases = aliases ?? {};

    // Ensure default model is in full format
    const registry = getRegistry();
    const resolved = registry.resolve(this.defaultModel);
    this.defaultModel = resolved.fullId;
  }

  /**
   * Get all available models across all configured providers.
   * Combines dynamic discovery with static known models.
   */
  async listAll(): Promise<ModelInfo[]> {
    const now = Date.now();
    if (this.cache.has('__all__') && (now - this.cacheTimestamp) < ModelCatalog.CACHE_TTL) {
      return this.cache.get('__all__')!;
    }

    const registry = getRegistry();
    const providerNames = registry.listProviders();
    const allModels: ModelInfo[] = [];
    const seenFullIds = new Set<string>();

    // Try dynamic discovery from each registered provider
    for (const name of providerNames) {
      try {
        const discovered = await this.discoverFromProvider(name);
        for (const model of discovered) {
          if (!seenFullIds.has(model.fullId)) {
            seenFullIds.add(model.fullId);
            allModels.push(model);
          }
        }
      } catch {
        // Discovery failed — fall through to known models
      }
    }

    // Fill in known models that weren't discovered
    for (const model of KNOWN_MODELS) {
      if (!seenFullIds.has(model.fullId)) {
        seenFullIds.add(model.fullId);
        allModels.push(model);
      }
    }

    this.cache.set('__all__', allModels);
    this.cacheTimestamp = now;
    return allModels;
  }

  /**
   * Discover models from a specific provider.
   * Tries provider.listModels() first, falls back to known models for that provider.
   */
  async discoverFromProvider(providerName: string): Promise<ModelInfo[]> {
    // Check cache first
    const now = Date.now();
    if (this.cache.has(providerName) && (now - this.cacheTimestamp) < ModelCatalog.CACHE_TTL) {
      return this.cache.get(providerName)!;
    }

    const registry = getRegistry();
    const provider = registry.getProvider(providerName);

    if (provider) {
      try {
        const models = await provider.listModels();
        this.cache.set(providerName, models);
        return models;
      } catch {
        // Fall through to known models
      }
    }

    // Fallback: return known models for this provider
    const knownForProvider = KNOWN_MODELS.filter(m => m.provider === providerName);
    this.cache.set(providerName, knownForProvider);
    return knownForProvider;
  }

  /**
   * Get the user's configured default model in full format.
   */
  getDefaultModel(): string {
    return this.defaultModel;
  }

  /**
   * Resolve a model string to its full ID.
   * Uses the registry's alias resolution.
   *
   * @param modelString - e.g. 'sonnet', 'openai/gpt-4o'
   * @returns Full model ID, e.g. 'anthropic/claude-sonnet-4'
   */
  resolve(modelString: string): string {
    // Check catalog-level aliases first
    if (this.aliases[modelString]) {
      return this.resolve(this.aliases[modelString]);
    }

    const registry = getRegistry();
    const resolved = registry.resolve(modelString);
    return resolved.fullId;
  }

  /**
   * Get the CLI --model option description with dynamic model info.
   */
  getCliModelDescription(): string {
    return 'Model to use (default: sonnet). Use provider/model format for non-Claude models (e.g., openai/gpt-4o, google/gemini-2.5-pro).';
  }

  /**
   * Suggest model assignments for cost/quality tiers.
   *
   * @param tier - 'lean' (cheapest), 'smart' (best quality), or 'balanced'
   * @returns Map of stage → full model ID
   */
  suggestForTier(tier: 'lean' | 'smart' | 'balanced'): Record<string, string> {
    switch (tier) {
      case 'lean':
        return {
          analyze: 'anthropic/claude-haiku-4-5',
          architect: 'anthropic/claude-haiku-4-5',
          plan: 'anthropic/claude-haiku-4-5',
          build: 'anthropic/claude-sonnet-4',
          test: 'anthropic/claude-haiku-4-5',
        };
      case 'smart':
        return {
          analyze: 'anthropic/claude-sonnet-4',
          architect: 'anthropic/claude-opus-4',
          plan: 'anthropic/claude-sonnet-4',
          build: 'anthropic/claude-opus-4',
          test: 'anthropic/claude-sonnet-4',
        };
      case 'balanced':
        return {
          analyze: 'anthropic/claude-sonnet-4',
          architect: 'anthropic/claude-sonnet-4',
          plan: 'anthropic/claude-sonnet-4',
          build: 'anthropic/claude-sonnet-4',
          test: 'anthropic/claude-sonnet-4',
        };
      default:
        return {
          analyze: this.defaultModel,
          architect: this.defaultModel,
          plan: this.defaultModel,
          build: this.defaultModel,
          test: this.defaultModel,
        };
    }
  }

  /**
   * Get the static list of well-known models.
   * Used as fallback when dynamic discovery fails.
   */
  getKnownModels(): ModelInfo[] {
    return [...KNOWN_MODELS];
  }

  /**
   * Invalidate the model cache, forcing re-discovery on next access.
   */
  invalidateCache(): void {
    this.cache.clear();
    this.cacheTimestamp = 0;
  }
}

// --- Singleton access ---

let _catalog: ModelCatalog | undefined;

/**
 * Get the global model catalog. Creates a default one if not initialized.
 */
export function getModelCatalog(): ModelCatalog {
  if (!_catalog) {
    _catalog = new ModelCatalog();
  }
  return _catalog;
}

/**
 * Initialize the global model catalog with config.
 * Should be called once during startup after loading SwarmConfig.
 *
 * @param defaultModel - The user's configured default model
 * @param aliases - Custom model aliases
 * @returns The initialized catalog
 */
export function initModelCatalog(defaultModel?: string, aliases?: Record<string, string>): ModelCatalog {
  _catalog = new ModelCatalog(defaultModel, aliases);
  return _catalog;
}
