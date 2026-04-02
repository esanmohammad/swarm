import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export interface ProvenanceFileEntry {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  linesChanged: number;
}

export interface ProvenanceRecord {
  runId: string;
  timestamp: number;
  model: string;
  requestor: string;        // git user.name or 'autopilot'
  promptHash: string;       // SHA-256 of the prompt (not the prompt itself)
  files: ProvenanceFileEntry[];
  securityChecks: string[]; // which checks were run
  conventions: boolean;     // were conventions applied?
  cost: number;
  gitSha?: string;         // commit SHA if committed
}

export class ProvenanceTracker {
  private storageDir: string;

  constructor(private swarmDir: string) {
    this.storageDir = join(swarmDir, 'provenance');
  }

  /** Ensure the provenance storage directory exists */
  private ensureDir(): void {
    if (!existsSync(this.storageDir)) {
      mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /** Record provenance for a pipeline run */
  record(record: ProvenanceRecord): void {
    this.ensureDir();
    const filePath = join(this.storageDir, `${record.runId}.json`);
    try {
      writeFileSync(filePath, JSON.stringify(record, null, 2));
    } catch {
      // Non-critical — don't crash if provenance recording fails
    }
  }

  /** Get provenance for a specific file */
  getFileProvenance(filePath: string): ProvenanceRecord[] {
    const all = this.list();
    return all.filter(r => r.files.some(f => f.path === filePath));
  }

  /** Get provenance for a run */
  getRunProvenance(runId: string): ProvenanceRecord | null {
    const recordPath = join(this.storageDir, `${runId}.json`);
    if (!existsSync(recordPath)) return null;
    try {
      const raw = readFileSync(recordPath, 'utf-8');
      return JSON.parse(raw) as ProvenanceRecord;
    } catch {
      return null;
    }
  }

  /** Generate git commit trailer */
  static commitTrailer(model: string): string {
    return `Generated-By: swarm/${model}`;
  }

  /** Hash a prompt string using SHA-256 */
  static hashPrompt(prompt: string): string {
    return createHash('sha256').update(prompt).digest('hex');
  }

  /** Export provenance as compliance report */
  exportReport(format: 'json' | 'csv'): string {
    const records = this.list();

    if (format === 'json') {
      return JSON.stringify(records, null, 2);
    }

    // CSV format
    const headers = [
      'runId', 'timestamp', 'model', 'requestor', 'promptHash',
      'filesChanged', 'securityChecks', 'conventions', 'cost', 'gitSha',
    ];
    const lines = [headers.join(',')];

    for (const r of records) {
      const filesSummary = r.files.map(f => `${f.action}:${f.path}`).join(';');
      const checks = r.securityChecks.join(';');
      lines.push([
        r.runId,
        new Date(r.timestamp).toISOString(),
        r.model,
        r.requestor,
        r.promptHash,
        `"${filesSummary}"`,
        `"${checks}"`,
        r.conventions ? 'yes' : 'no',
        r.cost.toFixed(4),
        r.gitSha || '',
      ].join(','));
    }

    return lines.join('\n');
  }

  /** List all provenance records */
  list(limit?: number): ProvenanceRecord[] {
    if (!existsSync(this.storageDir)) return [];

    try {
      const files = readdirSync(this.storageDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse(); // newest first (UUIDs with timestamps sort chronologically)

      const records: ProvenanceRecord[] = [];
      const max = limit ?? files.length;

      for (const file of files) {
        if (records.length >= max) break;
        try {
          const raw = readFileSync(join(this.storageDir, file), 'utf-8');
          records.push(JSON.parse(raw) as ProvenanceRecord);
        } catch {
          // Skip malformed records
        }
      }

      // Sort by timestamp descending (newest first)
      records.sort((a, b) => b.timestamp - a.timestamp);

      return limit ? records.slice(0, limit) : records;
    } catch {
      return [];
    }
  }
}
