import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AllocationRecommendation, WhatIfScenario, AllocateState } from '../types.js';

const STATE_FILE = 'allocate-state.json';
const HISTORY_FILE = 'history.json';
const IMPACT_FILE = 'impact-reports.json';
const HEALTH_FILE = 'health-report.json';

function emptyState(): AllocateState {
  return {
    currentPlan: null,
    scenarios: [],
    okrs: [],
    lastGenerated: 0,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function loadJson<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

// ── ResourceAllocator ───────────────────────────────────────────────────────

export class ResourceAllocator {
  private swarmDir: string;
  private data: AllocateState;

  constructor(swarmDir: string) {
    this.swarmDir = swarmDir;
    this.data = this.loadState();
  }

  // ── Persistence ──────────────────────────────────────────────

  private loadState(): AllocateState {
    const filePath = join(this.swarmDir, STATE_FILE);
    if (!existsSync(filePath)) return emptyState();
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as AllocateState;
    } catch {
      return emptyState();
    }
  }

  private saveState(): void {
    const filePath = join(this.swarmDir, STATE_FILE);
    writeFileSync(filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  // ── Allocation Plan ──────────────────────────────────────────

  /**
   * Generate a resource allocation recommendation based on historical data,
   * impact reports, and project health signals.
   */
  generatePlan(): AllocationRecommendation {
    const history = loadJson<Array<Record<string, unknown>>>(
      join(this.swarmDir, HISTORY_FILE),
      [],
    );
    const impactReports = loadJson<Array<Record<string, unknown>>>(
      join(this.swarmDir, IMPACT_FILE),
      [],
    );
    const healthReport = loadJson<Record<string, unknown>>(
      join(this.swarmDir, HEALTH_FILE),
      {},
    );

    // Compute priority scores across dimensions
    const businessImpactScore = this.computeBusinessImpact(history, impactReports);
    const techRiskScore = this.computeTechRisk(history, healthReport);
    const userImpactScore = this.computeUserImpact(history);

    // Weighted composite
    const compositeScore = (
      businessImpactScore * 0.4 +
      techRiskScore * 0.35 +
      userImpactScore * 0.25
    );

    // Generate allocation percentages based on scores
    const allocations = this.computeAllocations(businessImpactScore, techRiskScore, userImpactScore, history);

    // Key insights
    const insights: string[] = [];
    if (techRiskScore > 70) {
      insights.push('Tech debt is high — consider increasing reliability investment');
    }
    if (businessImpactScore > 70) {
      insights.push('Strong business impact signals — prioritize feature delivery');
    }
    if (userImpactScore < 30) {
      insights.push('Low user engagement detected — investigate onboarding friction');
    }
    if (allocations.some(a => a.category === 'tech-debt' && a.percentage > 30)) {
      insights.push('Tech debt allocation above 30% — plan dedicated cleanup sprints');
    }

    const totalCost = history.reduce(
      (sum, e) => sum + ((e.totalCost as Record<string, number>)?.totalUsd ?? 0),
      0,
    );

    const plan: AllocationRecommendation = {
      id: randomUUID(),
      generatedAt: Date.now(),
      compositeScore: Math.round(compositeScore),
      scores: {
        businessImpact: Math.round(businessImpactScore),
        techRisk: Math.round(techRiskScore),
        userImpact: Math.round(userImpactScore),
      },
      allocations,
      insights,
      totalBudgetContext: {
        historicalCost: Math.round(totalCost * 100) / 100,
        runsAnalyzed: history.length,
      },
    };

    this.data.currentPlan = plan;
    this.data.lastGenerated = Date.now();
    this.saveState();

    return plan;
  }

  // ── Scenario Modeling ────────────────────────────────────────

  /**
   * Run a what-if scenario to model allocation changes.
   */
  runScenario(scenario: string): WhatIfScenario {
    const history = loadJson<Array<Record<string, unknown>>>(
      join(this.swarmDir, HISTORY_FILE),
      [],
    );

    const lower = scenario.toLowerCase();

    // Parse scenario type
    let scenarioType: 'increase-features' | 'increase-reliability' | 'reduce-budget' | 'scale-up' | 'custom';
    let adjustments: WhatIfScenario['adjustments'] = [];
    let predictedOutcome: WhatIfScenario['predictedOutcome'];

    const totalRuns = history.length;
    const avgCost = totalRuns > 0
      ? history.reduce((sum, e) => sum + ((e.totalCost as Record<string, number>)?.totalUsd ?? 0), 0) / totalRuns
      : 5.0;

    if (/more feature|increase feature|feature focus/.test(lower)) {
      scenarioType = 'increase-features';
      adjustments = [
        { category: 'new-features', currentPct: 40, proposedPct: 60 },
        { category: 'tech-debt', currentPct: 25, proposedPct: 15 },
        { category: 'reliability', currentPct: 20, proposedPct: 15 },
        { category: 'exploration', currentPct: 15, proposedPct: 10 },
      ];
      predictedOutcome = {
        velocityChange: '+20% feature throughput',
        riskChange: 'Tech debt accumulation risk increases by ~15%',
        costChange: `Estimated monthly cost: $${(avgCost * totalRuns * 1.1).toFixed(2)}`,
        recommendation: 'Viable for short-term sprint, but schedule a tech-debt catchup within 2 sprints',
      };
    } else if (/reliab|stability|quality|fix/.test(lower)) {
      scenarioType = 'increase-reliability';
      adjustments = [
        { category: 'new-features', currentPct: 40, proposedPct: 25 },
        { category: 'tech-debt', currentPct: 25, proposedPct: 35 },
        { category: 'reliability', currentPct: 20, proposedPct: 30 },
        { category: 'exploration', currentPct: 15, proposedPct: 10 },
      ];
      predictedOutcome = {
        velocityChange: '-15% feature throughput in short term',
        riskChange: 'Tech risk decreases by ~25%, failure rates should drop',
        costChange: `Estimated monthly cost: $${(avgCost * totalRuns * 0.9).toFixed(2)}`,
        recommendation: 'Good investment if failure rate is above 20% — ROI typically seen within 4 weeks',
      };
    } else if (/reduce|cut|budget|save|cost/.test(lower)) {
      scenarioType = 'reduce-budget';
      adjustments = [
        { category: 'new-features', currentPct: 40, proposedPct: 35 },
        { category: 'tech-debt', currentPct: 25, proposedPct: 20 },
        { category: 'reliability', currentPct: 20, proposedPct: 25 },
        { category: 'exploration', currentPct: 15, proposedPct: 20 },
      ];
      predictedOutcome = {
        velocityChange: '-10% overall throughput',
        riskChange: 'Minimal immediate risk, but sustained cuts compound tech debt',
        costChange: `Estimated monthly cost: $${(avgCost * totalRuns * 0.75).toFixed(2)} (25% reduction)`,
        recommendation: 'Achievable with focused prioritization. Cut exploration last — it drives future velocity.',
      };
    } else if (/scale|grow|expand|hire/.test(lower)) {
      scenarioType = 'scale-up';
      adjustments = [
        { category: 'new-features', currentPct: 40, proposedPct: 45 },
        { category: 'tech-debt', currentPct: 25, proposedPct: 20 },
        { category: 'reliability', currentPct: 20, proposedPct: 20 },
        { category: 'exploration', currentPct: 15, proposedPct: 15 },
      ];
      predictedOutcome = {
        velocityChange: '+30% throughput with parallel pipelines',
        riskChange: 'Coordination overhead increases — consider guard rails',
        costChange: `Estimated monthly cost: $${(avgCost * totalRuns * 1.5).toFixed(2)} (50% increase)`,
        recommendation: 'Scaling is effective if pipeline success rate is above 75%. Otherwise fix reliability first.',
      };
    } else {
      scenarioType = 'custom';
      adjustments = [
        { category: 'new-features', currentPct: 40, proposedPct: 40 },
        { category: 'tech-debt', currentPct: 25, proposedPct: 25 },
        { category: 'reliability', currentPct: 20, proposedPct: 20 },
        { category: 'exploration', currentPct: 15, proposedPct: 15 },
      ];
      predictedOutcome = {
        velocityChange: 'No change from baseline',
        riskChange: 'No change from baseline',
        costChange: `Current monthly cost: $${(avgCost * totalRuns).toFixed(2)}`,
        recommendation: `Custom scenario "${scenario}" — adjust the allocation percentages manually to model changes.`,
      };
    }

    const result: WhatIfScenario = {
      id: randomUUID(),
      description: scenario,
      type: scenarioType,
      adjustments,
      predictedOutcome,
      runAt: Date.now(),
      confidence: Math.min(85, 30 + totalRuns * 4),
    };

    // Persist scenario
    this.data.scenarios.push(result);
    if (this.data.scenarios.length > 20) {
      this.data.scenarios = this.data.scenarios.slice(-20);
    }
    this.saveState();

    return result;
  }

  // ── OKR Generation ───────────────────────────────────────────

  /**
   * Generate engineering OKRs based on business goals and current data.
   */
  generateOkrs(goals?: string[]): Array<{
    objective: string;
    keyResults: Array<{ metric: string; current: number; target: number; unit: string }>;
    category: string;
    confidence: number;
  }> {
    const history = loadJson<Array<Record<string, unknown>>>(
      join(this.swarmDir, HISTORY_FILE),
      [],
    );
    const healthReport = loadJson<Record<string, unknown>>(
      join(this.swarmDir, HEALTH_FILE),
      {},
    );

    const totalRuns = history.length;

    // Compute current metrics
    let successRate = 0;
    let avgCost = 0;
    let avgDuration = 0;
    let avgFixIterations = 0;

    if (totalRuns > 0) {
      const successCount = history.filter(e => {
        const stages = e.stagesSummary as Record<string, string> | undefined;
        return stages && Object.values(stages).every(s => s === 'done' || s === 'skipped' || s === 'pending');
      }).length;
      successRate = Math.round((successCount / totalRuns) * 100);

      avgCost = history.reduce(
        (sum, e) => sum + ((e.totalCost as Record<string, number>)?.totalUsd ?? 0),
        0,
      ) / totalRuns;

      const durations = history.map(e => (e.durationMs as number) ?? 0).filter(d => d > 0);
      avgDuration = durations.length > 0 ? mean(durations) / 60000 : 0; // in minutes

      const fixIter = history.map(e => (e.fixIterations as number) ?? 0).filter(f => f > 0);
      avgFixIterations = fixIter.length > 0 ? mean(fixIter) : 0;
    }

    const healthScore = typeof healthReport.overallScore === 'number'
      ? (healthReport.overallScore as number)
      : 50;

    const okrs: Array<{
      objective: string;
      keyResults: Array<{ metric: string; current: number; target: number; unit: string }>;
      category: string;
      confidence: number;
    }> = [];

    // Generate OKRs from explicit goals
    if (goals && goals.length > 0) {
      for (const goal of goals) {
        const lower = goal.toLowerCase();
        if (/velocity|speed|fast|throughput/.test(lower)) {
          okrs.push({
            objective: 'Increase engineering velocity',
            keyResults: [
              { metric: 'Pipeline success rate', current: successRate, target: Math.min(95, successRate + 15), unit: '%' },
              { metric: 'Average pipeline duration', current: Math.round(avgDuration), target: Math.round(avgDuration * 0.7), unit: 'min' },
              { metric: 'Fix iterations per run', current: Math.round(avgFixIterations * 10) / 10, target: Math.max(1, Math.round((avgFixIterations * 0.6) * 10) / 10), unit: '' },
            ],
            category: 'velocity',
            confidence: Math.min(85, 30 + totalRuns * 4),
          });
        } else if (/quality|reliab|stable|bug/.test(lower)) {
          okrs.push({
            objective: 'Improve software quality and reliability',
            keyResults: [
              { metric: 'Pipeline success rate', current: successRate, target: Math.min(98, successRate + 10), unit: '%' },
              { metric: 'Project health score', current: healthScore, target: Math.min(95, healthScore + 20), unit: '/100' },
              { metric: 'Average cost per run', current: Math.round(avgCost * 100) / 100, target: Math.round(avgCost * 0.8 * 100) / 100, unit: '$' },
            ],
            category: 'quality',
            confidence: Math.min(85, 35 + totalRuns * 3),
          });
        } else if (/cost|budget|effic|roi/.test(lower)) {
          okrs.push({
            objective: 'Optimize engineering cost efficiency',
            keyResults: [
              { metric: 'Average cost per run', current: Math.round(avgCost * 100) / 100, target: Math.round(avgCost * 0.7 * 100) / 100, unit: '$' },
              { metric: 'Fix iterations per run', current: Math.round(avgFixIterations * 10) / 10, target: Math.max(1, Math.round((avgFixIterations * 0.5) * 10) / 10), unit: '' },
              { metric: 'Runs per month', current: totalRuns, target: Math.round(totalRuns * 1.3), unit: '' },
            ],
            category: 'efficiency',
            confidence: Math.min(80, 30 + totalRuns * 4),
          });
        } else {
          // Generic goal
          okrs.push({
            objective: `Achieve: ${goal}`,
            keyResults: [
              { metric: 'Pipeline success rate', current: successRate, target: Math.min(95, successRate + 10), unit: '%' },
              { metric: 'Project health score', current: healthScore, target: Math.min(90, healthScore + 15), unit: '/100' },
            ],
            category: 'custom',
            confidence: Math.min(70, 25 + totalRuns * 3),
          });
        }
      }
    }

    // Always generate baseline OKRs if none from goals
    if (okrs.length === 0) {
      // Reliability OKR
      if (successRate < 85) {
        okrs.push({
          objective: 'Improve pipeline reliability',
          keyResults: [
            { metric: 'Pipeline success rate', current: successRate, target: Math.min(90, successRate + 15), unit: '%' },
            { metric: 'Fix iterations per run', current: Math.round(avgFixIterations * 10) / 10, target: Math.max(1, Math.round((avgFixIterations * 0.7) * 10) / 10), unit: '' },
          ],
          category: 'reliability',
          confidence: Math.min(80, 30 + totalRuns * 4),
        });
      }

      // Efficiency OKR
      okrs.push({
        objective: 'Increase development efficiency',
        keyResults: [
          { metric: 'Average pipeline duration', current: Math.round(avgDuration), target: Math.round(avgDuration * 0.75), unit: 'min' },
          { metric: 'Average cost per run', current: Math.round(avgCost * 100) / 100, target: Math.round(avgCost * 0.8 * 100) / 100, unit: '$' },
        ],
        category: 'efficiency',
        confidence: Math.min(80, 30 + totalRuns * 4),
      });

      // Health OKR
      if (healthScore < 75) {
        okrs.push({
          objective: 'Improve project health',
          keyResults: [
            { metric: 'Project health score', current: healthScore, target: Math.min(85, healthScore + 20), unit: '/100' },
            { metric: 'Pipeline success rate', current: successRate, target: Math.min(90, successRate + 10), unit: '%' },
          ],
          category: 'health',
          confidence: Math.min(75, 25 + totalRuns * 3),
        });
      }
    }

    this.data.okrs = okrs;
    this.data.lastGenerated = Date.now();
    this.saveState();

    return okrs;
  }

  // ── State Access ─────────────────────────────────────────────

  getState(): AllocateState {
    return { ...this.data };
  }

  // ── Private scoring helpers ──────────────────────────────────

  private computeBusinessImpact(
    history: Array<Record<string, unknown>>,
    impactReports: Array<Record<string, unknown>>,
  ): number {
    if (history.length === 0) return 30;

    let score = 50;

    // More runs = more business activity
    if (history.length > 20) score += 10;
    if (history.length > 50) score += 10;

    // Impact reports show awareness
    if (impactReports.length > 0) score += 10;

    // Cost efficiency signals business value
    const costs = history.map(e => ((e.totalCost as Record<string, number>)?.totalUsd ?? 0)).filter(c => c > 0);
    if (costs.length > 0) {
      const avgCost = mean(costs);
      if (avgCost < 5) score += 5; // Very efficient
      if (avgCost > 20) score -= 5; // Getting expensive
    }

    return Math.min(100, Math.max(0, score));
  }

  private computeTechRisk(
    history: Array<Record<string, unknown>>,
    healthReport: Record<string, unknown>,
  ): number {
    if (history.length === 0) return 50;

    let score = 30;

    // Failure rate drives tech risk
    const failedRuns = history.filter(e => {
      const stages = e.stagesSummary as Record<string, string> | undefined;
      return stages && Object.values(stages).some(s => s === 'error');
    }).length;

    const failRate = failedRuns / history.length;
    score += failRate * 50;

    // Fix iterations indicate tech complexity
    const fixIter = history.map(e => (e.fixIterations as number) ?? 0).filter(f => f > 0);
    if (fixIter.length > 0 && mean(fixIter) > 3) {
      score += 15;
    }

    // Health score inversely correlates
    if (typeof healthReport.overallScore === 'number') {
      const health = healthReport.overallScore as number;
      score += (100 - health) * 0.2;
    }

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  private computeUserImpact(history: Array<Record<string, unknown>>): number {
    if (history.length === 0) return 30;

    let score = 40;

    // Active usage
    if (history.length > 10) score += 15;
    if (history.length > 30) score += 10;

    // Variety of features requested
    const features = new Set(history.map(e => String(e.featureRequest ?? '')).filter(Boolean));
    if (features.size > 5) score += 10;
    if (features.size > 15) score += 10;

    // Success rate affects user satisfaction
    const successCount = history.filter(e => {
      const stages = e.stagesSummary as Record<string, string> | undefined;
      return stages && Object.values(stages).every(s => s === 'done' || s === 'skipped' || s === 'pending');
    }).length;
    const successRate = successCount / history.length;
    score += successRate * 15;

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  private computeAllocations(
    businessScore: number,
    techRiskScore: number,
    userImpactScore: number,
    history: Array<Record<string, unknown>>,
  ): AllocationRecommendation['allocations'] {
    // Base allocations
    let features = 40;
    let techDebt = 25;
    let reliability = 20;
    let exploration = 15;

    // Adjust based on scores
    if (techRiskScore > 70) {
      techDebt += 10;
      reliability += 5;
      features -= 10;
      exploration -= 5;
    } else if (techRiskScore < 30) {
      techDebt -= 10;
      features += 5;
      exploration += 5;
    }

    if (businessScore > 70) {
      features += 5;
      exploration -= 5;
    }

    if (userImpactScore < 40) {
      features -= 5;
      exploration += 5;
    }

    // Normalize to 100%
    const total = features + techDebt + reliability + exploration;
    features = Math.round((features / total) * 100);
    techDebt = Math.round((techDebt / total) * 100);
    reliability = Math.round((reliability / total) * 100);
    exploration = 100 - features - techDebt - reliability; // remainder

    return [
      {
        category: 'new-features',
        percentage: features,
        rationale: businessScore > 70
          ? 'Strong business signals support feature investment'
          : 'Balanced feature allocation based on current metrics',
      },
      {
        category: 'tech-debt',
        percentage: techDebt,
        rationale: techRiskScore > 70
          ? 'Elevated tech risk demands increased debt paydown'
          : 'Standard tech debt allocation',
      },
      {
        category: 'reliability',
        percentage: reliability,
        rationale: techRiskScore > 50
          ? 'Above-average failure rate needs reliability investment'
          : 'Maintain current reliability standards',
      },
      {
        category: 'exploration',
        percentage: exploration,
        rationale: 'R&D and experimentation budget for future capabilities',
      },
    ];
  }
}
