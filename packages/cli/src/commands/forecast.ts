import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import { StateManager } from '../core/state.js';
import type { ForecastData, HistoryEntry } from '../types.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function getWeekKey(ts: number): string {
  const d = new Date(ts);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
}

function confidence(sampleSize: number): number {
  // Confidence grows with more data points, capped at 95%
  return Math.min(95, Math.round(40 + sampleSize * 8));
}

function saveForecast(swarmDir: string, data: ForecastData): void {
  writeFileSync(join(swarmDir, 'forecast.json'), JSON.stringify(data, null, 2));
}

function loadExistingForecast(swarmDir: string): ForecastData {
  const fp = join(swarmDir, 'forecast.json');
  if (existsSync(fp)) {
    try {
      return JSON.parse(readFileSync(fp, 'utf-8'));
    } catch { /* fall through */ }
  }
  return {
    velocity: { current: 0, predicted: 0, confidence: 0, history: [] },
    costEstimates: [],
    risks: [],
    healthProjection: [],
  };
}

function loadActivityLogs(swarmDir: string): Array<{ timestamp: number; type: string; data: Record<string, unknown> }> {
  const activityDir = join(swarmDir, 'activity');
  if (!existsSync(activityDir)) return [];
  const logs: Array<{ timestamp: number; type: string; data: Record<string, unknown> }> = [];
  try {
    const files = readdirSync(activityDir).filter(f => f.endsWith('.jsonl') || f.endsWith('.json'));
    for (const file of files) {
      const content = readFileSync(join(activityDir, file), 'utf-8');
      for (const line of content.split('\n').filter(Boolean)) {
        try {
          logs.push(JSON.parse(line));
        } catch { /* skip malformed lines */ }
      }
    }
  } catch { /* activity dir unreadable */ }
  return logs;
}

// ── Velocity Forecast ───────────────────────────────────────────────────────

function forecastVelocity(history: HistoryEntry[], swarmDir: string): ForecastData['velocity'] {
  // Group pipeline runs by week
  const weekMap = new Map<string, number>();
  for (const entry of history) {
    const wk = getWeekKey(entry.timestamp);
    weekMap.set(wk, (weekMap.get(wk) ?? 0) + 1);
  }

  const weekKeys = [...weekMap.keys()].sort();
  const weeklyItems = weekKeys.map(wk => ({ week: wk, items: weekMap.get(wk)! }));
  const counts = weeklyItems.map(w => w.items);

  const currentVelocity = counts.length > 0 ? counts[counts.length - 1] : 0;

  // Weighted moving average (recent weeks weighted more)
  let predicted = currentVelocity;
  if (counts.length >= 2) {
    const recent = counts.slice(-6); // last 6 weeks
    let weightSum = 0;
    let weighted = 0;
    for (let i = 0; i < recent.length; i++) {
      const w = i + 1;
      weighted += recent[i] * w;
      weightSum += w;
    }
    predicted = Math.round((weighted / weightSum) * 10) / 10;
  }

  const conf = confidence(counts.length);

  return {
    current: currentVelocity,
    predicted,
    confidence: conf,
    history: weeklyItems.slice(-12), // last 12 weeks
  };
}

// ── Risk Assessment ─────────────────────────────────────────────────────────

