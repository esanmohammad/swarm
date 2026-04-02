import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CompetitorInfo, TechRadarEntry, CompeteState } from '../types.js';

const STATE_FILE = 'compete-state.json';

function emptyState(): CompeteState {
  return {
    competitors: [],
    featureGaps: [],
    radar: [],
    lastScanned: 0,
  };
}

export class CompetitiveIntel {
  private swarmDir: string;
  private state: CompeteState;

  constructor(swarmDir: string) {
    this.swarmDir = swarmDir;
    this.state = this.load();
  }

  // ── Persistence ──────────────────────────────────────────────

  private filePath(): string {
    return join(this.swarmDir, STATE_FILE);
  }

  private load(): CompeteState {
    const fp = this.filePath();
    if (!existsSync(fp)) return emptyState();
    try {
      return JSON.parse(readFileSync(fp, 'utf-8')) as CompeteState;
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

  // ── Add Competitor ───────────────────────────────────────────

  addCompetitor(name: string, repo?: string): CompetitorInfo {
    const existing = this.state.competitors.find(c => c.name === name);
    if (existing) {
      if (repo) existing.repo = repo;
      this.save();
      return existing;
    }

    const competitor: CompetitorInfo = {
      name,
      repo,
      stars: undefined,
      lastRelease: undefined,
      recentFeatures: [],
      trend: 'stable',
    };

    this.state.competitors.push(competitor);
    this.save();
    return competitor;
  }

  // ── Scan ─────────────────────────────────────────────────────

  scan(): CompeteState {
    // Refresh competitor analysis based on available data.
    // In production this would query GitHub API, NPM registry, etc.
    for (const competitor of this.state.competitors) {
      // Derive trend from feature activity
      if (competitor.recentFeatures.length >= 5) {
        competitor.trend = 'growing';
      } else if (competitor.recentFeatures.length === 0) {
        competitor.trend = 'declining';
      } else {
        competitor.trend = 'stable';
      }

      // Simulate star count for repos
      if (competitor.repo && competitor.stars === undefined) {
        competitor.stars = Math.floor(Math.random() * 5000) + 100;
      }
    }

    // Build technology radar from competitor stacks
    this.state.radar = this.buildRadar();
    this.state.lastScanned = Date.now();
    this.save();
    return this.state;
  }

  // ── Feature Gaps ─────────────────────────────────────────────

  getGaps(): CompeteState['featureGaps'] {
    if (this.state.competitors.length === 0) {
      return [];
    }

    // Analyze competitor features to identify gaps.
    // In production this would use LLM analysis against local codebase.
    const gaps: CompeteState['featureGaps'] = [];

    for (const competitor of this.state.competitors) {
      for (const feature of competitor.recentFeatures) {
        // Avoid duplicates
        const alreadyTracked = gaps.some(g => g.feature === feature && g.competitor === competitor.name);
        if (!alreadyTracked) {
          gaps.push({
            feature,
            competitor: competitor.name,
            priority: this.estimatePriority(feature),
            effort: this.estimateEffort(feature),
          });
        }
      }
    }

    this.state.featureGaps = gaps;
    this.save();
    return gaps;
  }

  // ── Technology Radar ─────────────────────────────────────────

  getRadar(): TechRadarEntry[] {
    if (this.state.radar.length === 0) {
      this.state.radar = this.buildRadar();
      this.save();
    }
    return this.state.radar;
  }

  // ── State Access ─────────────────────────────────────────────

  getState(): CompeteState {
    return this.state;
  }

  // ── Private Helpers ──────────────────────────────────────────

  private buildRadar(): TechRadarEntry[] {
    // Default radar entries based on current landscape.
    // In production this would be derived from competitor analysis + community trends.
    const entries: TechRadarEntry[] = [
      { name: 'TypeScript', category: 'language', ring: 'adopt', relevance: 'Primary development language' },
      { name: 'Rust', category: 'language', ring: 'trial', relevance: 'Performance-critical components' },
      { name: 'React 19', category: 'framework', ring: 'adopt', relevance: 'Dashboard UI framework' },
      { name: 'Bun', category: 'tool', ring: 'assess', relevance: 'Faster JS runtime alternative' },
      { name: 'Deno', category: 'tool', ring: 'assess', relevance: 'Alternative runtime with built-in TS' },
      { name: 'WebAssembly', category: 'platform', ring: 'trial', relevance: 'Cross-platform plugin system' },
      { name: 'MCP Protocol', category: 'platform', ring: 'adopt', relevance: 'Tool integration standard' },
      { name: 'LangChain', category: 'framework', ring: 'hold', relevance: 'Over-abstraction risk for agent orchestration' },
    ];

    // Add entries derived from competitor repos
    for (const competitor of this.state.competitors) {
      if (competitor.repo?.includes('go')) {
        const exists = entries.some(e => e.name === 'Go');
        if (!exists) {
          entries.push({ name: 'Go', category: 'language', ring: 'assess', relevance: `Used by competitor ${competitor.name}` });
        }
      }
    }

    return entries;
  }

  private estimatePriority(feature: string): string {
    const lower = feature.toLowerCase();
    if (lower.includes('security') || lower.includes('auth') || lower.includes('compliance')) return 'high';
    if (lower.includes('performance') || lower.includes('api') || lower.includes('integration')) return 'medium';
    return 'low';
  }

  private estimateEffort(feature: string): string {
    const lower = feature.toLowerCase();
    if (lower.includes('migration') || lower.includes('rewrite') || lower.includes('platform')) return 'large';
    if (lower.includes('add') || lower.includes('support') || lower.includes('integration')) return 'medium';
    return 'small';
  }
}
