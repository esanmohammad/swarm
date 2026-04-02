import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { UserJourney, FeedbackTheme, EmpathizeState } from '../types.js';

function emptyState(): EmpathizeState {
  return { journeys: [], themes: [], improvements: [], lastAnalyzed: 0 };
}

function loadJson<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  try { return JSON.parse(readFileSync(filePath, 'utf-8')) as T; } catch { return fallback; }
}

export class UserIntelligence {
  private swarmDir: string;
  private data: EmpathizeState;

  constructor(swarmDir: string) {
    this.swarmDir = swarmDir;
    const p = join(swarmDir, 'empathize-state.json');
    this.data = existsSync(p) ? loadJson<EmpathizeState>(p, emptyState()) : emptyState();
  }

  private save(): void {
    writeFileSync(join(this.swarmDir, 'empathize-state.json'), JSON.stringify(this.data, null, 2));
  }

  analyzeJourney(name: string): UserJourney {
    const history = loadJson<Array<Record<string, unknown>>>(join(this.swarmDir, 'history.json'), []);
    const stageOrder = ['analyze', 'architect', 'plan', 'build', 'test'];
    const touchpoints: UserJourney['touchpoints'] = [];

    for (const entry of history) {
      const req = String(entry.featureRequest ?? '').toLowerCase();
      if (name !== 'default' && !req.includes(name.toLowerCase())) continue;
      const stages = entry.stagesSummary as Record<string, string> | undefined;
      if (!stages) continue;
      const ts = (entry.timestamp as number) ?? Date.now();
      const dur = (entry.durationMs as number) ?? 0;
      for (const stage of stageOrder) {
        const status = stages[stage];
        if (!status) continue;
        touchpoints.push({
          stage, timestamp: ts,
          status: status === 'done' ? 'completed' : status === 'error' ? 'failed' : 'in-progress',
          durationMs: Math.round(dur / stageOrder.length),
          sentiment: status === 'done' ? 'positive' : status === 'error' ? 'negative' : 'neutral',
        });
      }
    }

    const sentimentScores: number[] = touchpoints.map(t => t.sentiment === 'positive' ? 1 : t.sentiment === 'negative' ? 0 : 0.5);
    const satisfaction = sentimentScores.length > 0 ? Math.round((sentimentScores.reduce((a: number, b: number) => a + b, 0) / sentimentScores.length) * 100) : 50;

    const stageFails = new Map<string, { total: number; failed: number }>();
    for (const tp of touchpoints) {
      const s = stageFails.get(tp.stage) ?? { total: 0, failed: 0 };
      s.total++; if (tp.status === 'failed') s.failed++;
      stageFails.set(tp.stage, s);
    }
    const painPoints: string[] = [];
    for (const [stage, c] of stageFails) { if (c.total > 0 && c.failed / c.total > 0.3) painPoints.push(`${stage}: ${Math.round(c.failed / c.total * 100)}% failure rate`); }

    const dropOffPoints: string[] = [];
    const stageCounts = new Map<string, number>();
    for (const tp of touchpoints) stageCounts.set(tp.stage, (stageCounts.get(tp.stage) || 0) + 1);
    for (let i = 1; i < stageOrder.length; i++) {
      const prev = stageCounts.get(stageOrder[i - 1]) || 0;
      const curr = stageCounts.get(stageOrder[i]) || 0;
      if (prev > 0 && curr < prev * 0.5) dropOffPoints.push(`${stageOrder[i - 1]} → ${stageOrder[i]}: ${Math.round((1 - curr / prev) * 100)}% drop-off`);
    }

    const journey: UserJourney = { id: randomUUID(), name, touchpoints, satisfaction, painPoints, dropOffPoints, analyzedAt: Date.now() };
    const idx = this.data.journeys.findIndex(j => j.name === name);
    if (idx >= 0) this.data.journeys[idx] = journey; else this.data.journeys.push(journey);
    if (this.data.journeys.length > 50) this.data.journeys = this.data.journeys.slice(-50);
    this.data.lastAnalyzed = Date.now();
    this.save();
    return journey;
  }

