/**
 * Provider Registry
 *
 * Central registry that maps model strings (e.g. 'sonnet', 'openai/gpt-4o')
 * to their backing LLM providers. Supports aliases, env var expansion,
 * and lazy provider instantiation from config.
 */

import type { LLMProvider, ProviderConfig, ModelInfo } from './types.js';

/** Built-in shorthand aliases for common models */
const DEFAULT_ALIASES: Record<string, string> = {
  'sonnet': 'anthropic/claude-sonnet-4',
  'opus': 'anthropic/claude-opus-4',
  'haiku': 'anthropic/claude-haiku-4-5',
};

export class ProviderRegistry {
  private providers: Map<string, LLMProvider> = new Map();
  private configs: Map<string, ProviderConfig> = new Map();
  private aliases: Record<string, string> = { ...DEFAULT_ALIASES };

  /**
   * Register a provider instance.
   * @param name - Provider name (e.g. 'openai', 'anthropic')
   * @param provider - The LLMProvider implementation
   * @param config - Optional config to store alongside the provider
   */
  register(name: string, provider: LLMProvider, config?: ProviderConfig): void {
    this.providers.set(name, provider);
    if (config) {
      this.configs.set(name, config);
    }
  }

  /**
   * Get a registered provider by name.
   */
  getProvider(providerName: string): LLMProvider | undefined {
    return this.providers.get(providerName);
  }

  /**
   * Get stored config for a provider.
   */
  getConfig(providerName: string): ProviderConfig | undefined {
    return this.configs.get(providerName);
  }

  /**
   * Resolve a model string into its components.
   *
   * Resolution order:
   * 1. Check aliases ('sonnet' → 'anthropic/claude-sonnet-4')
   * 2. If contains '/', split on first '/' into provider/modelId
   * 3. If no '/', try to infer provider from known model patterns
   * 4. Fallback: treat as anthropic model (backward compat with existing 'sonnet'/'opus' usage)
   *
   * @param modelString - e.g. 'sonnet', 'openai/gpt-4o', 'anthropic/claude-sonnet-4'
   * @returns Resolved provider, modelId, and fullId
   */
  resolve(modelString: string): { provider: string; modelId: string; fullId: string } {
    // Step 1: Check aliases
    const aliased = this.aliases[modelString];
    if (aliased) {
      return this.resolve(aliased);
    }

    // Step 2: If contains '/', split into provider/modelId
    const slashIdx = modelString.indexOf('/');
    if (slashIdx > 0) {
      const provider = modelString.slice(0, slashIdx);
      const modelId = modelString.slice(slashIdx + 1);
      return { provider, modelId, fullId: modelString };
    }

    // Step 3: Infer provider from known model patterns
    if (modelString.startsWith('gpt-') || modelString.startsWith('o1') || modelString.startsWith('o3')) {
      return { provider: 'openai', modelId: modelString, fullId: `openai/${modelString}` };
    }
    if (modelString.startsWith('gemini-')) {
      return { provider: 'google', modelId: modelString, fullId: `google/${modelString}` };
    }
    if (modelString.startsWith('claude-')) {
      return { provider: 'anthropic', modelId: modelString, fullId: `anthropic/${modelString}` };
    }
    if (modelString.startsWith('llama-') || modelString.startsWith('mixtral')) {
      return { provider: 'groq', modelId: modelString, fullId: `groq/${modelString}` };
    }
    if (modelString.startsWith('deepseek-')) {
      return { provider: 'deepseek', modelId: modelString, fullId: `deepseek/${modelString}` };
    }

    // Step 4: Fallback — assume anthropic (backward compatibility)
    return { provider: 'anthropic', modelId: modelString, fullId: `anthropic/${modelString}` };
  }

  /**
   * Get the provider instance for a model string.
   * Resolves the model, then looks up the provider.
   */
  getProviderForModel(modelString: string): LLMProvider | undefined {
    const { provider } = this.resolve(modelString);
    return this.providers.get(provider);
  }

  /**
   * List all registered provider names.
   */
  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Set custom aliases (merged with defaults).
   */
  setAliases(aliases: Record<string, string>): void {
    this.aliases = { ...DEFAULT_ALIASES, ...aliases };
  }

  /**
   * Get all current aliases.
   */
  getAliases(): Record<string, string> {
    return { ...this.aliases };
  }

  /**
   * Expand environment variable references in a string.
   * Replaces `${VAR_NAME}` with `process.env.VAR_NAME`.
   * Returns the original value if the env var is not set.
   *
   * @param value - String potentially containing ${VAR_NAME} references
   * @returns String with env vars expanded
   */
  static expandEnvVars(value: string): string {
    return value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
      const envValue = process.env[varName];
      if (envValue !== undefined) {
        return envValue;
      }
      // Return the original placeholder if env var not found
      return _match;
    });
  }

  /**
   * Register provider configs from a config object.
   * Does NOT instantiate providers — they are created lazily when first needed.
   * Expands env var references in apiKey and baseUrl.
   *
   * @param providersConfig - Map of provider name → config
   */
  registerFromConfig(providersConfig: Record<string, ProviderConfig>): void {
    for (const [name, rawConfig] of Object.entries(providersConfig)) {
      const config: ProviderConfig = { ...rawConfig };

      // Expand env vars in sensitive fields
      if (config.apiKey) {
        config.apiKey = ProviderRegistry.expandEnvVars(config.apiKey);
      }
      if (config.baseUrl) {
        config.baseUrl = ProviderRegistry.expandEnvVars(config.baseUrl);
      }
      if (config.organization) {
        config.organization = ProviderRegistry.expandEnvVars(config.organization);
      }

      // Expand env vars in custom headers
      if (config.headers) {
        const expandedHeaders: Record<string, string> = {};
        for (const [key, val] of Object.entries(config.headers)) {
          expandedHeaders[key] = ProviderRegistry.expandEnvVars(val);
        }
        config.headers = expandedHeaders;
      }

      this.configs.set(name, config);
    }
  }
}

// --- Singleton access ---

let _registry: ProviderRegistry | undefined;

/**
 * Get the global provider registry. Creates a default one if not initialized.
 */
export function getRegistry(): ProviderRegistry {
  if (!_registry) {
    _registry = new ProviderRegistry();
  }
  return _registry;
}

/**
 * Initialize the global provider registry with config.
 * Should be called once during startup after loading SwarmConfig.
 *
 * @param providersConfig - Provider configurations from swarm config
 * @param aliases - Custom model aliases from swarm config
 * @returns The initialized registry
 */
export function initRegistry(providersConfig?: Record<string, ProviderConfig>, aliases?: Record<string, string>): ProviderRegistry {
  _registry = new ProviderRegistry();

  if (providersConfig) {
    _registry.registerFromConfig(providersConfig);
  }

  if (aliases) {
    _registry.setAliases(aliases);
  }

  return _registry;
}
