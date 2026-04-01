import type { PipelineState, StageName, CostInfo } from '../types.js';

export interface WebhookConfig {
  /** Webhook URL (HTTP POST) */
  url: string;
  /** Events to fire on. Empty = all events. */
  events?: WebhookEvent[];
  /** Optional secret for HMAC signature (X-Swarm-Signature header) */
  secret?: string;
  /** Preset format: 'slack', 'discord', or 'generic' (default) */
  format?: 'slack' | 'discord' | 'generic';
}

export type WebhookEvent =
  | 'stage-complete'
  | 'stage-error'
  | 'pipeline-complete'
  | 'agent-error'
  | 'budget-warning'
  | 'mayday-complete'
  | 'mayday-error';

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: number;
  project: string;
  data: Record<string, unknown>;
}

/** Format a payload for Slack's Block Kit */
function formatSlack(payload: WebhookPayload): Record<string, unknown> {
  const emoji: Record<string, string> = {
    'stage-complete': ':white_check_mark:',
    'stage-error': ':x:',
    'pipeline-complete': ':tada:',
    'agent-error': ':warning:',
    'budget-warning': ':money_with_wings:',
    'mayday-complete': ':rocket:',
    'mayday-error': ':rotating_light:',
  };

  const icon = emoji[payload.event] ?? ':bell:';
  const lines = Object.entries(payload.data)
    .map(([k, v]) => `*${k}*: ${v}`)
    .join('\n');

  return {
    text: `${icon} *[swarm]* ${payload.event} — ${payload.project}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${icon} *[swarm] ${payload.event}* — ${payload.project}\n${lines}`,
        },
      },
    ],
  };
}

/** Format a payload for Discord's webhook API */
function formatDiscord(payload: WebhookPayload): Record<string, unknown> {
  const lines = Object.entries(payload.data)
    .map(([k, v]) => `**${k}**: ${v}`)
    .join('\n');

  return {
    content: `**[swarm] ${payload.event}** — ${payload.project}\n${lines}`,
  };
}

export class WebhookManager {
  private hooks: WebhookConfig[];

  constructor(hooks: WebhookConfig[] = []) {
    this.hooks = hooks;
  }

  /** Fire a webhook event to all matching hooks */
  async fire(event: WebhookEvent, project: string, data: Record<string, unknown>): Promise<void> {
    const payload: WebhookPayload = {
      event,
      timestamp: Date.now(),
      project,
      data,
    };

    const matching = this.hooks.filter(
      (h) => !h.events || h.events.length === 0 || h.events.includes(event),
    );

    await Promise.allSettled(matching.map((h) => this.send(h, payload)));
  }

  private async send(hook: WebhookConfig, payload: WebhookPayload): Promise<void> {
    let body: string;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    switch (hook.format) {
      case 'slack':
        body = JSON.stringify(formatSlack(payload));
        break;
      case 'discord':
        body = JSON.stringify(formatDiscord(payload));
        break;
      default:
        body = JSON.stringify(payload);
    }

    if (hook.secret) {
      const { createHmac } = await import('node:crypto');
      const sig = createHmac('sha256', hook.secret).update(body).digest('hex');
      headers['X-Swarm-Signature'] = `sha256=${sig}`;
    }

    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.error(`[webhook] ${hook.url} returned ${res.status}`);
      }
    } catch (err) {
      console.error(`[webhook] Failed to send to ${hook.url}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── Convenience methods for common events ──

  async stageComplete(project: string, stage: StageName, cost: CostInfo): Promise<void> {
    await this.fire('stage-complete', project, {
      stage,
      cost: `$${cost.totalUsd.toFixed(4)}`,
      duration: `${(cost.durationMs / 1000).toFixed(1)}s`,
    });
  }

  async stageError(project: string, stage: StageName, error: string): Promise<void> {
    await this.fire('stage-error', project, { stage, error: error.slice(0, 500) });
  }

  async pipelineComplete(project: string, state: PipelineState): Promise<void> {
    await this.fire('pipeline-complete', project, {
      stages: Object.entries(state.stages).map(([k, v]) => `${k}:${v.status}`).join(', '),
      agents: state.agents.length,
      cost: `$${state.totalCost.totalUsd.toFixed(4)}`,
    });
  }

  async maydayComplete(project: string, state: PipelineState): Promise<void> {
    const m = state.mayday;
    await this.fire('mayday-complete', project, {
      feature: m?.featureRequest ?? 'unknown',
      fixIterations: m?.fixIteration ?? 0,
      testsPassed: m?.lastTestPassed ?? false,
      cost: `$${state.totalCost.totalUsd.toFixed(4)}`,
      prUrl: m?.prUrl ?? 'none',
    });
  }

  async maydayError(project: string, error: string): Promise<void> {
    await this.fire('mayday-error', project, { error: error.slice(0, 500) });
  }

  async budgetWarning(project: string, spent: number, limit: number): Promise<void> {
    await this.fire('budget-warning', project, {
      spent: `$${spent.toFixed(4)}`,
      limit: `$${limit.toFixed(2)}`,
      percentage: `${((spent / limit) * 100).toFixed(0)}%`,
    });
  }
}
