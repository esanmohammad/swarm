import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HistoryEntry, ImpactMetric, ImpactReport } from '../types.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function parsePeriod(period: string): number {
  const lower = period.toLowerCase().trim();

  // "last N days"
  const daysMatch = lower.match(/(\d+)\s*days?/);
  if (daysMatch) return parseInt(daysMatch[1]) * 86400000;

  // "last N weeks"
  const weeksMatch = lower.match(/(\d+)\s*weeks?/);
  if (weeksMatch) return parseInt(weeksMatch[1]) * 7 * 86400000;

  // "last N months"
  const monthsMatch = lower.match(/(\d+)\s*months?/);
  if (monthsMatch) return parseInt(monthsMatch[1]) * 30 * 86400000;

  // "last quarter"
  if (lower.includes('quarter')) return 90 * 86400000;

  // "last year"
  if (lower.includes('year')) return 365 * 86400000;

  // Default: 30 days
  return 30 * 86400000;
}

function formatPeriodLabel(periodMs: number): string {
  const days = Math.round(periodMs / 86400000);
  if (days <= 7) return `last ${days} days`;
  if (days <= 31) return `last ${Math.round(days / 7)} weeks`;
  if (days <= 100) return `last ${Math.round(days / 30)} months`;
  if (days <= 365) return `last ${Math.round(days / 30)} months`;
  return `last ${Math.round(days / 365)} years`;
}

// ── Impact Analyzer ─────────────────────────────────────────────────────────

export class ImpactAnalyzer {
  private reportsPath: string;

  constructor(swarmDir: string) {
    this.reportsPath = join(swarmDir, 'impact-reports.json');
  }

  /**
   * Load persisted impact reports.
   */
  private loadReports(): ImpactReport[] {
    if (!existsSync(this.reportsPath)) return [];
    try {
      return JSON.parse(readFileSync(this.reportsPath, 'utf-8'));
    } catch {
      return [];
    }
  }

  /**
   * Persist impact reports.
   */
  private saveReports(reports: ImpactReport[]): void {
    writeFileSync(this.reportsPath, JSON.stringify(reports, null, 2));
  }

  /**
   * Analyze business impact for a given period.
   */
  analyzePeriod(history: HistoryEntry[], period: string, hourlyRate: number): ImpactReport {
    const periodMs = parsePeriod(period);
    const cutoff = Date.now() - periodMs;
    const recent = history.filter(h => h.timestamp >= cutoff);
    const periodLabel = formatPeriodLabel(periodMs);

    // Group runs by feature request (or "unnamed")
    const featureMap = new Map<string, HistoryEntry[]>();
    for (const entry of recent) {
      const name = entry.featureRequest || 'unnamed pipeline run';
      const existing = featureMap.get(name) || [];
      existing.push(entry);
      featureMap.set(name, existing);
    }

    const features: ImpactReport['features'] = [];
    let totalSwarmCost = 0;
    let totalEstimatedValue = 0;

    for (const [name, entries] of featureMap) {
      const cost = entries.reduce((sum, e) => sum + e.totalCost.totalUsd, 0);
      totalSwarmCost += cost;

      const metrics = this.computeFeatureMetrics(entries, hourlyRate);
      const featureValue = metrics.reduce((sum, m) => sum + (m.monetaryValue ?? 0), 0);
      totalEstimatedValue += featureValue;

      features.push({
        name,
        metrics,
        totalValue: Math.round(featureValue * 100) / 100,
        cost: Math.round(cost * 100) / 100,
      });
    }

    // Sort by value descending
    features.sort((a, b) => b.totalValue - a.totalValue);

    const multiple = totalSwarmCost > 0 ? totalEstimatedValue / totalSwarmCost : 0;

    const highlights = this.generateHighlights(recent, features, totalSwarmCost, totalEstimatedValue);

    const report: ImpactReport = {
      period: periodLabel,
      features,
      roi: {
        swarmCost: Math.round(totalSwarmCost * 100) / 100,
        estimatedValue: Math.round(totalEstimatedValue * 100) / 100,
        multiple: Math.round(multiple * 10) / 10,
      },
      highlights,
      timestamp: Date.now(),
    };

    // Persist
    const reports = this.loadReports();
    reports.push(report);
    // Keep only last 50 reports
    if (reports.length > 50) reports.splice(0, reports.length - 50);
    this.saveReports(reports);

    return report;
  }

