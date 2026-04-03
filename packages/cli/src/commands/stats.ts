import chalk from 'chalk';
import type { Command } from 'commander';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import { StateManager } from '../core/state.js';
import type { HistoryEntry } from '../types.js';

export function registerStats(program: Command): void {
  program
    .command('stats')
    .description('Show cost and performance statistics across pipeline runs')
    .option('--period <days>', 'Look back period in days', '30')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run a pipeline first.'));
        process.exit(1);
      }

      const config = loadConfig();
      const state = new StateManager(swarmDir);
      state.init(config.projectName, config.stack);
      const history = state.listHistory();

      const periodDays = parseInt(opts.period) || 30;
      const cutoff = Date.now() - periodDays * 86400000;
      const recent = history.filter(h => h.timestamp >= cutoff);

      if (recent.length === 0) {
        console.log(chalk.dim(`No pipeline runs in the last ${periodDays} days.`));
        return;
      }

      const stats = computeStats(recent);

      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      // Pretty print
      console.log(chalk.bold(`\nSwarm Stats — last ${periodDays} days\n`));

      console.log(chalk.bold('  Overview'));
      console.log(`    Runs: ${stats.totalRuns} | Passed: ${chalk.green(String(stats.passed))} | Failed: ${chalk.red(String(stats.failed))}`);
      console.log(`    Success rate: ${stats.successRate}%`);
      console.log(`    Total cost: ${chalk.yellow('$' + stats.totalCost.toFixed(2))} | Avg per run: $${stats.avgCostPerRun.toFixed(2)}`);
      console.log(`    Avg duration: ${formatDuration(stats.avgDurationMs)}`);
      console.log(`    Avg fix iterations: ${stats.avgFixIterations.toFixed(1)}`);
      console.log('');

      if (stats.stageCosts.length > 0) {
        console.log(chalk.bold('  Cost by Stage'));
        for (const sc of stats.stageCosts) {
          const pct = stats.totalCost > 0 ? ((sc.totalCost / stats.totalCost) * 100).toFixed(0) : '0';
          const bar = '█'.repeat(Math.round(Number(pct) / 5));
          console.log(`    ${sc.stage.padEnd(10)} $${sc.totalCost.toFixed(2).padStart(6)} (${pct.padStart(2)}%) ${chalk.blue(bar)} avg ${formatDuration(sc.avgDurationMs)}`);
        }
        console.log('');
      }

      // Weekly trend
      if (stats.weeklySpend.length > 1) {
        console.log(chalk.bold('  Weekly Spend'));
        for (const w of stats.weeklySpend) {
          const bar = '█'.repeat(Math.round(w.cost / Math.max(...stats.weeklySpend.map(x => x.cost)) * 20) || 1);
          console.log(`    ${w.week}  $${w.cost.toFixed(2).padStart(6)}  ${chalk.yellow(bar)}  (${w.runs} runs)`);
        }
        console.log('');
      }

      // Recommendations
      if (stats.recommendations.length > 0) {
        console.log(chalk.bold('  Recommendations'));
        for (const rec of stats.recommendations) {
          console.log(`    ${chalk.yellow('→')} ${rec}`);
        }
        console.log('');
      }
    });
}

interface ActivityBreakdown {
  type: string;
  count: number;
  cost: number;
  successCount: number;
  avgDurationMs: number;
}

interface Stats {
  totalRuns: number;
  passed: number;
  failed: number;
  successRate: number;
  totalCost: number;
  avgCostPerRun: number;
  avgDurationMs: number;
  avgFixIterations: number;
  stageCosts: Array<{ stage: string; totalCost: number; avgCost: number; avgDurationMs: number; count: number }>;
  weeklySpend: Array<{ week: string; cost: number; runs: number }>;
  recommendations: string[];
  activityBreakdown: ActivityBreakdown[];
}

