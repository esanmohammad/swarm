import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SpecialistAgent, SpecializeState } from '../types.js';

/** Built-in specialist domains */
export const BUILTIN_DOMAINS = [
  'security',
  'performance',
  'database',
  'frontend',
  'infrastructure',
  'testing',
] as const;

export type BuiltinDomain = (typeof BUILTIN_DOMAINS)[number];
export type SpecialistDomain = SpecialistAgent['domain'];

/** Keywords used for task routing per domain */
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  security: [
    'auth', 'login', 'token', 'jwt', 'oauth', 'session', 'permission', 'rbac',
    'acl', 'encrypt', 'decrypt', 'credential', 'secret', 'vulnerability', 'xss',
    'csrf', 'injection', 'sanitize', 'cors', 'ssl', 'tls', 'certificate',
  ],
  performance: [
    'optimize', 'cache', 'latency', 'throughput', 'memory', 'leak', 'profile',
    'benchmark', 'slow', 'bottleneck', 'load', 'concurrency', 'parallel',
    'async', 'queue', 'batch', 'lazy', 'debounce', 'throttle', 'pool',
  ],
  database: [
    'database', 'db', 'sql', 'query', 'migration', 'schema', 'index', 'table',
    'column', 'relation', 'join', 'transaction', 'orm', 'prisma', 'sequelize',
    'mongoose', 'postgres', 'mysql', 'redis', 'mongo', 'sqlite', 'seed',
  ],
  frontend: [
    'ui', 'ux', 'component', 'react', 'vue', 'angular', 'svelte', 'css',
    'tailwind', 'style', 'layout', 'responsive', 'accessibility', 'a11y',
    'animation', 'form', 'modal', 'dropdown', 'button', 'page', 'route',
  ],
  infrastructure: [
    'deploy', 'docker', 'kubernetes', 'k8s', 'ci', 'cd', 'pipeline', 'terraform',
    'aws', 'gcp', 'azure', 'cloud', 'nginx', 'proxy', 'load balancer', 'dns',
    'ssl', 'env', 'config', 'monitoring', 'logging', 'alert', 'helm',
  ],
  testing: [
    'test', 'spec', 'jest', 'mocha', 'vitest', 'cypress', 'playwright',
    'e2e', 'integration', 'unit', 'coverage', 'mock', 'stub', 'fixture',
    'assertion', 'snapshot', 'regression', 'flaky', 'ci test',
  ],
};

function emptyState(): SpecializeState {
  return {
    specialists: [],
    routingHistory: [],
    collaborations: [],
  };
}

export class SpecializationEngine {
  private statePath: string;
  private state: SpecializeState;

  constructor(private swarmDir: string) {
    this.statePath = join(swarmDir, 'specialists.json');
    this.state = this.loadState();
  }

  /** Load state from disk or create empty */
  private loadState(): SpecializeState {
    if (!existsSync(this.statePath)) {
      return emptyState();
    }
    try {
      const raw = readFileSync(this.statePath, 'utf-8');
      return JSON.parse(raw) as SpecializeState;
    } catch {
      return emptyState();
    }
  }