function assessRisk(description: string, history: HistoryEntry[], swarmDir: string): ForecastData['risks'] {
  const risks: ForecastData['risks'] = [];
  const descLower = description.toLowerCase();

  // Analyze historical failure rates by stage
  const stageFailures: Record<string, number> = {};
  const stageTotal: Record<string, number> = {};
  for (const entry of history) {
    for (const [stage, status] of Object.entries(entry.stagesSummary)) {
      stageTotal[stage] = (stageTotal[stage] ?? 0) + 1;
      if (status === 'error') {
        stageFailures[stage] = (stageFailures[stage] ?? 0) + 1;
      }
    }
  }

  // Check for historically fragile stages
  for (const [stage, total] of Object.entries(stageTotal)) {
    const failures = stageFailures[stage] ?? 0;
    const failRate = failures / total;
    if (failRate > 0.3) {
      risks.push({
        name: `High failure rate in ${stage} stage`,
        probability: Math.round(failRate * 100),
        impact: failRate > 0.5 ? 'high' : 'medium',
        mitigation: `The ${stage} stage has failed ${failures}/${total} times (${Math.round(failRate * 100)}%). Consider reviewing ${stage} prompts and guardrails before starting.`,
      });
    }
  }

  // Check fix loop history — high iteration counts indicate complexity risk
  const fixCounts = history.filter(h => h.fixIterations !== undefined).map(h => h.fixIterations!);
  const avgFixes = mean(fixCounts);
  if (avgFixes > 2) {
    risks.push({
      name: 'Elevated fix loop iterations',
      probability: Math.round(Math.min(90, avgFixes * 20)),
      impact: 'medium',
      mitigation: `Average fix iterations: ${avgFixes.toFixed(1)}. Write more specific acceptance criteria and ensure test coverage for edge cases.`,
    });
  }

  // Keyword-based risk signals from description
  const riskKeywords: Array<{ keywords: string[]; risk: string; impact: string; mitigation: string }> = [
    { keywords: ['refactor', 'rewrite', 'migration', 'migrate'], risk: 'Large-scale code changes', impact: 'high', mitigation: 'Break the work into smaller incremental changes. Run full test suite after each step.' },
    { keywords: ['database', 'schema', 'migration'], risk: 'Database schema changes', impact: 'high', mitigation: 'Test migrations on a copy first. Prepare rollback scripts.' },
    { keywords: ['auth', 'authentication', 'security', 'permission'], risk: 'Security-sensitive changes', impact: 'high', mitigation: 'Require thorough security review. Add penetration test cases.' },
    { keywords: ['performance', 'optimize', 'scale'], risk: 'Performance regression potential', impact: 'medium', mitigation: 'Establish baseline benchmarks before changes. Add performance test cases.' },
    { keywords: ['api', 'endpoint', 'breaking'], risk: 'API compatibility concerns', impact: 'high', mitigation: 'Version the API. Ensure backward compatibility or document migration path.' },
    { keywords: ['dependency', 'upgrade', 'update', 'version'], risk: 'Dependency compatibility', impact: 'medium', mitigation: 'Check changelogs for breaking changes. Test in isolation first.' },
  ];

  for (const rk of riskKeywords) {
    if (rk.keywords.some(kw => descLower.includes(kw))) {
      risks.push({
        name: rk.risk,
        probability: 65,
        impact: rk.impact,
        mitigation: rk.mitigation,
      });
    }
  }

  // Activity log signals — look for recent errors
  const logs = loadActivityLogs(swarmDir);
  const recentErrors = logs.filter(l => l.type === 'error' && l.timestamp > Date.now() - 7 * 86400000);
  if (recentErrors.length > 3) {
    risks.push({
      name: 'Recent instability detected',
      probability: 70,
      impact: 'medium',
      mitigation: `${recentErrors.length} errors in the last 7 days. Stabilize existing issues before adding new features.`,
    });
  }

  if (risks.length === 0) {
    risks.push({
      name: 'No significant risks detected',
      probability: 10,
      impact: 'low',
      mitigation: 'Standard development workflow should suffice.',
    });
  }

  return risks;
}

// ── Cost Estimation ─────────────────────────────────────────────────────────

