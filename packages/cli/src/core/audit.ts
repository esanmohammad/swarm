import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface AuditEntry {
  timestamp: number;
  action: string;
  agentId?: string;
  agentName?: string;
  persona?: string;
  stage?: string;
  cost?: number;
  filesChanged?: string[];
  detail?: string;
}

export class AuditLog {
  private filePath: string;

  constructor(swarmDir: string) {
    if (!existsSync(swarmDir)) {
      mkdirSync(swarmDir, { recursive: true });
    }
    this.filePath = join(swarmDir, 'audit.jsonl');
  }

  /** Append an audit entry */
  log(entry: AuditEntry): void {
    try {
      appendFileSync(this.filePath, JSON.stringify(entry) + '\n');
    } catch {
      // Non-critical — don't crash if audit logging fails
    }
  }

  /** Read all entries, optionally filtered */
  query(opts: {
    action?: string;
    agentId?: string;
    stage?: string;
    since?: number;
    limit?: number;
  } = {}): AuditEntry[] {
    if (!existsSync(this.filePath)) return [];

    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      let entries: AuditEntry[] = raw
        .split('\n')
        .filter(Boolean)
        .map(line => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .filter(Boolean) as AuditEntry[];

      if (opts.action) entries = entries.filter(e => e.action === opts.action);
      if (opts.agentId) entries = entries.filter(e => e.agentId === opts.agentId);
      if (opts.stage) entries = entries.filter(e => e.stage === opts.stage);
      if (opts.since) entries = entries.filter(e => e.timestamp >= opts.since!);

      // Return newest first
      entries.sort((a, b) => b.timestamp - a.timestamp);

      if (opts.limit) entries = entries.slice(0, opts.limit);

      return entries;
    } catch {
      return [];
    }
  }

  // ── Convenience logging methods ──

  agentSpawned(agentId: string, name: string, persona: string, stage?: string): void {
    this.log({ timestamp: Date.now(), action: 'agent-spawned', agentId, agentName: name, persona, stage });
  }

  agentDone(agentId: string, name: string, cost: number): void {
    this.log({ timestamp: Date.now(), action: 'agent-done', agentId, agentName: name, cost });
  }

  agentError(agentId: string, name: string, detail: string): void {
    this.log({ timestamp: Date.now(), action: 'agent-error', agentId, agentName: name, detail });
  }

  stageComplete(stage: string, cost: number): void {
    this.log({ timestamp: Date.now(), action: 'stage-complete', stage, cost });
  }

  stageError(stage: string, detail: string): void {
    this.log({ timestamp: Date.now(), action: 'stage-error', stage, detail });
  }

  pipelineStart(detail: string): void {
    this.log({ timestamp: Date.now(), action: 'pipeline-start', detail });
  }

  pipelineComplete(cost: number): void {
    this.log({ timestamp: Date.now(), action: 'pipeline-complete', cost });
  }

  maydayStart(detail: string): void {
    this.log({ timestamp: Date.now(), action: 'mayday-start', detail });
  }

  maydayComplete(cost: number, detail?: string): void {
    this.log({ timestamp: Date.now(), action: 'mayday-complete', cost, detail });
  }

  budgetExceeded(cost: number, limit: number): void {
    this.log({ timestamp: Date.now(), action: 'budget-exceeded', cost, detail: `Limit: $${limit}` });
  }
}