  /** Persist state to disk */
  private save(): void {
    if (!existsSync(this.swarmDir)) {
      mkdirSync(this.swarmDir, { recursive: true });
    }
    writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  /** Create a new specialist agent */
  createSpecialist(domain: string, name?: string): SpecialistAgent {
    const normalizedDomain = domain.toLowerCase().trim();
    const isBuiltin = (BUILTIN_DOMAINS as readonly string[]).includes(normalizedDomain);
    const resolvedDomain: SpecialistDomain = isBuiltin
      ? (normalizedDomain as BuiltinDomain)
      : 'custom';

    const specialist: SpecialistAgent = {
      id: randomUUID(),
      domain: resolvedDomain,
      name: name || `${normalizedDomain}-specialist`,
      expertiseScore: 0,
      tasksCompleted: 0,
      successRate: 0,
      memoryItems: 0,
      status: 'active',
      createdAt: Date.now(),
      lastUsed: Date.now(),
    };

    this.state.specialists.push(specialist);
    this.save();
    return specialist;
  }

  /** Route a task description to the best specialist(s) */
  routeTask(description: string): Array<{ specialist: SpecialistAgent; score: number; matchedKeywords: string[] }> {
    const lower = description.toLowerCase();
    const results: Array<{ specialist: SpecialistAgent; score: number; matchedKeywords: string[] }> = [];

    for (const specialist of this.state.specialists) {
      if (specialist.status === 'disabled') continue;

      const keywords = DOMAIN_KEYWORDS[specialist.domain] || [];
      const matchedKeywords: string[] = [];

      // Keyword matching
      for (const kw of keywords) {
        if (lower.includes(kw)) {
          matchedKeywords.push(kw);
        }
      }

      // Custom domain: match against specialist name
      if (specialist.domain === 'custom' && lower.includes(specialist.name.replace(/-specialist$/, ''))) {
        matchedKeywords.push(specialist.name);
      }

      if (matchedKeywords.length === 0) continue;

      // Base score from keyword density (0-60)
      const keywordScore = Math.min(60, matchedKeywords.length * 15);

      // Expertise bonus (0-30)
      const expertiseBonus = Math.round(specialist.expertiseScore * 0.3);

      // Recency bonus (0-10): used in last 24h
      const dayMs = 24 * 60 * 60 * 1000;
      const recencyBonus = (Date.now() - specialist.lastUsed) < dayMs ? 10 : 0;

      const score = Math.min(100, keywordScore + expertiseBonus + recencyBonus);

      results.push({ specialist, score, matchedKeywords });
    }

    // Record routing in history
    const sorted = results.sort((a, b) => b.score - a.score);
    if (sorted.length > 0) {
      this.state.routingHistory.push({
        taskDescription: description,
        routed: sorted[0].specialist.id,
        confidence: sorted[0].score,
        timestamp: Date.now(),
      });
      this.save();
    }

    return sorted;
  }

  /** Record the outcome of a task assigned to a specialist */
  recordOutcome(taskId: string, specialistId: string, success: boolean): void {
    const specialist = this.state.specialists.find(s => s.id === specialistId);
    if (!specialist) return;

    specialist.tasksCompleted++;
    specialist.lastUsed = Date.now();
    specialist.memoryItems++;
    specialist.status = 'active';

    // Recalculate success rate
    const totalSuccesses = this.countSuccesses(specialistId) + (success ? 1 : 0);
    specialist.successRate = Math.round((totalSuccesses / specialist.tasksCompleted) * 100);

    // Recalculate expertise score (0-100)
    specialist.expertiseScore = this.calculateExpertise(specialist);

    // Record outcome in routing history (update last entry for this specialist)
    const lastRouting = [...this.state.routingHistory]
      .reverse()
      .find(r => r.routed === specialistId && !r.outcome);
    if (lastRouting) {
      lastRouting.outcome = success ? 'success' : 'failure';
    }

    this.save();
  }

  /** Count successes for a specialist from routing history */
  private countSuccesses(specialistId: string): number {
    return this.state.routingHistory
      .filter(r => r.routed === specialistId && r.outcome === 'success')
      .length;
  }

  /** Calculate expertise score based on tasks completed and success rate */
  private calculateExpertise(specialist: SpecialistAgent): number {
    if (specialist.tasksCompleted === 0) return 0;

    // Volume component (0-50): logarithmic growth, caps around 50 tasks
    const volumeScore = Math.min(50, Math.round(Math.log2(specialist.tasksCompleted + 1) * 8.8));

    // Accuracy component (0-50): success rate scaled
    const accuracyScore = Math.round((specialist.successRate / 100) * 50);

    return Math.min(100, volumeScore + accuracyScore);
  }

  /** Track collaboration between two specialists on a task */
  trackCollaboration(fromId: string, toId: string, type: string = 'task'): void {
    this.state.collaborations.push({
      from: fromId,
      to: toId,
      type,
      timestamp: Date.now(),
    });
    this.save();
  }

  /** Get all specialists */
  getSpecialists(): SpecialistAgent[] {
    return [...this.state.specialists];
  }

  /** Get a specialist by ID */
  getSpecialist(id: string): SpecialistAgent | undefined {
    return this.state.specialists.find(s => s.id === id);
  }

  /** Get aggregate stats */
  getStats(): {
    totalSpecialists: number;
    totalTasks: number;
    overallSuccessRate: number;
    avgExpertise: number;
    topDomain: string | null;
    collaborationCount: number;
  } {
    const specialists = this.state.specialists;
    const totalTasks = specialists.reduce((sum, s) => sum + s.tasksCompleted, 0);
    const avgSuccessRate = specialists.length > 0
      ? Math.round(specialists.reduce((sum, s) => sum + s.successRate, 0) / specialists.length)
      : 0;
    const avgExpertise = specialists.length > 0
      ? Math.round(specialists.reduce((sum, s) => sum + s.expertiseScore, 0) / specialists.length)
      : 0;

    // Find the domain with the most completed tasks
    let topDomain: string | null = null;
    let topTasks = 0;
    for (const s of specialists) {
      if (s.tasksCompleted > topTasks) {
        topTasks = s.tasksCompleted;
        topDomain = s.domain;
      }
    }

    return {
      totalSpecialists: specialists.length,
      totalTasks,
      overallSuccessRate: avgSuccessRate,
      avgExpertise,
      topDomain,
      collaborationCount: this.state.collaborations.length,
    };
  }

  /** Get full state (for serialization / dashboard) */
  getState(): SpecializeState {
    return { ...this.state };
  }
}