function estimateCost(description: string, history: HistoryEntry[], swarmDir: string): ForecastData['costEstimates'] {
  const estimates: ForecastData['costEstimates'] = [];

  if (history.length === 0) {
    estimates.push({
      feature: description,
      estimatedCost: 0,
      confidence: 10,
      basis: 'No historical data available. Run at least one pipeline to generate cost estimates.',
    });
    return estimates;
  }

  // Calculate cost stats from history
  const costs = history.map(h => h.totalCost.totalUsd).filter(c => c > 0);
  const durations = history.map(h => h.durationMs).filter(d => d > 0);

  const avgCost = mean(costs);
  const costStd = stddev(costs);
  const avgDuration = mean(durations);

  // Complexity multiplier based on description length and keywords
  const descLower = description.toLowerCase();
  let complexityMult = 1.0;
  const complexitySignals: string[] = [];

  if (descLower.length > 200) { complexityMult += 0.3; complexitySignals.push('detailed description'); }
  if (/refactor|rewrite|migration/i.test(descLower)) { complexityMult += 0.5; complexitySignals.push('restructuring work'); }
  if (/multiple|several|many|across/i.test(descLower)) { complexityMult += 0.3; complexitySignals.push('broad scope'); }
  if (/simple|small|minor|quick/i.test(descLower)) { complexityMult -= 0.3; complexitySignals.push('limited scope'); }
  if (/api|integration|external/i.test(descLower)) { complexityMult += 0.2; complexitySignals.push('integration work'); }

  complexityMult = Math.max(0.3, complexityMult);
  const estimated = avgCost * complexityMult;
  const conf = confidence(costs.length);

  const basisParts = [
    `Based on ${costs.length} historical runs`,
    `avg cost $${avgCost.toFixed(2)} (std $${costStd.toFixed(2)})`,
    `complexity multiplier ${complexityMult.toFixed(1)}x`,
  ];
  if (complexitySignals.length > 0) {
    basisParts.push(`signals: ${complexitySignals.join(', ')}`);
  }

  estimates.push({
    feature: description,
    estimatedCost: Math.round(estimated * 100) / 100,
    confidence: conf,
    basis: basisParts.join('. ') + '.',
  });

  // Break down by stage
  const stageEntries = history.filter(h => h.stageBreakdowns && h.stageBreakdowns.length > 0);
  if (stageEntries.length > 0) {
    const stageCosts: Record<string, number[]> = {};
    for (const entry of stageEntries) {
      for (const sb of entry.stageBreakdowns!) {
        if (!stageCosts[sb.name]) stageCosts[sb.name] = [];
        if (sb.cost > 0) stageCosts[sb.name].push(sb.cost);
      }
    }
    for (const [stage, costs] of Object.entries(stageCosts)) {
      if (costs.length > 0) {
        estimates.push({
          feature: `${description} — ${stage} stage`,
          estimatedCost: Math.round(mean(costs) * complexityMult * 100) / 100,
          confidence: confidence(costs.length),
          basis: `Stage average from ${costs.length} runs, adjusted for complexity.`,
        });
      }
    }
  }

  return estimates;
}

// ── Health Projection ───────────────────────────────────────────────────────

