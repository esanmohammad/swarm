import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ScopeOption, NegotiateState, HistoryEntry } from '../types.js';

export type Audience = 'engineer' | 'pm' | 'executive' | 'customer';

export interface FeasibilityResult {
  id: string;
  request: string;
  feasible: boolean;
  confidence: number;
  reasoning: string;
  options: ScopeOption[];
  risks: string[];
  assumptions: string[];
  audience: Audience;
  deadline?: string;
  velocityBaseline: number;
  createdAt: number;
}

export interface StatusReport {
  id: string;
  period: string;
  audience: Audience;
  content: string;
  metrics: {
    pipelinesRun: number;
    successRate: number;
    avgCost: number;
    avgDuration: number;
    tasksCompleted: number;
  };
  generatedAt: number;
}

export class StakeholderEngine {
  private swarmDir: string;
  private statePath: string;
  private historyPath: string;

  constructor(swarmDir: string) {
    this.swarmDir = swarmDir;
    this.statePath = join(swarmDir, 'negotiate-state.json');
    this.historyPath = join(swarmDir, 'history.json');
  }

  getState(): NegotiateState {
    if (existsSync(this.statePath)) {
      try {
        return JSON.parse(readFileSync(this.statePath, 'utf-8'));
      } catch {
        // Corrupt state, return fresh
      }
    }
    return { negotiations: [], reports: [], channels: [] };
  }

  private saveState(state: NegotiateState): void {
    if (!existsSync(this.swarmDir)) {
      mkdirSync(this.swarmDir, { recursive: true });
    }
    writeFileSync(this.statePath, JSON.stringify(state, null, 2));
  }

  private loadHistory(): HistoryEntry[] {
    if (!existsSync(this.historyPath)) return [];
    try {
      return JSON.parse(readFileSync(this.historyPath, 'utf-8'));
    } catch {
      return [];
    }
  }

  private computeVelocity(): { tasksPerWeek: number; avgCostPerRun: number; avgDurationMs: number; successRate: number } {
    const history = this.loadHistory();
    if (history.length === 0) {
      return { tasksPerWeek: 0, avgCostPerRun: 0, avgDurationMs: 0, successRate: 0 };
    }

    const now = Date.now();
    const oneWeekAgo = now - 7 * 86400000;
    const recentRuns = history.filter(h => h.timestamp >= oneWeekAgo);
    const tasksPerWeek = recentRuns.length;

    const totalCost = history.reduce((sum, h) => sum + h.totalCost.totalUsd, 0);
    const avgCostPerRun = totalCost / history.length;

    const totalDuration = history.reduce((sum, h) => sum + h.durationMs, 0);
    const avgDurationMs = totalDuration / history.length;

    const successfulRuns = history.filter(h => {
      const stages = Object.values(h.stagesSummary);
      return stages.every(s => s === 'done' || s === 'skipped' || s === 'pending');
    });
    const successRate = (successfulRuns.length / history.length) * 100;

    return { tasksPerWeek, avgCostPerRun, avgDurationMs, successRate };
  }

