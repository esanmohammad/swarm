import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export type MemoryKind = 'fix-pattern' | 'flaky-test' | 'approach' | 'performance' | 'manual' | 'success';

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  content: string;
  /** ISO timestamp */
  createdAt: string;
  /** ISO timestamp — auto-expire after this date */
  expiresAt: string;
  /** 0-100 confidence score — higher = more reliable */
  confidence: number;
  /** Source: pipeline run ID, manual, etc. */
  source: string;
  /** Optional tags for filtering (test names, file paths, stage names) */
  tags: string[];
}

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const DEFAULT_TTL_DAYS = 30;

export class MemoryStore {
  private readonly dir: string;
  private readonly filePath: string;

  constructor(swarmDir: string) {
    this.dir = join(swarmDir, 'memory');
    this.filePath = join(this.dir, 'patterns.jsonl');
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  /** Add a memory entry */
  add(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'expiresAt'> & { ttlDays?: number }): MemoryEntry {
    this.ensureDir();
    const now = new Date();
    const ttl = entry.ttlDays ?? DEFAULT_TTL_DAYS;
    const full: MemoryEntry = {
      id: `mem-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: entry.kind,
      content: entry.content,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl * 86400000).toISOString(),
      confidence: entry.confidence,
      source: entry.source,
      tags: entry.tags,
    };
    appendFileSync(this.filePath, JSON.stringify(full) + '\n', 'utf-8');
    this.pruneIfNeeded();
    return full;
  }

  /** List all non-expired entries, sorted by confidence desc */
  list(): MemoryEntry[] {
    if (!existsSync(this.filePath)) return [];
    const now = new Date().toISOString();
    const entries: MemoryEntry[] = [];
    for (const line of readFileSync(this.filePath, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry: MemoryEntry = JSON.parse(line);
        if (entry.expiresAt > now) {
          entries.push(entry);
        }
      } catch { /* skip malformed */ }
    }
    return entries.sort((a, b) => b.confidence - a.confidence);
  }

  /** Get memories relevant to a set of tags (file paths, test names, stages) */
  query(tags: string[], kinds?: MemoryKind[]): MemoryEntry[] {
    const all = this.list();
    return all.filter(entry => {
      if (kinds && !kinds.includes(entry.kind)) return false;
      if (tags.length === 0) return true;
      // Match if any tag overlaps or content mentions a tag
      return tags.some(tag =>
        entry.tags.includes(tag) ||
        entry.content.toLowerCase().includes(tag.toLowerCase())
      );
    });
  }

  /** Clear all memories */
  clear(): void {
    if (existsSync(this.filePath)) {
      writeFileSync(this.filePath, '', 'utf-8');
    }
  }

  /** Remove a specific memory by ID */
  remove(id: string): boolean {
    const entries = this.list();
    const filtered = entries.filter(e => e.id !== id);
    if (filtered.length === entries.length) return false;
    this.writeAll(filtered);
    return true;
  }

  /** Build an LLM-ready context string from relevant memories */
  buildMemoryContext(tags: string[] = [], maxEntries = 15): string {
    const entries = tags.length > 0 ? this.query(tags) : this.list();
    if (entries.length === 0) return '';

    const selected = entries.slice(0, maxEntries);
    const lines = [
      'CROSS-RUN MEMORY — Lessons learned from previous pipeline runs:',
      '',
    ];

    for (const entry of selected) {
      const kindLabel = entry.kind.replace('-', ' ').toUpperCase();
      const confidence = entry.confidence >= 80 ? 'HIGH' : entry.confidence >= 50 ? 'MEDIUM' : 'LOW';
      lines.push(`- [${kindLabel}] (${confidence} confidence) ${entry.content}`);
    }

    lines.push('');
    lines.push('Use this knowledge to avoid repeating past mistakes and follow approaches that worked.');
    return lines.join('\n');
  }

  /** Auto-prune: remove expired entries and trim to max file size */
  private pruneIfNeeded(): void {
    try {
      const stats = existsSync(this.filePath) ? readFileSync(this.filePath).length : 0;
      if (stats < MAX_FILE_SIZE) return;

      const entries = this.list(); // already filters expired
      // Keep top entries by confidence, trim to ~80% of max
      const targetSize = MAX_FILE_SIZE * 0.8;
      let size = 0;
      const kept: MemoryEntry[] = [];
      for (const entry of entries) {
        const line = JSON.stringify(entry) + '\n';
        if (size + line.length > targetSize) break;
        kept.push(entry);
        size += line.length;
      }
      this.writeAll(kept);
    } catch { /* non-critical */ }
  }

  private writeAll(entries: MemoryEntry[]): void {
    this.ensureDir();
    const content = entries.map(e => JSON.stringify(e)).join('\n') + (entries.length > 0 ? '\n' : '');
    writeFileSync(this.filePath, content, 'utf-8');
  }
}

// ── Pipeline memory recording helpers ────────────────────────────

export function recordPipelineSuccess(store: MemoryStore, opts: {
  featureRequest: string;
  totalCost: number;
  durationMs: number;
  fixIterations: number;
  stages: Array<{ name: string; cost: number; durationMs: number }>;
}): void {
  store.add({
    kind: 'success',
    content: `Pipeline succeeded for "${opts.featureRequest.slice(0, 100)}". ` +
      `Cost: $${opts.totalCost.toFixed(2)}, duration: ${Math.round(opts.durationMs / 1000)}s, ` +
      `fix iterations: ${opts.fixIterations}.`,
    confidence: 90,
    source: 'pipeline-auto',
    tags: ['pipeline', 'success'],
  });

  // Record slow stages
  for (const stage of opts.stages) {
    if (stage.durationMs > 120000) { // > 2 minutes
      store.add({
        kind: 'performance',
        content: `Stage "${stage.name}" took ${Math.round(stage.durationMs / 1000)}s and cost $${stage.cost.toFixed(2)}. Consider model optimization.`,
        confidence: 70,
        source: 'pipeline-auto',
        tags: [stage.name, 'performance'],
      });
    }
  }
}

export function recordPipelineFailure(store: MemoryStore, opts: {
  featureRequest: string;
  failedStage: string;
  error: string;
  fixHistory?: Array<{ approach: string; failedTests: string[] }>;
}): void {
  store.add({
    kind: 'approach',
    content: `Pipeline failed at stage "${opts.failedStage}" for "${opts.featureRequest.slice(0, 100)}". ` +
      `Error: ${opts.error.slice(0, 300)}`,
    confidence: 80,
    source: 'pipeline-auto',
    tags: ['pipeline', 'failure', opts.failedStage],
  });

  // Record failed approaches from fix history
  if (opts.fixHistory) {
    for (const fix of opts.fixHistory) {
      if (fix.failedTests.length > 0) {
        store.add({
          kind: 'fix-pattern',
          content: `Approach "${fix.approach}" failed to fix tests: ${fix.failedTests.slice(0, 5).join(', ')}. Try a different approach.`,
          confidence: 75,
          source: 'pipeline-auto',
          tags: [...fix.failedTests.slice(0, 5), fix.approach],
          ttlDays: 14, // shorter TTL for specific fix patterns
        });
      }
    }
  }
}

export function recordFlakyTest(store: MemoryStore, testName: string): void {
  // Check if already recorded
  const existing = store.query([testName], ['flaky-test']);
  if (existing.length > 0) {
    // Boost confidence of existing entry
    return;
  }
  store.add({
    kind: 'flaky-test',
    content: `Test "${testName}" is flaky — it intermittently passes/fails. Retry once before treating as real failure.`,
    confidence: 60,
    source: 'pipeline-auto',
    tags: [testName, 'flaky'],
    ttlDays: 14,
  });
}