function projectHealth(history: HistoryEntry[], swarmDir: string): ForecastData['healthProjection'] {
  const projections: ForecastData['healthProjection'] = [];

  if (history.length < 2) {
    projections.push({
      metric: 'Insufficient data',
      current: 0,
      projected: 0,
      timeframe: '4 weeks',
      warning: 'Need at least 2 pipeline runs to project trends.',
    });
    return projections;
  }

  // Sort history by time
  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);

  // Success rate trend
  const windowSize = Math.min(5, Math.floor(sorted.length / 2));
  const recentWindow = sorted.slice(-windowSize);
  const olderWindow = sorted.slice(-windowSize * 2, -windowSize);

  const successRate = (entries: HistoryEntry[]) => {
    if (entries.length === 0) return 0;
    const passed = entries.filter(e => {
      const statuses = Object.values(e.stagesSummary);
      return statuses.every(s => s === 'done' || s === 'skipped');
    }).length;
    return (passed / entries.length) * 100;
  };

  const currentSuccess = successRate(recentWindow);
  const olderSuccess = olderWindow.length > 0 ? successRate(olderWindow) : currentSuccess;
  const successTrend = currentSuccess - olderSuccess;
  const projectedSuccess = Math.max(0, Math.min(100, currentSuccess + successTrend));

  projections.push({
    metric: 'Pipeline success rate',
    current: Math.round(currentSuccess),
    projected: Math.round(projectedSuccess),
    timeframe: '4 weeks',
    ...(projectedSuccess < 60 ? { warning: 'Success rate projected to drop below 60%. Review failure patterns.' } : {}),
  });

  // Cost trend
  const recentCosts = recentWindow.map(e => e.totalCost.totalUsd);
  const olderCosts = olderWindow.map(e => e.totalCost.totalUsd);
  const currentAvgCost = mean(recentCosts);
  const olderAvgCost = olderCosts.length > 0 ? mean(olderCosts) : currentAvgCost;
  const costTrend = currentAvgCost - olderAvgCost;
  const projectedCost = Math.max(0, currentAvgCost + costTrend);

  projections.push({
    metric: 'Average run cost ($)',
    current: Math.round(currentAvgCost * 100) / 100,
    projected: Math.round(projectedCost * 100) / 100,
    timeframe: '4 weeks',
    ...(costTrend > currentAvgCost * 0.3 ? { warning: `Cost trending up ${Math.round((costTrend / (olderAvgCost || 1)) * 100)}%. Investigate costly stages.` } : {}),
  });

  // Duration trend
  const recentDurations = recentWindow.map(e => e.durationMs / 60000); // minutes
  const olderDurations = olderWindow.map(e => e.durationMs / 60000);
  const currentAvgDuration = mean(recentDurations);
  const olderAvgDuration = olderDurations.length > 0 ? mean(olderDurations) : currentAvgDuration;
  const durationTrend = currentAvgDuration - olderAvgDuration;
  const projectedDuration = Math.max(0, currentAvgDuration + durationTrend);

  projections.push({
    metric: 'Average run duration (min)',
    current: Math.round(currentAvgDuration * 10) / 10,
    projected: Math.round(projectedDuration * 10) / 10,
    timeframe: '4 weeks',
    ...(durationTrend > currentAvgDuration * 0.25 ? { warning: 'Duration increasing. Check for growing complexity or flaky stages.' } : {}),
  });

  // Fix iteration trend
  const recentFixes = recentWindow.filter(e => e.fixIterations !== undefined).map(e => e.fixIterations!);
  const olderFixes = olderWindow.filter(e => e.fixIterations !== undefined).map(e => e.fixIterations!);
  if (recentFixes.length > 0) {
    const currentAvgFixes = mean(recentFixes);
    const olderAvgFixes = olderFixes.length > 0 ? mean(olderFixes) : currentAvgFixes;
    const fixTrend = currentAvgFixes - olderAvgFixes;
    const projectedFixes = Math.max(0, currentAvgFixes + fixTrend);

    projections.push({
      metric: 'Average fix iterations',
      current: Math.round(currentAvgFixes * 10) / 10,
      projected: Math.round(projectedFixes * 10) / 10,
      timeframe: '4 weeks',
      ...(projectedFixes > 3 ? { warning: 'Fix iterations trending high. Improve prompt quality or add guardrails.' } : {}),
    });
  }

  return projections;
}

// ── Command Registration ────────────────────────────────────────────────────

