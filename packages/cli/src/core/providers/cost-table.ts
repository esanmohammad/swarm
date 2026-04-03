/**
 * Cost Table
 *
 * Token cost calculation with fallback pricing for known models.
 * Supports local models (free), cache discounts, and pipeline cost estimation.
 */

import type { TokenUsage } from './types.js';

/** Fallback pricing in USD per 1M tokens — used when provider doesn't report pricing */
const FALLBACK_COSTS: Record<string, { input: number; output: number; cacheRead?: number }> = {
  'anthropic/claude-opus-4':            { input: 15.00, output: 75.00, cacheRead: 1.50 },
  'anthropic/claude-sonnet-4':          { input: 3.00,  output: 15.00, cacheRead: 0.30 },
  'anthropic/claude-haiku-4-5':         { input: 0.80,  output: 4.00,  cacheRead: 0.08 },
  'openai/gpt-4o':                      { input: 2.50,  output: 10.00 },
  'openai/gpt-4o-mini':                 { input: 0.15,  output: 0.60 },
  'openai/o3':                          { input: 10.00, output: 40.00 },
  'google/gemini-2.5-pro':              { input: 1.25,  output: 10.00 },
  'google/gemini-2.5-flash':            { input: 0.15,  output: 0.60 },
  'deepseek/deepseek-chat':             { input: 0.14,  output: 0.28 },
  'deepseek/deepseek-reasoner':         { input: 0.55,  output: 2.19 },
  'groq/llama-3.1-70b-versatile':       { input: 0.59,  output: 0.79 },
  'together/meta-llama/Llama-3-70b':    { input: 0.90,  output: 0.90 },
};

/**
 * Calculate the cost in USD for a given model and token usage.
 *
 * @param model - Full model ID (e.g. 'anthropic/claude-sonnet-4') or alias
 * @param usage - Token usage from a request
 * @returns Cost in USD
 */
export function calculateCost(model: string, usage: TokenUsage): number {
  if (isLocalModel(model)) {
    return 0;
  }

  const pricing = getCostPer1M(model);
  if (!pricing) {
    // Unknown model — return 0 rather than error; cost tracking is best-effort
    return 0;
  }

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;

  let cacheReadCost = 0;
  if (usage.cacheReadTokens && pricing.cacheRead) {
    cacheReadCost = (usage.cacheReadTokens / 1_000_000) * pricing.cacheRead;
  }

  // Cache write tokens are billed at standard input rate
  let cacheWriteCost = 0;
  if (usage.cacheWriteTokens) {
    cacheWriteCost = (usage.cacheWriteTokens / 1_000_000) * pricing.input;
  }

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

/**
 * Get the per-1M-token pricing for a model.
 *
 * @param model - Full model ID (e.g. 'anthropic/claude-sonnet-4')
 * @returns Pricing object, or undefined if model is unknown
 */
export function getCostPer1M(model: string): { input: number; output: number; cacheRead?: number } | undefined {
  // Direct lookup
  if (FALLBACK_COSTS[model]) {
    return FALLBACK_COSTS[model];
  }

  // Try without provider prefix for partial matches
  for (const [key, value] of Object.entries(FALLBACK_COSTS)) {
    const modelPart = key.split('/').slice(1).join('/');
    if (model === modelPart || model.endsWith(`/${modelPart}`)) {
      return value;
    }
  }

  return undefined;
}

/** Estimated tokens per stage (low / high) for pipeline cost estimation */
const STAGE_TOKEN_ESTIMATES: Record<string, { inputLow: number; inputHigh: number; outputLow: number; outputHigh: number }> = {
  analyze:    { inputLow: 2000,  inputHigh: 8000,   outputLow: 1000,  outputHigh: 4000 },
  architect:  { inputLow: 4000,  inputHigh: 15000,  outputLow: 2000,  outputHigh: 8000 },
  plan:       { inputLow: 5000,  inputHigh: 20000,  outputLow: 2000,  outputHigh: 10000 },
  build:      { inputLow: 10000, inputHigh: 100000, outputLow: 5000,  outputHigh: 50000 },
  test:       { inputLow: 5000,  inputHigh: 30000,  outputLow: 2000,  outputHigh: 15000 },
};

/**
 * Estimate the total cost of a pipeline run given per-stage model assignments.
 *
 * @param stageModels - Map of stage name → full model ID
 * @returns Estimated low/high cost range and per-stage breakdown
 */
export function estimatePipelineCost(stageModels: Record<string, string>): {
  low: number;
  high: number;
  breakdown: Record<string, number>;
} {
  let totalLow = 0;
  let totalHigh = 0;
  const breakdown: Record<string, number> = {};

  for (const [stage, model] of Object.entries(stageModels)) {
    const estimates = STAGE_TOKEN_ESTIMATES[stage];
    if (!estimates) continue;

    if (isLocalModel(model)) {
      breakdown[stage] = 0;
      continue;
    }

    const pricing = getCostPer1M(model);
    if (!pricing) {
      breakdown[stage] = 0;
      continue;
    }

    const lowCost =
      (estimates.inputLow / 1_000_000) * pricing.input +
      (estimates.outputLow / 1_000_000) * pricing.output;

    const highCost =
      (estimates.inputHigh / 1_000_000) * pricing.input +
      (estimates.outputHigh / 1_000_000) * pricing.output;

    totalLow += lowCost;
    totalHigh += highCost;

    // Midpoint for breakdown
    breakdown[stage] = (lowCost + highCost) / 2;
  }

  return { low: totalLow, high: totalHigh, breakdown };
}

/**
 * Check if a model is local (free, no API cost).
 * Ollama models and localhost-based endpoints are considered local.
 *
 * @param model - Full model ID or provider name
 * @returns true if the model is local/free
 */
export function isLocalModel(model: string): boolean {
  const lower = model.toLowerCase();

  // Ollama provider
  if (lower.startsWith('ollama/') || lower.startsWith('ollama:')) {
    return true;
  }

  // Localhost-based URLs embedded in model string (rare but possible)
  if (lower.includes('localhost') || lower.includes('127.0.0.1')) {
    return true;
  }

  // LM Studio and other local runners
  if (lower.startsWith('lmstudio/') || lower.startsWith('local/')) {
    return true;
  }

  return false;
}