  /**
   * Estimate impact before building a feature.
   */
  estimateImpact(feature: string, history: HistoryEntry[], hourlyRate: number): {
    estimatedCost: number;
    estimatedValue: number;
    estimatedRoi: number;
    breakdown: Array<{ label: string; hours: number; value: number }>;
    confidence: number;
  } {
    // Estimate cost from historical average
    const costs = history.map(h => h.totalCost.totalUsd).filter(c => c > 0);
    const avgCost = mean(costs);
    const durations = history.map(h => h.durationMs).filter(d => d > 0);
    const avgDurationMs = mean(durations);

    // Complexity multiplier from feature description
    const lower = feature.toLowerCase();
    let complexityMult = 1.0;
    if (/refactor|rewrite|migration|migrate/.test(lower)) complexityMult += 0.5;
    if (/multiple|several|many|across/.test(lower)) complexityMult += 0.3;
    if (/simple|small|minor|quick/.test(lower)) complexityMult -= 0.3;
    if (/api|integration|external/.test(lower)) complexityMult += 0.2;
    if (lower.length > 200) complexityMult += 0.2;
    complexityMult = Math.max(0.3, complexityMult);

    const estimatedCost = avgCost * complexityMult;

    // Estimate value: developer hours saved
    const avgDurationHours = avgDurationMs / 3600000;
    // Assume Swarm replaces ~3x the time a developer would need manually
    const manualMultiplier = 3.0;
    const hoursSaved = avgDurationHours * manualMultiplier * complexityMult;

    const breakdown = [
      { label: 'Development time saved', hours: hoursSaved * 0.5, value: hoursSaved * 0.5 * hourlyRate },
      { label: 'Code review time saved', hours: hoursSaved * 0.15, value: hoursSaved * 0.15 * hourlyRate },
      { label: 'Testing automation', hours: hoursSaved * 0.2, value: hoursSaved * 0.2 * hourlyRate },
      { label: 'Documentation & planning', hours: hoursSaved * 0.15, value: hoursSaved * 0.15 * hourlyRate },
    ];

    const estimatedValue = breakdown.reduce((sum, b) => sum + b.value, 0);
    const estimatedRoi = estimatedCost > 0 ? estimatedValue / estimatedCost : 0;

    // Confidence based on data points
    const confidence = Math.min(95, Math.round(40 + costs.length * 8));

    return {
      estimatedCost: Math.round(estimatedCost * 100) / 100,
      estimatedValue: Math.round(estimatedValue * 100) / 100,
      estimatedRoi: Math.round(estimatedRoi * 10) / 10,
      breakdown: breakdown.map(b => ({
        label: b.label,
        hours: Math.round(b.hours * 10) / 10,
        value: Math.round(b.value * 100) / 100,
      })),
      confidence,
    };
  }