export function registerForecast(program: Command): void {
  const forecast = program
    .command('forecast')
    .description('Engineering intelligence — predict velocity, risk, cost, and health');

  // ── velocity ──────────────────────────────────────────────────────────────

  forecast
    .command('velocity')
    .description('Predict next sprint velocity based on pipeline history')
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

      const velocity = forecastVelocity(history, swarmDir);
      const existing = loadExistingForecast(swarmDir);
      existing.velocity = velocity;
      saveForecast(swarmDir, existing);

      if (opts.json) {
        console.log(JSON.stringify(velocity, null, 2));
        return;
      }

      console.log(chalk.bold('\n  Velocity Forecast\n'));
      console.log(`    Current velocity:   ${chalk.cyan(String(velocity.current))} items/week`);
      console.log(`    Predicted next:     ${chalk.green(String(velocity.predicted))} items/week`);
      console.log(`    Confidence:         ${chalk.yellow(velocity.confidence + '%')}`);

      if (velocity.history.length > 0) {
        console.log(chalk.bold('\n  Weekly History'));
        const maxItems = Math.max(...velocity.history.map(w => w.items), 1);
        for (const wk of velocity.history) {
          const bar = chalk.blue('█'.repeat(Math.round((wk.items / maxItems) * 20)));
          console.log(`    ${wk.week}  ${String(wk.items).padStart(3)} ${bar}`);
        }
      }

      if (history.length < 3) {
        console.log(chalk.dim('\n  Tip: More pipeline runs improve prediction accuracy.'));
      }

      console.log(chalk.dim(`\n  Saved to .swarm/forecast.json\n`));
    });

  // ── risk ──────────────────────────────────────────────────────────────────

  forecast
    .command('risk <description>')
    .description('Risk assessment for planned work')
    .option('--json', 'Output as JSON')
    .action((description: string, opts) => {
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

      const risks = assessRisk(description, history, swarmDir);
      const existing = loadExistingForecast(swarmDir);
      existing.risks = risks;
      saveForecast(swarmDir, existing);

      if (opts.json) {
        console.log(JSON.stringify(risks, null, 2));
        return;
      }

      console.log(chalk.bold('\n  Risk Assessment\n'));
      console.log(chalk.dim(`  Analyzing: "${description}"\n`));

      for (const risk of risks) {
        const impactColor = risk.impact === 'high' ? chalk.red : risk.impact === 'medium' ? chalk.yellow : chalk.green;
        const probBar = '█'.repeat(Math.round(risk.probability / 10));
        console.log(`    ${impactColor('●')} ${chalk.bold(risk.name)}`);
        console.log(`      Probability: ${risk.probability}% ${chalk.dim(probBar)}`);
        console.log(`      Impact:      ${impactColor(risk.impact)}`);
        console.log(`      Mitigation:  ${chalk.dim(risk.mitigation)}`);
        console.log('');
      }

      console.log(chalk.dim(`  Saved to .swarm/forecast.json\n`));
    });

  // ── cost ──────────────────────────────────────────────────────────────────

  forecast
    .command('cost <description>')
    .description('Estimate cost before starting a feature')
    .option('--json', 'Output as JSON')
    .action((description: string, opts) => {
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

      const costEstimates = estimateCost(description, history, swarmDir);
      const existing = loadExistingForecast(swarmDir);
      existing.costEstimates = costEstimates;
      saveForecast(swarmDir, existing);

      if (opts.json) {
        console.log(JSON.stringify(costEstimates, null, 2));
        return;
      }

      console.log(chalk.bold('\n  Cost Estimate\n'));
      console.log(chalk.dim(`  Feature: "${description}"\n`));

      for (const est of costEstimates) {
        const isStage = est.feature.includes(' — ');
        const prefix = isStage ? '      ' : '    ';
        const label = isStage ? est.feature.split(' — ')[1] : 'Total estimated cost';

        if (!isStage) {
          console.log(`${prefix}${chalk.bold(label)}: ${chalk.green('$' + est.estimatedCost.toFixed(2))}`);
          console.log(`${prefix}Confidence: ${chalk.yellow(est.confidence + '%')}`);
          console.log(`${prefix}Basis: ${chalk.dim(est.basis)}`);
          if (costEstimates.length > 1) {
            console.log(chalk.bold('\n    Stage breakdown:'));
          }
        } else {
          console.log(`${prefix}${label.padEnd(12)} ${chalk.cyan('$' + est.estimatedCost.toFixed(2))} (${est.confidence}% conf)`);
        }
      }

      console.log(chalk.dim(`\n  Saved to .swarm/forecast.json\n`));
    });

  // ── health ────────────────────────────────────────────────────────────────

  forecast
    .command('health')
    .description('Predict codebase health trends from pipeline history')
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

      const healthProjection = projectHealth(history, swarmDir);
      const existing = loadExistingForecast(swarmDir);
      existing.healthProjection = healthProjection;
      saveForecast(swarmDir, existing);

      if (opts.json) {
        console.log(JSON.stringify(healthProjection, null, 2));
        return;
      }

      console.log(chalk.bold('\n  Health Projection\n'));

      for (const proj of healthProjection) {
        const trending = proj.projected > proj.current ? '↑' : proj.projected < proj.current ? '↓' : '→';
        const trendColor = proj.warning ? chalk.red : proj.projected >= proj.current ? chalk.green : chalk.yellow;

        console.log(`    ${chalk.bold(proj.metric)}`);
        console.log(`      Current:   ${proj.current}`);
        console.log(`      Projected: ${trendColor(`${proj.projected} ${trending}`)} (${proj.timeframe})`);
        if (proj.warning) {
          console.log(`      ${chalk.red('⚠')} ${chalk.yellow(proj.warning)}`);
        }
        console.log('');
      }

      console.log(chalk.dim(`  Based on ${history.length} pipeline runs.`));
      console.log(chalk.dim(`  Saved to .swarm/forecast.json\n`));
    });
}