  private estimateEffort(request: string): { complexity: 'small' | 'medium' | 'large' | 'epic'; estimatedDays: number; estimatedCost: number } {
    const lower = request.toLowerCase();
    const words = lower.split(/\s+/).length;

    // Heuristic complexity scoring
    let score = 0;

    // Length-based: longer requests tend to describe larger work
    if (words > 50) score += 3;
    else if (words > 25) score += 2;
    else if (words > 10) score += 1;

    // Keyword signals
    const epicKeywords = ['rewrite', 'redesign', 'migrate', 'overhaul', 'platform', 'architecture', 'infrastructure'];
    const largeKeywords = ['refactor', 'implement', 'integrate', 'dashboard', 'api', 'system', 'pipeline', 'service'];
    const mediumKeywords = ['add', 'create', 'update', 'modify', 'enhance', 'extend', 'feature'];
    const smallKeywords = ['fix', 'tweak', 'rename', 'typo', 'bump', 'style', 'config'];

    if (epicKeywords.some(k => lower.includes(k))) score += 4;
    if (largeKeywords.some(k => lower.includes(k))) score += 2;
    if (mediumKeywords.some(k => lower.includes(k))) score += 1;
    if (smallKeywords.some(k => lower.includes(k))) score -= 1;

    // Multiple items signal more work
    const listItems = (request.match(/[-*•]\s/g) || []).length;
    score += Math.min(listItems, 5);

    const velocity = this.computeVelocity();
    const baseCost = velocity.avgCostPerRun > 0 ? velocity.avgCostPerRun : 2.5;

    let complexity: 'small' | 'medium' | 'large' | 'epic';
    let estimatedDays: number;
    let costMultiplier: number;

    if (score <= 1) {
      complexity = 'small';
      estimatedDays = 0.5;
      costMultiplier = 0.5;
    } else if (score <= 4) {
      complexity = 'medium';
      estimatedDays = 2;
      costMultiplier = 1;
    } else if (score <= 7) {
      complexity = 'large';
      estimatedDays = 5;
      costMultiplier = 3;
    } else {
      complexity = 'epic';
      estimatedDays = 15;
      costMultiplier = 8;
    }

    return {
      complexity,
      estimatedDays,
      estimatedCost: Math.round(baseCost * costMultiplier * 100) / 100,
    };
  }

  analyzeFeasibility(request: string, deadline?: string, audience: Audience = 'engineer'): FeasibilityResult {
    const velocity = this.computeVelocity();
    const effort = this.estimateEffort(request);

    // Deadline feasibility
    let feasible = true;
    const risks: string[] = [];
    const assumptions: string[] = [];

    if (deadline) {
      const deadlineDate = new Date(deadline);
      const now = new Date();
      const daysAvailable = Math.max(0, (deadlineDate.getTime() - now.getTime()) / 86400000);

      if (effort.estimatedDays > daysAvailable) {
        feasible = false;
        risks.push(`Estimated ${effort.estimatedDays} days needed but only ${Math.round(daysAvailable)} days until deadline`);
      }

      if (daysAvailable < 1) {
        risks.push('Deadline is within 24 hours — high risk of incomplete delivery');
      }
    }

    if (velocity.successRate < 70) {
      risks.push(`Recent pipeline success rate is only ${velocity.successRate.toFixed(0)}%`);
    }

    if (effort.complexity === 'epic') {
      risks.push('Epic-level complexity — consider breaking into smaller deliverables');
      assumptions.push('Request can be decomposed into independent phases');
    }

    assumptions.push('Codebase is in a buildable state');
    assumptions.push('No blocking external dependencies');
    if (velocity.tasksPerWeek > 0) {
      assumptions.push(`Velocity baseline: ${velocity.tasksPerWeek} pipeline runs/week`);
    }

    // Generate 3 scope options
    const options: ScopeOption[] = [
      {
        name: 'Full Scope',
        description: `Complete implementation of all requested features`,
        timeline: `${effort.estimatedDays} days`,
        cost: effort.estimatedCost,
        coverage: 100,
        deferred: [],
        risk: effort.complexity === 'epic' ? 'high' : effort.complexity === 'large' ? 'medium' : 'low',
        recommended: feasible && effort.complexity !== 'epic',
      },
      {
        name: 'Reduced Scope',
        description: `Core functionality with non-critical features deferred`,
        timeline: `${Math.ceil(effort.estimatedDays * 0.6)} days`,
        cost: Math.round(effort.estimatedCost * 0.6 * 100) / 100,
        coverage: 70,
        deferred: ['Edge case handling', 'Advanced configuration', 'Performance optimization'],
        risk: 'low',
        recommended: !feasible || effort.complexity === 'epic',
      },
      {
        name: 'MVP',
        description: `Minimum viable implementation — happy path only`,
        timeline: `${Math.ceil(effort.estimatedDays * 0.3)} days`,
        cost: Math.round(effort.estimatedCost * 0.3 * 100) / 100,
        coverage: 40,
        deferred: ['Error handling', 'Edge cases', 'Documentation', 'Tests', 'UI polish'],
        risk: 'low',
        recommended: false,
      },
    ];

    const confidence = velocity.tasksPerWeek > 0 ? Math.min(85, 50 + velocity.successRate * 0.35) : 40;

    const result: FeasibilityResult = {
      id: randomUUID(),
      request,
      feasible,
      confidence: Math.round(confidence),
      reasoning: this.buildReasoning(effort, velocity, feasible, deadline),
      options,
      risks,
      assumptions,
      audience,
      deadline,
      velocityBaseline: velocity.tasksPerWeek,
      createdAt: Date.now(),
    };

    // Persist
    const state = this.getState();
    state.negotiations.push({
      id: result.id,
      request,
      feasible,
      options,
      audience,
      status: 'proposed',
      createdAt: result.createdAt,
    });
    this.saveState(state);

    return result;
  }