function computeStats(entries: HistoryEntry[]): Stats {
  const totalRuns = entries.length;
  const passed = entries.filter(e => {
    // For entries with activityStatus, use it directly
    if (e.activityStatus) return e.activityStatus === 'success';
    // For legacy pipeline entries, check stage statuses
    const stages = Object.values(e.stagesSummary);
    return stages.every(s => s === 'done' || s === 'skipped' || s === 'pending');
  }).length;
  const failed = totalRuns - passed;
  const successRate = totalRuns > 0 ? Math.round((passed / totalRuns) * 100) : 0;
  const totalCost = entries.reduce((sum, e) => sum + e.totalCost.totalUsd, 0);
  const avgCostPerRun = totalRuns > 0 ? totalCost / totalRuns : 0;
  const avgDurationMs = totalRuns > 0 ? entries.reduce((sum, e) => sum + e.durationMs, 0) / totalRuns : 0;
  const avgFixIterations = totalRuns > 0
    ? entries.reduce((sum, e) => sum + (e.fixIterations ?? 0), 0) / totalRuns
    : 0;

  // Per-stage costs from breakdowns
  const stageMap = new Map<string, { totalCost: number; totalDuration: number; count: number }>();
  for (const entry of entries) {
    if (!entry.stageBreakdowns) continue;
    for (const sb of entry.stageBreakdowns) {
      if (sb.status !== 'done') continue;
      const existing = stageMap.get(sb.name) || { totalCost: 0, totalDuration: 0, count: 0 };
      existing.totalCost += sb.cost;
      existing.totalDuration += sb.durationMs;
      existing.count += 1;
      stageMap.set(sb.name, existing);
    }
  }
  const stageCosts = Array.from(stageMap.entries())
    .map(([stage, data]) => ({
      stage,
      totalCost: data.totalCost,
      avgCost: data.count > 0 ? data.totalCost / data.count : 0,
      avgDurationMs: data.count > 0 ? data.totalDuration / data.count : 0,
      count: data.count,
    }))
    .sort((a, b) => b.totalCost - a.totalCost);

  // Weekly spend
  const weekMap = new Map<string, { cost: number; runs: number }>();
  for (const entry of entries) {
    const d = new Date(entry.timestamp);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toISOString().split('T')[0];
    const existing = weekMap.get(key) || { cost: 0, runs: 0 };
    existing.cost += entry.totalCost.totalUsd;
    existing.runs += 1;
    weekMap.set(key, existing);
  }
  const weeklySpend = Array.from(weekMap.entries())
    .map(([week, data]) => ({ week, ...data }))
    .sort((a, b) => a.week.localeCompare(b.week));

  // Recommendations
  const recommendations: string[] = [];

  if (stageCosts.length > 0) {
    const topStage = stageCosts[0];
    const pct = totalCost > 0 ? (topStage.totalCost / totalCost * 100) : 0;
    if (pct > 35) {
      recommendations.push(
        `"${topStage.stage}" accounts for ${pct.toFixed(0)}% of total spend — consider using a cheaper model for this stage.`
      );
    }
  }

  if (avgFixIterations > 2) {
    recommendations.push(
      `Average ${avgFixIterations.toFixed(1)} fix iterations per run — run \`hivemind learn\` to improve code quality and reduce retries.`
    );
  }

  if (successRate < 50 && totalRuns >= 3) {
    recommendations.push(
      `Only ${successRate}% success rate — check FAILURE-REPORT.md for common patterns.`
    );
  }

  if (avgCostPerRun > 10) {
    recommendations.push(
      `Average cost $${avgCostPerRun.toFixed(2)}/run — try \`--lean\` mode to save ~70%.`
    );
  }

  // Per-activity-type breakdown
  const activityMap = new Map<string, { count: number; cost: number; successCount: number; totalDuration: number }>();
  for (const entry of entries) {
    const type = entry.activityType || 'pipeline';
    const existing = activityMap.get(type) || { count: 0, cost: 0, successCount: 0, totalDuration: 0 };
    existing.count += 1;
    existing.cost += entry.totalCost.totalUsd;
    existing.totalDuration += entry.durationMs;
    const isSuccess = entry.activityStatus ? entry.activityStatus === 'success'
      : Object.values(entry.stagesSummary).every(s => s === 'done' || s === 'skipped' || s === 'pending');
    if (isSuccess) existing.successCount += 1;
    activityMap.set(type, existing);
  }
  const activityBreakdown: ActivityBreakdown[] = Array.from(activityMap.entries())
    .map(([type, data]) => ({
      type,
      count: data.count,
      cost: data.cost,
      successCount: data.successCount,
      avgDurationMs: data.count > 0 ? data.totalDuration / data.count : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalRuns, passed, failed, successRate, totalCost, avgCostPerRun,
    avgDurationMs, avgFixIterations, stageCosts, weeklySpend, recommendations,
    activityBreakdown,
  };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/** Export for dashboard use */
export { computeStats };
export type { Stats };
