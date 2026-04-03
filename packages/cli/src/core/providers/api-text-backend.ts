/**
 * API Text Backend
 *
 * Backend for text-only stages (Tier 1) — analyst, architect, lead, tester.
 * Uses the LLMProvider's stream() method without tool calling for pure text
 * generation. Much simpler than the agentic backend.
 */

import { EventEmitter } from 'node:events';
import type { AgentBackend, LLMProvider, ChatMessage, StreamChunk, TokenUsage } from './types.js';

export interface APITextConfig {
  provider: LLMProvider;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export class APITextBackend extends EventEmitter implements AgentBackend {
  private messages: ChatMessage[] = [];
  private abortController: AbortController | null = null;
  private systemPrompt = '';
  private totalUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  constructor(private config: APITextConfig) {
    super();
  }

  async start(prompt: string, systemPrompt: string): Promise<void> {
    this.systemPrompt = systemPrompt;
    this.messages = [
      { role: 'user', content: prompt },
    ];

    // Run in background so start() returns immediately
    this.streamResponse().catch((err) => {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    });
  }

  async sendInput(text: string): Promise<void> {
    this.messages.push({ role: 'user', content: text });

    await this.streamResponse().catch((err) => {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    });
  }

  kill(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async streamResponse(): Promise<void> {
    this.abortController = new AbortController();

    let fullContent = '';

    try {
      const stream = this.config.provider.stream(this.messages, {
        model: this.config.model,
        maxTokens: this.config.maxTokens ?? 4096,
        temperature: this.config.temperature ?? 0,
        systemPrompt: this.systemPrompt,
        signal: this.abortController.signal,
      });

      for await (const chunk of stream) {
        if (this.abortController.signal.aborted) break;

        this.handleChunk(chunk, fullContent);

        if (chunk.type === 'text' && chunk.text) {
          fullContent += chunk.text;
        }

        if (chunk.type === 'usage' && chunk.usage) {
          this.accumulateUsage(chunk.usage);
        }
      }
    } catch (err) {
      if (this.abortController?.signal.aborted) {
        // Killed intentionally — emit done with partial content
        this.emit('done', {
          content: fullContent,
          cost: this.estimateCost(),
        });
        return;
      }
      throw err;
    }

    // Add assistant response to message history for multi-turn
    if (fullContent) {
      this.messages.push({ role: 'assistant', content: fullContent });
    }

    this.emit('done', {
      content: fullContent,
      cost: this.estimateCost(),
    });
  }

  private handleChunk(chunk: StreamChunk, _accumulatedContent: string): void {
    switch (chunk.type) {
      case 'text':
        if (chunk.text) {
          this.emit('output', chunk.text);
        }
        break;

      case 'thinking':
        if (chunk.thinking) {
          this.emit('activity', {
            type: 'thinking',
            content: chunk.thinking,
          });
        }
        break;

      case 'error':
        if (chunk.error) {
          this.emit('error', new Error(chunk.error));
        }
        break;

      case 'usage':
        if (chunk.usage) {
          this.emit('cost', {
            inputTokens: chunk.usage.inputTokens,
            outputTokens: chunk.usage.outputTokens,
            totalCostUsd: this.estimateCost(),
          });
        }
        break;

      // done chunk is handled by the loop completion
      default:
        break;
    }
  }

  private accumulateUsage(usage: TokenUsage): void {
    this.totalUsage = {
      inputTokens: this.totalUsage.inputTokens + usage.inputTokens,
      outputTokens: this.totalUsage.outputTokens + usage.outputTokens,
      cacheReadTokens: (this.totalUsage.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0),
      cacheWriteTokens: (this.totalUsage.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
      totalTokens: this.totalUsage.totalTokens + usage.totalTokens,
    };
  }

  /**
   * Rough cost estimate. Real pricing varies by provider/model, but this gives
   * a reasonable ballpark. The provider registry can supply real pricing later.
   */
  private estimateCost(): number {
    // Default: ~$3/1M input, ~$15/1M output (Claude Sonnet-class pricing)
    const inputCost = (this.totalUsage.inputTokens / 1_000_000) * 3;
    const outputCost = (this.totalUsage.outputTokens / 1_000_000) * 15;
    return inputCost + outputCost;
  }
}