  analyzeFeedback(): FeedbackTheme[] {
    const history = loadJson<Array<Record<string, unknown>>>(join(this.swarmDir, 'history.json'), []);
    const themeMap = new Map<string, { occurrences: number; sentiment: 'positive' | 'negative' | 'neutral'; sources: string[]; firstSeen: number; lastSeen: number }>();
    const now = Date.now();

    const stageFails = new Map<string, number>();
    let highFixCount = 0;
    for (const entry of history) {
      const stages = entry.stagesSummary as Record<string, string> | undefined;
      if (stages) for (const [stage, status] of Object.entries(stages)) { if (status === 'error') stageFails.set(stage, (stageFails.get(stage) || 0) + 1); }
      if ((entry.fixIterations as number) > 2) highFixCount++;
    }

    for (const [stage, count] of stageFails) {
      if (count >= 2) themeMap.set(`Recurring ${stage} failures`, { occurrences: count, sentiment: 'negative', sources: ['pipeline-history'], firstSeen: now - 30 * 86400000, lastSeen: now });
    }
    if (highFixCount > 0) themeMap.set('Excessive fix iterations', { occurrences: highFixCount, sentiment: 'negative', sources: ['pipeline-history'], firstSeen: now - 30 * 86400000, lastSeen: now });

    const successCount = history.filter(e => { const s = e.stagesSummary as Record<string, string> | undefined; return s && !Object.values(s).includes('error'); }).length;
    if (successCount > 3) themeMap.set('Reliable completions', { occurrences: successCount, sentiment: 'positive', sources: ['pipeline-history'], firstSeen: now - 30 * 86400000, lastSeen: now });

    const themes: FeedbackTheme[] = Array.from(themeMap.entries())
      .map(([theme, d]) => ({ id: randomUUID(), theme, occurrences: d.occurrences, sentiment: d.sentiment, sources: d.sources, firstSeen: d.firstSeen, lastSeen: d.lastSeen, impact: (d.occurrences >= 5 ? 'high' : d.occurrences >= 2 ? 'medium' : 'low') as 'high' | 'medium' | 'low' }))
      .sort((a, b) => b.occurrences - a.occurrences);

    this.data.themes = themes;
    this.data.lastAnalyzed = Date.now();
    this.save();
    return themes;
  }

  assessImpact(feature: string): { feature: string; riskLevel: string; adoptionEstimate: number; confidence: number; userSegments: Array<{ segment: string; impact: string }>; recommendations: string[] } {
    const lower = feature.toLowerCase();
    const segments: Array<{ segment: string; impact: string }> = [];
    if (/dashboard|ui/.test(lower)) segments.push({ segment: 'Dashboard users', impact: 'high' });
    if (/cli|command/.test(lower)) segments.push({ segment: 'CLI users', impact: 'high' });
    if (/pipeline|stage/.test(lower)) segments.push({ segment: 'Pipeline operators', impact: 'high' });
    if (/api|webhook/.test(lower)) segments.push({ segment: 'Integration consumers', impact: 'medium' });
    if (segments.length === 0) segments.push({ segment: 'General users', impact: 'medium' });

    let riskScore = 0;
    if (/breaking|remove|deprecat/.test(lower)) riskScore += 3;
    if (/core|pipeline|state/.test(lower)) riskScore += 2;
    if (/fix|patch/.test(lower)) riskScore -= 1;
    const riskLevel = riskScore >= 4 ? 'high' : riskScore >= 2 ? 'medium' : 'low';
    const adoptionEstimate = Math.min(95, Math.max(10, 50 + (segments.some(s => s.impact === 'high') ? 15 : 0) - (riskLevel === 'high' ? 10 : 0)));
    const recommendations: string[] = [];
    if (riskLevel === 'high') recommendations.push('Consider phased rollout with feature flags');
    if (segments.length > 2) recommendations.push('Broad impact — invest in comprehensive testing');
    if (recommendations.length === 0) recommendations.push('Standard rollout — monitor feedback');

    return { feature, riskLevel, adoptionEstimate, confidence: 60, userSegments: segments, recommendations };
  }

  suggestImprovements(): Array<{ title: string; category: string; priority: string; rationale: string; estimatedImpact: string }> {
    const history = loadJson<Array<Record<string, unknown>>>(join(this.swarmDir, 'history.json'), []);
    const suggestions: Array<{ title: string; category: string; priority: string; rationale: string; estimatedImpact: string }> = [];
    const total = history.length;
    const failed = history.filter(e => { const s = e.stagesSummary as Record<string, string> | undefined; return s && Object.values(s).includes('error'); }).length;
    if (total > 0 && failed / total > 0.2) suggestions.push({ title: 'Improve pipeline reliability', category: 'reliability', priority: 'high', rationale: `${Math.round(failed / total * 100)}% failure rate`, estimatedImpact: 'Reduce user frustration' });
    if (total < 5) suggestions.push({ title: 'Improve onboarding', category: 'usability', priority: 'medium', rationale: 'Low usage suggests friction', estimatedImpact: 'Higher adoption' });
    if (!existsSync(join(this.swarmDir, 'guardrails.yaml'))) suggestions.push({ title: 'Configure guardrails', category: 'feature-gap', priority: 'low', rationale: 'No custom quality gates', estimatedImpact: 'Better artifact quality' });
    this.data.improvements = suggestions.map(s => s.title);
    this.data.lastAnalyzed = Date.now();
    this.save();
    return suggestions;
  }

  getState(): EmpathizeState { return { ...this.data }; }
}