  private buildReasoning(
    effort: { complexity: string; estimatedDays: number; estimatedCost: number },
    velocity: { tasksPerWeek: number; avgCostPerRun: number; avgDurationMs: number; successRate: number },
    feasible: boolean,
    deadline?: string,
  ): string {
    const parts: string[] = [];

    parts.push(`Estimated complexity: ${effort.complexity} (${effort.estimatedDays} days, ~$${effort.estimatedCost}).`);

    if (velocity.tasksPerWeek > 0) {
      parts.push(`Historical velocity: ${velocity.tasksPerWeek} runs/week, ${velocity.successRate.toFixed(0)}% success rate, $${velocity.avgCostPerRun.toFixed(2)} avg cost.`);
    } else {
      parts.push('No historical velocity data — estimates are based on heuristics only.');
    }

    if (deadline) {
      parts.push(feasible
        ? `Deadline is achievable with current velocity.`
        : `Deadline may require scope reduction to meet.`
      );
    }

    return parts.join(' ');
  }

  generateReport(period: 'weekly' | 'monthly' = 'weekly', audience: Audience = 'pm'): StatusReport {
    const history = this.loadHistory();
    const now = Date.now();
    const periodMs = period === 'weekly' ? 7 * 86400000 : 30 * 86400000;
    const periodStart = now - periodMs;

    const recentRuns = history.filter(h => h.timestamp >= periodStart);

    const metrics = {
      pipelinesRun: recentRuns.length,
      successRate: recentRuns.length > 0
        ? Math.round((recentRuns.filter(h => {
            const stages = Object.values(h.stagesSummary);
            return stages.every(s => s === 'done' || s === 'skipped' || s === 'pending');
          }).length / recentRuns.length) * 100)
        : 0,
      avgCost: recentRuns.length > 0
        ? Math.round((recentRuns.reduce((s, h) => s + h.totalCost.totalUsd, 0) / recentRuns.length) * 100) / 100
        : 0,
      avgDuration: recentRuns.length > 0
        ? Math.round(recentRuns.reduce((s, h) => s + h.durationMs, 0) / recentRuns.length / 1000)
        : 0,
      tasksCompleted: recentRuns.length,
    };

    const content = this.formatForAudience(metrics, audience, period);

    const report: StatusReport = {
      id: randomUUID(),
      period,
      audience,
      content,
      metrics,
      generatedAt: Date.now(),
    };

    // Persist
    const state = this.getState();
    state.reports.push({
      id: report.id,
      period,
      audience,
      content,
      generatedAt: report.generatedAt,
    });
    // Keep last 50 reports
    if (state.reports.length > 50) {
      state.reports = state.reports.slice(-50);
    }
    this.saveState(state);

    return report;
  }

