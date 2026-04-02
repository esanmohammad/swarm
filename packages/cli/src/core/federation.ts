import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SharedPattern, FederateState } from '../types.js';

const STATE_FILE = 'federate-state.json';

function emptyState(): FederateState {
  return {
    optedIn: false,
    sharedPatterns: [],
    receivedPatterns: [],
    benchmarks: [],
    lastSync: 0,
  };
}

export class FederationManager {
  private swarmDir: string;
  private state: FederateState;

  constructor(swarmDir: string) {
    this.swarmDir = swarmDir;
    this.state = this.load();
  }

  // ── Persistence ──────────────────────────────────────────────

  private filePath(): string {
    return join(this.swarmDir, STATE_FILE);
  }

  private load(): FederateState {
    const fp = this.filePath();
    if (!existsSync(fp)) return emptyState();
    try {
      return JSON.parse(readFileSync(fp, 'utf-8')) as FederateState;
    } catch {
      return emptyState();
    }
  }

  private save(): void {
    if (!existsSync(this.swarmDir)) {
      mkdirSync(this.swarmDir, { recursive: true });
    }
    writeFileSync(this.filePath(), JSON.stringify(this.state, null, 2));
  }

  // ── Opt-in / Opt-out ─────────────────────────────────────────

  optIn(): void {
    this.state.optedIn = true;
    this.save();
  }

  optOut(): void {
    this.state.optedIn = false;
    this.save();
  }

  // ── Share Patterns ───────────────────────────────────────────

  sharePatterns(): SharedPattern[] {
    if (!this.state.optedIn) {
      throw new Error('Federation is not enabled. Run: swarm federate opt-in');
    }

    // Collect effective patterns from local state.
    // Privacy: never share code, business data, or secrets.
    // Only share anonymized strategies, guardrails, prompt variants, and pipeline configs.
    const patterns = this.collectLocalPatterns();

    for (const pattern of patterns) {
      const exists = this.state.sharedPatterns.some(p => p.description === pattern.description);
      if (!exists) {
        this.state.sharedPatterns.push(pattern);
      }
    }

    this.state.lastSync = Date.now();
    this.save();
    return this.state.sharedPatterns;
  }

  // ── Receive Benchmarks ───────────────────────────────────────

  receiveBenchmarks(): FederateState['benchmarks'] {
    if (!this.state.optedIn) {
      throw new Error('Federation is not enabled. Run: swarm federate opt-in');
    }

    // In production this would query a federation API.
    // For now, generate community benchmark comparisons from local data.
    this.state.benchmarks = this.generateBenchmarks();
    this.state.lastSync = Date.now();
    this.save();
    return this.state.benchmarks;
  }

  // ── State Access ─────────────────────────────────────────────

  getState(): FederateState {
    return this.state;
  }

  // ── Private Helpers ──────────────────────────────────────────

  private collectLocalPatterns(): SharedPattern[] {
    const patterns: SharedPattern[] = [];

    // Check for guardrails config
    const guardrailsPath = join(this.swarmDir, 'guardrails.yaml');
    if (existsSync(guardrailsPath)) {
      patterns.push({
        id: randomUUID(),
        type: 'guardrail',
        description: 'Custom guardrail rules for artifact validation',
        stack: this.detectStack(),
        effectiveness: 75,
        adoptions: 0,
        sharedAt: Date.now(),
      });
    }

    // Check for custom pipeline
    const pipelinePath = join(this.swarmDir, 'pipeline.yaml');
    if (existsSync(pipelinePath)) {
      patterns.push({
        id: randomUUID(),
        type: 'pipeline-config',
        description: 'Custom pipeline stage configuration',
        stack: this.detectStack(),
        effectiveness: 80,
        adoptions: 0,
        sharedAt: Date.now(),
      });
    }

    // Check for custom personas
    const personasDir = join(this.swarmDir, 'personas');
    if (existsSync(personasDir)) {
      patterns.push({
        id: randomUUID(),
        type: 'prompt',
        description: 'Custom persona prompt variants',
        stack: this.detectStack(),
        effectiveness: 70,
        adoptions: 0,
        sharedAt: Date.now(),
      });
    }

    // Default strategy pattern based on pipeline runs
    const historyPath = join(this.swarmDir, 'history.json');
    if (existsSync(historyPath)) {
      patterns.push({
        id: randomUUID(),
        type: 'strategy',
        description: 'Pipeline execution strategy with fix-loop tuning',
        stack: this.detectStack(),
        effectiveness: 72,
        adoptions: 0,
        sharedAt: Date.now(),
      });
    }

    return patterns;
  }

  private generateBenchmarks(): FederateState['benchmarks'] {
    // Simulate community benchmark data.
    // In production this would come from an aggregated, anonymized API.
    return [
      {
        metric: 'First-attempt pass rate',
        myValue: 0.65,
        communityAvg: 0.58,
        percentile: 72,
      },
      {
        metric: 'Average cost per pipeline run',
        myValue: 3.20,
        communityAvg: 4.50,
        percentile: 68,
      },
      {
        metric: 'Fix iterations per build',
        myValue: 1.8,
        communityAvg: 2.3,
        percentile: 64,
      },
      {
        metric: 'Human edit rate',
        myValue: 0.22,
        communityAvg: 0.35,
        percentile: 71,
      },
      {
        metric: 'Pipeline completion rate',
        myValue: 0.88,
        communityAvg: 0.82,
        percentile: 66,
      },
      {
        metric: 'Average pipeline duration (min)',
        myValue: 12.5,
        communityAvg: 18.2,
        percentile: 74,
      },
    ];
  }

  private detectStack(): string {
    // Try to read stack from config
    const configPath = join(this.swarmDir, 'config.yaml');
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8');
        const match = content.match(/stack:\s*(\w+)/);
        if (match) return match[1];
      } catch {
        // fall through
      }
    }
    return 'unknown';
  }
}