  /**
   * Calculate Swarm's own ROI across all history.
   */
  calculateRoi(history: HistoryEntry[], hourlyRate: number): {
    totalSwarmCost: number;
    totalHoursSaved: number;
    totalValueGenerated: number;
    roiMultiple: number;
    costPerRun: number;
    valuePerRun: number;
    breakEvenRuns: number;
    monthlyTrend: Array<{ month: string; cost: number; value: number; roi: number }>;
  } {
    const totalSwarmCost = history.reduce((sum, h) => sum + h.totalCost.totalUsd, 0);

    // Estimate hours saved per run
    const manualMultiplier = 3.0;
    let totalHoursSaved = 0;
    for (const entry of history) {
      const durationHours = entry.durationMs / 3600000;
      totalHoursSaved += durationHours * manualMultiplier;
    }

    const totalValueGenerated = totalHoursSaved * hourlyRate;
    const roiMultiple = totalSwarmCost > 0 ? totalValueGenerated / totalSwarmCost : 0;
    const costPerRun = history.length > 0 ? totalSwarmCost / history.length : 0;
    const valuePerRun = history.length > 0 ? totalValueGenerated / history.length : 0;

    // Break-even: how many runs needed for ROI > 1x
    const breakEvenRuns = valuePerRun > 0 && costPerRun > 0
      ? Math.ceil(totalSwarmCost / valuePerRun)
      : 0;

    // Monthly trend
    const monthMap = new Map<string, { cost: number; hoursSaved: number }>();
    for (const entry of history) {
      const d = new Date(entry.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const existing = monthMap.get(key) || { cost: 0, hoursSaved: 0 };
      existing.cost += entry.totalCost.totalUsd;
      existing.hoursSaved += (entry.durationMs / 3600000) * manualMultiplier;
      monthMap.set(key, existing);
    }

    const monthlyTrend = Array.from(monthMap.entries())
      .map(([month, data]) => ({
        month,
        cost: Math.round(data.cost * 100) / 100,
        value: Math.round(data.hoursSaved * hourlyRate * 100) / 100,
        roi: data.cost > 0 ? Math.round((data.hoursSaved * hourlyRate / data.cost) * 10) / 10 : 0,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return {
      totalSwarmCost: Math.round(totalSwarmCost * 100) / 100,
      totalHoursSaved: Math.round(totalHoursSaved * 10) / 10,
      totalValueGenerated: Math.round(totalValueGenerated * 100) / 100,
      roiMultiple: Math.round(roiMultiple * 10) / 10,
      costPerRun: Math.round(costPerRun * 100) / 100,
      valuePerRun: Math.round(valuePerRun * 100) / 100,
      breakEvenRuns,
      monthlyTrend,
    };
  }

  /**
   * Get the latest saved report, or null.
   */
  getReport(): ImpactReport | null {
    const reports = this.loadReports();
    return reports.length > 0 ? reports[reports.length - 1] : null;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private computeFeatureMetrics(entries: HistoryEntry[], hourlyRate: number): ImpactMetric[] {
    const metrics: ImpactMetric[] = [];

    // Time savings metric
    const totalDurationMs = entries.reduce((sum, e) => sum + e.durationMs, 0);
    const durationHours = totalDurationMs / 3600000;
    const manualEstimate = durationHours * 3.0; // Swarm is ~3x faster than manual
    const hoursSaved = manualEstimate - durationHours;
    const timeSavingsValue = hoursSaved * hourlyRate;

    metrics.push({
      name: 'Developer time savings',
      source: 'pipeline-duration',
      before: Math.round(manualEstimate * 10) / 10,
      after: Math.round(durationHours * 10) / 10,
      changePercent: manualEstimate > 0 ? Math.round(((manualEstimate - durationHours) / manualEstimate) * 100) : 0,
      monetaryValue: Math.round(timeSavingsValue * 100) / 100,
      confidence: Math.min(90, 50 + entries.length * 10),
    });

    // Quality metric (success rate)
    const passed = entries.filter(e => {
      const statuses = Object.values(e.stagesSummary);
      return statuses.every(s => s === 'done' || s === 'skipped' || s === 'pending');
    }).length;
    const successRate = entries.length > 0 ? (passed / entries.length) * 100 : 0;

    metrics.push({
      name: 'Pipeline success rate',
      source: 'pipeline-history',
      before: 0, // Unknown baseline
      after: Math.round(successRate),
      changePercent: Math.round(successRate),
      confidence: Math.min(85, 40 + entries.length * 10),
    });

    // Fix iteration efficiency
    const fixCounts = entries.filter(e => e.fixIterations !== undefined).map(e => e.fixIterations!);
    if (fixCounts.length > 0) {
      const avgFixes = mean(fixCounts);
      // Fewer fix iterations = less rework
      const reworkHoursSaved = avgFixes * 0.5 * hourlyRate; // ~30min per fix iteration saved vs manual debugging
      metrics.push({
        name: 'Automated fix loop savings',
        source: 'fix-iterations',
        before: avgFixes * 2, // Manual debugging would take ~2x iterations
        after: Math.round(avgFixes * 10) / 10,
        changePercent: 50, // ~50% fewer iterations than manual
        monetaryValue: Math.round(reworkHoursSaved * 100) / 100,
        confidence: Math.min(80, 35 + fixCounts.length * 10),
      });
    }

    return metrics;
  }

  private generateHighlights(
    entries: HistoryEntry[],
    features: ImpactReport['features'],
    totalCost: number,
    totalValue: number,
  ): string[] {
    const highlights: string[] = [];

    if (entries.length === 0) {
      highlights.push('No pipeline runs in the selected period.');
      return highlights;
    }

    highlights.push(`${entries.length} pipeline runs analyzed.`);

    if (totalValue > totalCost) {
      const multiple = totalCost > 0 ? (totalValue / totalCost).toFixed(1) : '∞';
      highlights.push(`Estimated ${multiple}x return on Swarm investment.`);
    }

    // Top feature by value
    if (features.length > 0 && features[0].totalValue > 0) {
      highlights.push(`Highest-value feature: "${features[0].name}" ($${features[0].totalValue.toFixed(2)} estimated value).`);
    }

    // Total cost
    highlights.push(`Total Swarm cost: $${totalCost.toFixed(2)}.`);

    // Success rate
    const passed = entries.filter(e => {
      const statuses = Object.values(e.stagesSummary);
      return statuses.every(s => s === 'done' || s === 'skipped' || s === 'pending');
    }).length;
    const rate = Math.round((passed / entries.length) * 100);
    highlights.push(`Overall success rate: ${rate}%.`);

    return highlights;
  }
}