  formatForAudience(
    metrics: StatusReport['metrics'],
    audience: Audience,
    period: string = 'weekly',
  ): string {
    const periodLabel = period === 'weekly' ? 'This Week' : 'This Month';

    switch (audience) {
      case 'executive':
        return [
          `# ${periodLabel} — Executive Summary`,
          '',
          `**${metrics.pipelinesRun}** development pipelines completed with **${metrics.successRate}%** success rate.`,
          '',
          `Average cost per pipeline: **$${metrics.avgCost.toFixed(2)}**`,
          '',
          metrics.successRate >= 90
            ? 'Engineering velocity is strong. No blockers.'
            : metrics.successRate >= 70
            ? 'Moderate success rate — some pipelines required intervention.'
            : 'Success rate below target. Recommend reviewing failure patterns.',
        ].join('\n');

      case 'pm':
        return [
          `# ${periodLabel} — PM Status Report`,
          '',
          `## Delivery`,
          `- Pipelines run: ${metrics.pipelinesRun}`,
          `- Success rate: ${metrics.successRate}%`,
          `- Tasks completed: ${metrics.tasksCompleted}`,
          '',
          `## Efficiency`,
          `- Avg cost per run: $${metrics.avgCost.toFixed(2)}`,
          `- Avg duration: ${metrics.avgDuration}s`,
          '',
          `## Risk`,
          metrics.successRate >= 80
            ? '- No delivery risks identified'
            : `- Success rate at ${metrics.successRate}% — may impact timeline estimates`,
        ].join('\n');

      case 'customer':
        return [
          `# ${periodLabel} — Progress Update`,
          '',
          `We completed **${metrics.tasksCompleted}** development tasks this period.`,
          '',
          metrics.successRate >= 90
            ? 'All deliverables are on track.'
            : 'Development is progressing. Some items may require additional iteration.',
          '',
          'Please let us know if priorities have changed.',
        ].join('\n');

      case 'engineer':
      default:
        return [
          `# ${periodLabel} — Engineering Report`,
          '',
          `| Metric | Value |`,
          `|--------|-------|`,
          `| Pipelines run | ${metrics.pipelinesRun} |`,
          `| Success rate | ${metrics.successRate}% |`,
          `| Avg cost | $${metrics.avgCost.toFixed(2)} |`,
          `| Avg duration | ${metrics.avgDuration}s |`,
          `| Tasks completed | ${metrics.tasksCompleted} |`,
          '',
          metrics.successRate < 80
            ? `> Warning: Success rate below 80%. Check recent failures with \`hivemind stats\`.`
            : `> Healthy velocity. Consider increasing parallelism if throughput is needed.`,
        ].join('\n');
    }
  }

  formatPresentation(topic: string): string {
    const state = this.getState();
    const velocity = this.computeVelocity();
    const history = this.loadHistory();

    const recentNegotiations = state.negotiations.slice(-5);
    const totalCost = history.reduce((s, h) => s + h.totalCost.totalUsd, 0);

    const lines: string[] = [
      `# ${topic}`,
      '',
      '---',
      '',
      '## Team Velocity',
      '',
      `- **${velocity.tasksPerWeek}** pipeline runs per week`,
      `- **${velocity.successRate.toFixed(0)}%** success rate`,
      `- **$${velocity.avgCostPerRun.toFixed(2)}** average cost per run`,
      '',
      '## Cost Summary',
      '',
      `- Total spend: **$${totalCost.toFixed(2)}** across ${history.length} runs`,
      '',
    ];

    if (recentNegotiations.length > 0) {
      lines.push('## Recent Scope Negotiations');
      lines.push('');
      for (const neg of recentNegotiations) {
        const statusBadge = neg.status === 'accepted' ? '[ACCEPTED]'
          : neg.status === 'rejected' ? '[REJECTED]'
          : neg.status === 'proposed' ? '[PROPOSED]'
          : '[ANALYZING]';
        lines.push(`- ${statusBadge} ${neg.request.slice(0, 80)}${neg.request.length > 80 ? '...' : ''}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push(`*Generated by Swarm on ${new Date().toISOString().slice(0, 10)}*`);

    return lines.join('\n');
  }
}
