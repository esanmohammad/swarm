import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PerformanceRecord, StrategyAnalysis, SelfImprovementData, HistoryEntry } from '../types.js';

const STATE_FILE = 'self-improvement.json';
const HISTORY_FILE = 'history.json';

function emptyState(): SelfImprovementData {
  return {
    records: [],
    strategies: [],
    tuning: {
      modelOverrides: {},
      strategyOverrides: {},
      promptVariants: [],
    },
  };
}

export class SelfImprovementEngine {
  private swarmDir: string;
  private data: SelfImprovementData;

  constructor(swarmDir: string) {
    this.swarmDir = swarmDir;
    this.data = this.loadState();
  }

  // ── Persistence ──────────────────────────────────────────────

  private loadState(): SelfImprovementData {
    const filePath = join(this.swarmDir, STATE_FILE);
    if (!existsSync(filePath)) return emptyState();
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as SelfImprovementData;
    } catch {
      return emptyState();
    }
  }

  private saveState(): void {
    const filePath = join(this.swarmDir, STATE_FILE);
    writeFileSync(filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  private loadHistory(): HistoryEntry[] {
    const filePath = join(this.swarmDir, HISTORY_FILE);
    if (!existsSync(filePath)) return [];
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as HistoryEntry[];
    } catch {
      return [];
    }
  }

  // ── Record a run ─────────────────────────────────────────────

  recordRun(record: PerformanceRecord): void {
    this.data.records.push(record);
    // Keep at most 500 records
    if (this.data.records.length > 500) {
      this.data.records = this.data.records.slice(-500);
    }
    this.saveState();
  }

  // ── Analyze runs ─────────────────────────────────────────────

  analyze(count = 50): StrategyAnalysis[] {
    const history = this.loadHistory();
    const records = this.data.records;

    // Use the most recent N records
    const recent = records.slice(-count);

    if (recent.length === 0 && history.length === 0) {
      return [];
    }

    // Group by strategy + taskType
    const groups = new Map<string, PerformanceRecord[]>();
    for (const rec of recent) {
      const key = `${rec.strategy}::${rec.taskType}`;
      const list = groups.get(key) ?? [];
      list.push(rec);
      groups.set(key, list);
    }

    // Also derive records from history if self-improvement records are sparse
    if (recent.length < 5) {
      const recentHistory = history.slice(-count);
      for (const entry of recentHistory) {
        const key = `default::${entry.stack}`;
        const existing = groups.get(key) ?? [];
        existing.push({
          runId: entry.runId,
          timestamp: entry.timestamp,
          taskType: entry.stack,
          predictedCost: 0,
          actualCost: entry.totalCost.totalUsd,
          predictedDuration: 0,
          actualDuration: entry.durationMs,
          testPassFirstAttempt: (entry.fixIterations ?? 0) === 0,
          fixIterations: entry.fixIterations ?? 0,
          humanEditRate: 0,
          reverted: false,
          postMergeIncident: false,
          model: entry.model ?? 'unknown',
          strategy: 'default',
        });
        groups.set(key, existing);
      }
    }

    const strategies: StrategyAnalysis[] = [];
    for (const [key, recs] of groups) {
      const [strategy, taskType] = key.split('::');
      const successCount = recs.filter(r => !r.reverted && !r.postMergeIncident).length;
      const successRate = recs.length > 0 ? Math.round((successCount / recs.length) * 100) : 0;
      const avgCost = recs.length > 0 ? recs.reduce((s, r) => s + r.actualCost, 0) / recs.length : 0;
      const avgDuration = recs.length > 0 ? recs.reduce((s, r) => s + r.actualDuration, 0) / recs.length : 0;

      let recommendation = 'Keep current approach.';
      if (successRate < 50 && recs.length >= 3) {
        recommendation = 'Strategy has low success rate — consider switching models or prompts.';
      } else if (avgCost > 10) {
        recommendation = 'High average cost — try a cheaper model for early stages.';
      } else if (recs.some(r => r.fixIterations > 3)) {
        recommendation = 'Frequent fix iterations — improve test clarity or code quality prompts.';
      }

      strategies.push({
        strategy,
        taskType,
        successRate,
        avgCost: Math.round(avgCost * 100) / 100,
        avgDuration: Math.round(avgDuration),
        sampleSize: recs.length,
        recommendation,
      });
    }

    this.data.strategies = strategies;
    this.saveState();
    return strategies;
  }

  // ── Model effectiveness ──────────────────────────────────────

  getModelEffectiveness(): Array<{ model: string; runs: number; successRate: number; avgCost: number; avgFixIterations: number }> {
    const records = this.data.records;
    const modelMap = new Map<string, PerformanceRecord[]>();

    for (const rec of records) {
      const list = modelMap.get(rec.model) ?? [];
      list.push(rec);
      modelMap.set(rec.model, list);
    }

    return Array.from(modelMap.entries()).map(([model, recs]) => {
      const successes = recs.filter(r => !r.reverted && !r.postMergeIncident).length;
      return {
        model,
        runs: recs.length,
        successRate: recs.length > 0 ? Math.round((successes / recs.length) * 100) : 0,
        avgCost: recs.length > 0 ? Math.round((recs.reduce((s, r) => s + r.actualCost, 0) / recs.length) * 100) / 100 : 0,
        avgFixIterations: recs.length > 0 ? Math.round((recs.reduce((s, r) => s + r.fixIterations, 0) / recs.length) * 10) / 10 : 0,
      };
    }).sort((a, b) => b.successRate - a.successRate);
  }

  // ── Recommendations ──────────────────────────────────────────

  getRecommendations(): string[] {
    const recommendations: string[] = [];
    const records = this.data.records;
    const strategies = this.data.strategies;

    if (records.length < 3) {
      recommendations.push('Not enough data yet — run more pipelines to generate recommendations.');
      return recommendations;
    }

    // Cost estimation accuracy
    const withPredictions = records.filter(r => r.predictedCost > 0);
    if (withPredictions.length > 0) {
      const avgError = withPredictions.reduce((s, r) => s + Math.abs(r.actualCost - r.predictedCost), 0) / withPredictions.length;
      if (avgError > 2) {
        recommendations.push(`Cost predictions are off by $${avgError.toFixed(2)} on average — calibrate budget estimates.`);
      }
    }

    // Duration estimation accuracy
    const withDuration = records.filter(r => r.predictedDuration > 0);
    if (withDuration.length > 0) {
      const avgDurError = withDuration.reduce((s, r) => {
        return s + Math.abs(r.actualDuration - r.predictedDuration) / Math.max(r.predictedDuration, 1);
      }, 0) / withDuration.length;
      if (avgDurError > 0.5) {
        recommendations.push(`Duration estimates are off by ${(avgDurError * 100).toFixed(0)}% on average — adjust time expectations.`);
      }
    }

    // First-attempt pass rate
    const firstAttemptPass = records.filter(r => r.testPassFirstAttempt).length / records.length;
    if (firstAttemptPass < 0.3) {
      recommendations.push(`Only ${(firstAttemptPass * 100).toFixed(0)}% of runs pass tests on the first attempt — consider improving prompts or adding pre-build validation.`);
    }

    // Human edit rate
    const avgHumanEdits = records.reduce((s, r) => s + r.humanEditRate, 0) / records.length;
    if (avgHumanEdits > 0.3) {
      recommendations.push(`Human edit rate is ${(avgHumanEdits * 100).toFixed(0)}% — agents may need better context or conventions.`);
    }

    // Revert rate
    const revertRate = records.filter(r => r.reverted).length / records.length;
    if (revertRate > 0.1) {
      recommendations.push(`${(revertRate * 100).toFixed(0)}% of runs were reverted — add stricter guardrails or approval gates.`);
    }

    // Model-specific recommendations
    const modelEffectiveness = this.getModelEffectiveness();
    if (modelEffectiveness.length >= 2) {
      const best = modelEffectiveness[0];
      const worst = modelEffectiveness[modelEffectiveness.length - 1];
      if (best.successRate - worst.successRate > 20 && worst.runs >= 3) {
        recommendations.push(`Model "${best.model}" outperforms "${worst.model}" by ${best.successRate - worst.successRate}pp — consider switching.`);
      }
    }

    // Low-performing strategies
    for (const strat of strategies) {
      if (strat.successRate < 40 && strat.sampleSize >= 5) {
        recommendations.push(`Strategy "${strat.strategy}" for "${strat.taskType}" has only ${strat.successRate}% success — try an alternative approach.`);
      }
    }

    return recommendations;
  }

  // ── Report generation ────────────────────────────────────────

  generateReport(): NonNullable<SelfImprovementData['report']> {
    const records = this.data.records;
    const midpoint = Math.floor(records.length / 2);
    const previous = records.slice(0, midpoint);
    const current = records.slice(midpoint);

    const calcMetric = (recs: PerformanceRecord[], fn: (r: PerformanceRecord) => number): number => {
      return recs.length > 0 ? recs.reduce((s, r) => s + fn(r), 0) / recs.length : 0;
    };

    const round2 = (n: number) => Math.round(n * 100) / 100;

    const accuracyTrend = [
      {
        metric: 'Cost estimation accuracy',
        current: round2(calcMetric(current, r => r.predictedCost > 0 ? 1 - Math.abs(r.actualCost - r.predictedCost) / Math.max(r.predictedCost, 0.01) : 0)),
        previous: round2(calcMetric(previous, r => r.predictedCost > 0 ? 1 - Math.abs(r.actualCost - r.predictedCost) / Math.max(r.predictedCost, 0.01) : 0)),
        change: 0,
      },
      {
        metric: 'Duration estimation accuracy',
        current: round2(calcMetric(current, r => r.predictedDuration > 0 ? 1 - Math.abs(r.actualDuration - r.predictedDuration) / Math.max(r.predictedDuration, 1) : 0)),
        previous: round2(calcMetric(previous, r => r.predictedDuration > 0 ? 1 - Math.abs(r.actualDuration - r.predictedDuration) / Math.max(r.predictedDuration, 1) : 0)),
        change: 0,
      },
    ];
    for (const t of accuracyTrend) {
      t.change = round2(t.current - t.previous);
    }

    const qualityTrend = [
      {
        metric: 'First-attempt pass rate',
        current: round2(current.length > 0 ? current.filter(r => r.testPassFirstAttempt).length / current.length : 0),
        previous: round2(previous.length > 0 ? previous.filter(r => r.testPassFirstAttempt).length / previous.length : 0),
        change: 0,
      },
      {
        metric: 'Revert rate',
        current: round2(current.length > 0 ? current.filter(r => r.reverted).length / current.length : 0),
        previous: round2(previous.length > 0 ? previous.filter(r => r.reverted).length / previous.length : 0),
        change: 0,
      },
    ];
    for (const t of qualityTrend) {
      t.change = round2(t.current - t.previous);
    }

    const efficiencyTrend = [
      {
        metric: 'Average cost per run',
        current: round2(calcMetric(current, r => r.actualCost)),
        previous: round2(calcMetric(previous, r => r.actualCost)),
        change: 0,
      },
      {
        metric: 'Average fix iterations',
        current: round2(calcMetric(current, r => r.fixIterations)),
        previous: round2(calcMetric(previous, r => r.fixIterations)),
        change: 0,
      },
      {
        metric: 'Human edit rate',
        current: round2(calcMetric(current, r => r.humanEditRate)),
        previous: round2(calcMetric(previous, r => r.humanEditRate)),
        change: 0,
      },
    ];
    for (const t of efficiencyTrend) {
      t.change = round2(t.current - t.previous);
    }

    const report: NonNullable<SelfImprovementData['report']> = {
      period: `Last ${records.length} runs (${current.length} recent vs ${previous.length} prior)`,
      accuracyTrend,
      qualityTrend,
      efficiencyTrend,
      recommendations: this.getRecommendations(),
      generatedAt: Date.now(),
    };

    this.data.report = report;
    this.saveState();
    return report;
  }

  // ── Auto-tuning ──────────────────────────────────────────────

  applyTuning(): { applied: string[] } {
    const applied: string[] = [];
    const strategies = this.data.strategies;

    // Model tuning: pick the best model per task type based on success rate
    const taskModels = new Map<string, { model: string; score: number }>();
    for (const rec of this.data.records) {
      const key = rec.taskType;
      const score = (!rec.reverted && !rec.postMergeIncident ? 1 : 0) - rec.fixIterations * 0.1;
      const existing = taskModels.get(key);
      if (!existing || score > existing.score) {
        taskModels.set(key, { model: rec.model, score });
      }
    }

    for (const [taskType, { model }] of taskModels) {
      if (!this.data.tuning.modelOverrides[taskType] || this.data.tuning.modelOverrides[taskType] !== model) {
        this.data.tuning.modelOverrides[taskType] = model;
        applied.push(`Set model for "${taskType}" tasks to "${model}"`);
      }
    }

    // Strategy tuning: pick the best strategy per task type
    const taskStrategies = new Map<string, StrategyAnalysis>();
    for (const strat of strategies) {
      const existing = taskStrategies.get(strat.taskType);
      if (!existing || strat.successRate > existing.successRate) {
        taskStrategies.set(strat.taskType, strat);
      }
    }

    for (const [taskType, strat] of taskStrategies) {
      if (!this.data.tuning.strategyOverrides[taskType] || this.data.tuning.strategyOverrides[taskType] !== strat.strategy) {
        this.data.tuning.strategyOverrides[taskType] = strat.strategy;
        applied.push(`Set strategy for "${taskType}" tasks to "${strat.strategy}"`);
      }
    }

    // Prompt variant scoring: mark effective variants higher
    for (const variant of this.data.tuning.promptVariants) {
      const relatedRecords = this.data.records.filter(r => r.strategy === variant.variant);
      if (relatedRecords.length >= 3) {
        const success = relatedRecords.filter(r => !r.reverted).length / relatedRecords.length;
        const newScore = Math.round(success * 100);
        if (newScore !== variant.effectivenessScore) {
          variant.effectivenessScore = newScore;
          applied.push(`Updated effectiveness score for prompt variant "${variant.variant}" (${variant.persona}) to ${newScore}`);
        }
      }
    }

    if (applied.length === 0) {
      applied.push('No tuning changes needed — current configuration is optimal.');
    }

    this.saveState();
    return { applied };
  }

  resetTuning(): void {
    this.data.tuning = {
      modelOverrides: {},
      strategyOverrides: {},
      promptVariants: [],
    };
    this.data.report = undefined;
    this.saveState();
  }

  // ── State access ─────────────────────────────────────────────

  getState(): SelfImprovementData {
    return this.data;
  }
}
