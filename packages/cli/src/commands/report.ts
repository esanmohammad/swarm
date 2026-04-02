import chalk from 'chalk';
import type { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import { StateManager } from '../core/state.js';
import type { HistoryEntry } from '../types.js';

interface ReportData {
  period: { start: string; end: string; label: string };
  output: {
    issuesResolved: number;
    prsCreated: number;
    prsMerged: number;
    linesGenerated: number;
    testsGenerated: number;
    depsUpdated: number;
    incidentsResolved: number;
    reviewsPerformed: number;
  };
  quality: {
    mergeRate: number;
    revertRate: number;
    fixLoopSuccessRate: number;
    securityFindings: number;
    testFailuresPrevented: number;
  };
  cost: {
    total: number;
    byCommand: Array<{ command: string; cost: number }>;
    perIssue: number;
    perPr: number;
    perLine: number;
    budgetUtilization: number;
  };
  roi: {
    estimatedHoursSaved: number;
    hourlyRate: number;
    estimatedValueSaved: number;
    roiMultiple: number;
    breakEvenHours: number;
  };
  trends: {
    velocity: Array<{ period: string; items: number }>;
    costEfficiency: Array<{ period: string; costPerItem: number }>;
    qualityTrend: Array<{ period: string; mergeRate: number }>;
  };
  comparison?: { previousPeriod: ReportData };
}

// Hours saved estimates per task type
const HOURS_SAVED: Record<string, number> = {
  pipeline: 4,
  fix: 1,
  'test-gen': 2,
  review: 0.5,
  deps: 1,
  incident: 2,
  mayday: 3,
  build: 1.5,
  refactor: 2,
  explain: 0.25,
};

export function registerReport(program: Command): void {
  program
    .command('report')
    .description('Generate ROI and impact report')
    .option('--period <period>', 'Report period: weekly, monthly, quarterly', 'monthly')
    .option('--format <format>', 'Output format: markdown, json, html', 'markdown')
    .option('--compare', 'Compare with previous period')
    .option('--hourly-rate <rate>', 'Hourly rate for ROI calculation', '75')
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

      const hourlyRate = parseFloat(opts.hourlyRate) || 75;
      const { start, end, label } = getPeriodRange(opts.period);
      const report = generateReport(swarmDir, state, start, end, label, hourlyRate);

      if (opts.compare) {
        const prevRange = getPreviousPeriodRange(opts.period, start);
        const prevReport = generateReport(swarmDir, state, prevRange.start, prevRange.end, prevRange.label, hourlyRate);
        report.comparison = { previousPeriod: prevReport };
      }

      // Save report
      const reportsDir = join(swarmDir, 'reports');
      if (!existsSync(reportsDir)) {
        mkdirSync(reportsDir, { recursive: true });
      }

      const dateStr = new Date().toISOString().slice(0, 7);

      if (opts.format === 'json') {
        const outPath = join(reportsDir, `report-${dateStr}.json`);
        writeFileSync(outPath, JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report, null, 2));
        console.log(chalk.dim(`\nSaved to ${outPath}`));
        return;
      }

      if (opts.format === 'html') {
        const html = renderHtml(report);
        const outPath = join(reportsDir, `report-${dateStr}.html`);
        writeFileSync(outPath, html);
        console.log(chalk.dim(`Saved HTML report to ${outPath}`));
        return;
      }

      // Default: markdown + terminal display
      const md = renderMarkdown(report);
      const outPath = join(reportsDir, `report-${dateStr}.md`);
      writeFileSync(outPath, md);

      displayReport(report);
      console.log(chalk.dim(`\nSaved to ${outPath}`));
    });
}

function getPeriodRange(period: string): { start: number; end: number; label: string } {
  const now = new Date();
  const end = now.getTime();
  let start: number;
  let label: string;

  switch (period) {
    case 'weekly':
      start = end - 7 * 86400000;
      label = `Week of ${new Date(start).toISOString().split('T')[0]}`;
      break;
    case 'quarterly':
      start = end - 90 * 86400000;
      label = `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`;
      break;
    case 'monthly':
    default:
      start = end - 30 * 86400000;
      label = `${now.toLocaleString('default', { month: 'long' })} ${now.getFullYear()}`;
      break;
  }

  return { start, end, label };
}

function getPreviousPeriodRange(period: string, currentStart: number): { start: number; end: number; label: string } {
  const end = currentStart;
  const duration = period === 'weekly' ? 7 * 86400000 : period === 'quarterly' ? 90 * 86400000 : 30 * 86400000;
  const start = end - duration;
  const d = new Date(start);
  const label = `Previous: ${d.toISOString().split('T')[0]} to ${new Date(end).toISOString().split('T')[0]}`;
  return { start, end, label };
}

function generateReport(
  swarmDir: string,
  state: StateManager,
  start: number,
  end: number,
  label: string,
  hourlyRate: number,
): ReportData {
  // Load history
  const history = state.listHistory().filter(h => h.timestamp >= start && h.timestamp <= end);

  // Load activity entries
  const activityEntries = loadActivityEntries(swarmDir, start, end);

  // Load audit entries
  const auditEntries = loadAuditEntries(swarmDir, start, end);

  // Count by command type
  const commandCounts = new Map<string, { count: number; cost: number }>();
  for (const entry of activityEntries) {
    const cmd = entry.command || 'pipeline';
    const existing = commandCounts.get(cmd) || { count: 0, cost: 0 };
    existing.count += 1;
    existing.cost += entry.cost || 0;
    commandCounts.set(cmd, existing);
  }

  // Also count from history
  for (const h of history) {
    const existing = commandCounts.get('pipeline') || { count: 0, cost: 0 };
    existing.count += 1;
    existing.cost += h.totalCost.totalUsd;
    commandCounts.set('pipeline', existing);
  }

  // Output metrics
  const issuesResolved = countByType(activityEntries, 'fix') + countByType(activityEntries, 'incident');
  const prsCreated = countByType(activityEntries, 'pr') + countByType(activityEntries, 'pipeline');
  const prsMerged = countByField(activityEntries, 'merged', true);
  const linesGenerated = sumByField(activityEntries, 'linesChanged');
  const testsGenerated = countByType(activityEntries, 'test-gen') + countByType(activityEntries, 'test');
  const depsUpdated = countByType(activityEntries, 'deps');
  const incidentsResolved = countByType(activityEntries, 'incident');
  const reviewsPerformed = countByType(activityEntries, 'review') + countByType(activityEntries, 'babysit-prs');

  // Quality metrics
  const mergeRate = prsCreated > 0 ? Math.round((prsMerged / prsCreated) * 100) : 0;
  const revertCount = countByField(activityEntries, 'reverted', true);
  const revertRate = prsMerged > 0 ? Math.round((revertCount / prsMerged) * 100) : 0;
  const fixLoopTotal = history.filter(h => (h.fixIterations ?? 0) > 0).length;
  const fixLoopSuccess = history.filter(h => {
    const stages = Object.values(h.stagesSummary);
    return (h.fixIterations ?? 0) > 0 && stages.every(s => s === 'done' || s === 'skipped' || s === 'pending');
  }).length;
  const fixLoopSuccessRate = fixLoopTotal > 0 ? Math.round((fixLoopSuccess / fixLoopTotal) * 100) : 0;
  const securityFindings = countByType(activityEntries, 'secure') + countByType(auditEntries, 'security-finding');
  const testFailuresPrevented = sumByField(activityEntries, 'testFailuresPrevented');

  // Cost
  const totalCost = Array.from(commandCounts.values()).reduce((sum, v) => sum + v.cost, 0);
  const byCommand = Array.from(commandCounts.entries())
    .map(([command, data]) => ({ command, cost: data.cost }))
    .sort((a, b) => b.cost - a.cost);
  const totalItems = issuesResolved + prsCreated + testsGenerated + depsUpdated + reviewsPerformed;
  const perIssue = issuesResolved > 0 ? totalCost / issuesResolved : 0;
  const perPr = prsCreated > 0 ? totalCost / prsCreated : 0;
  const perLine = linesGenerated > 0 ? totalCost / linesGenerated : 0;
  const budgetUtilization = 0; // Would need config budget to compute

  // ROI
  let estimatedHoursSaved = 0;
  for (const [cmd, data] of commandCounts) {
    const hoursPerTask = HOURS_SAVED[cmd] || 1;
    estimatedHoursSaved += data.count * hoursPerTask;
  }
  const estimatedValueSaved = estimatedHoursSaved * hourlyRate;
  const roiMultiple = totalCost > 0 ? estimatedValueSaved / totalCost : 0;
  const breakEvenHours = hourlyRate > 0 ? totalCost / hourlyRate : 0;

  // Trends (weekly buckets)
  const weekBuckets = new Map<string, { items: number; cost: number; merged: number; total: number }>();
  for (const entry of activityEntries) {
    const d = new Date(entry.timestamp || start);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toISOString().split('T')[0];
    const existing = weekBuckets.get(key) || { items: 0, cost: 0, merged: 0, total: 0 };
    existing.items += 1;
    existing.cost += entry.cost || 0;
    if (entry.merged) existing.merged += 1;
    existing.total += 1;
    weekBuckets.set(key, existing);
  }

  const sortedWeeks = Array.from(weekBuckets.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const velocity = sortedWeeks.map(([period, data]) => ({ period, items: data.items }));
  const costEfficiency = sortedWeeks
    .filter(([, data]) => data.items > 0)
    .map(([period, data]) => ({ period, costPerItem: data.cost / data.items }));
  const qualityTrend = sortedWeeks
    .filter(([, data]) => data.total > 0)
    .map(([period, data]) => ({ period, mergeRate: Math.round((data.merged / data.total) * 100) }));

  return {
    period: {
      start: new Date(start).toISOString().split('T')[0],
      end: new Date(end).toISOString().split('T')[0],
      label,
    },
    output: { issuesResolved, prsCreated, prsMerged, linesGenerated, testsGenerated, depsUpdated, incidentsResolved, reviewsPerformed },
    quality: { mergeRate, revertRate, fixLoopSuccessRate, securityFindings, testFailuresPrevented },
    cost: { total: totalCost, byCommand, perIssue, perPr, perLine, budgetUtilization },
    roi: { estimatedHoursSaved, hourlyRate, estimatedValueSaved, roiMultiple, breakEvenHours },
    trends: { velocity, costEfficiency, qualityTrend },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadActivityEntries(swarmDir: string, start: number, end: number): any[] {
  const activityDir = join(swarmDir, 'activity');
  if (!existsSync(activityDir)) return [];

  const entries: any[] = [];
  try {
    const files = readdirSync(activityDir).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const content = readFileSync(join(activityDir, file), 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          const ts = entry.timestamp || 0;
          if (ts >= start && ts <= end) {
            entries.push(entry);
          }
        } catch {
          // Skip malformed lines
        }
      }
    }
  } catch {
    // Activity dir not readable
  }
  return entries;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadAuditEntries(swarmDir: string, start: number, end: number): any[] {
  const auditPath = join(swarmDir, 'audit.jsonl');
  if (!existsSync(auditPath)) return [];

  const entries: any[] = [];
  try {
    const content = readFileSync(auditPath, 'utf-8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const ts = entry.timestamp || 0;
        if (ts >= start && ts <= end) {
          entries.push(entry);
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Audit file not readable
  }
  return entries;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function countByType(entries: any[], type: string): number {
  return entries.filter(e => e.command === type || e.type === type).length;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function countByField(entries: any[], field: string, value: any): number {
  return entries.filter(e => e[field] === value).length;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sumByField(entries: any[], field: string): number {
  return entries.reduce((sum, e) => sum + (Number(e[field]) || 0), 0);
}

function displayReport(report: ReportData): void {
  console.log('');
  console.log(chalk.bold(`  Swarm Impact Report — ${report.period.label}`));
  console.log(chalk.dim(`  ${report.period.start} to ${report.period.end}`));
  console.log('');

  // ROI headline
  const roiColor = report.roi.roiMultiple >= 3 ? chalk.green : report.roi.roiMultiple >= 1 ? chalk.yellow : chalk.red;
  console.log(chalk.bold('  ROI Summary'));
  console.log(`    ROI Multiple:       ${roiColor(report.roi.roiMultiple.toFixed(1) + 'x')}`);
  console.log(`    Hours Saved:        ${chalk.cyan(String(report.roi.estimatedHoursSaved.toFixed(1)))}h`);
  console.log(`    Value Generated:    ${chalk.green('$' + report.roi.estimatedValueSaved.toFixed(0))}`);
  console.log(`    Total Cost:         ${chalk.yellow('$' + report.cost.total.toFixed(2))}`);
  console.log(`    Break-even:         ${report.roi.breakEvenHours.toFixed(1)}h of eng time`);
  console.log('');

  // Output
  console.log(chalk.bold('  Output'));
  console.log(`    Issues Resolved:    ${report.output.issuesResolved}`);
  console.log(`    PRs Created:        ${report.output.prsCreated}`);
  console.log(`    PRs Merged:         ${report.output.prsMerged}`);
  console.log(`    Lines Generated:    ${report.output.linesGenerated.toLocaleString()}`);
  console.log(`    Tests Generated:    ${report.output.testsGenerated}`);
  console.log(`    Deps Updated:       ${report.output.depsUpdated}`);
  console.log(`    Incidents Resolved: ${report.output.incidentsResolved}`);
  console.log(`    Reviews Performed:  ${report.output.reviewsPerformed}`);
  console.log('');

  // Quality
  console.log(chalk.bold('  Quality'));
  console.log(`    Merge Rate:         ${report.quality.mergeRate}%`);
  console.log(`    Revert Rate:        ${report.quality.revertRate}%`);
  console.log(`    Fix Loop Success:   ${report.quality.fixLoopSuccessRate}%`);
  console.log(`    Security Findings:  ${report.quality.securityFindings}`);
  console.log(`    Test Failures Prevented: ${report.quality.testFailuresPrevented}`);
  console.log('');

  // Cost breakdown
  if (report.cost.byCommand.length > 0) {
    console.log(chalk.bold('  Cost Breakdown'));
    const maxCost = Math.max(...report.cost.byCommand.map(c => c.cost), 0.01);
    for (const item of report.cost.byCommand.slice(0, 10)) {
      const bar = '█'.repeat(Math.round((item.cost / maxCost) * 20) || 1);
      const pct = report.cost.total > 0 ? ((item.cost / report.cost.total) * 100).toFixed(0) : '0';
      console.log(`    ${item.command.padEnd(14)} $${item.cost.toFixed(2).padStart(7)} (${pct.padStart(2)}%) ${chalk.blue(bar)}`);
    }
    console.log('');
    console.log(`    Cost per issue:     $${report.cost.perIssue.toFixed(2)}`);
    console.log(`    Cost per PR:        $${report.cost.perPr.toFixed(2)}`);
    console.log(`    Cost per line:      $${report.cost.perLine.toFixed(4)}`);
    console.log('');
  }

  // Trends
  if (report.trends.velocity.length > 1) {
    console.log(chalk.bold('  Velocity Trend'));
    const maxItems = Math.max(...report.trends.velocity.map(v => v.items), 1);
    for (const v of report.trends.velocity) {
      const bar = '█'.repeat(Math.round((v.items / maxItems) * 20) || 1);
      console.log(`    ${v.period}  ${String(v.items).padStart(4)} items  ${chalk.cyan(bar)}`);
    }
    console.log('');
  }

  // Comparison
  if (report.comparison) {
    const prev = report.comparison.previousPeriod;
    console.log(chalk.bold('  Period Comparison'));
    console.log(`    Previous: ${prev.period.label}`);
    console.log('');
    const delta = (curr: number, previous: number): string => {
      if (previous === 0) return curr > 0 ? chalk.green('↑ new') : chalk.dim('—');
      const pct = ((curr - previous) / previous) * 100;
      return pct >= 0 ? chalk.green(`↑ ${pct.toFixed(0)}%`) : chalk.red(`↓ ${Math.abs(pct).toFixed(0)}%`);
    };
    console.log(`    ROI Multiple:    ${report.roi.roiMultiple.toFixed(1)}x  ${delta(report.roi.roiMultiple, prev.roi.roiMultiple)}`);
    console.log(`    Total Cost:      $${report.cost.total.toFixed(2)}  ${delta(report.cost.total, prev.cost.total)}`);
    console.log(`    Hours Saved:     ${report.roi.estimatedHoursSaved.toFixed(1)}h  ${delta(report.roi.estimatedHoursSaved, prev.roi.estimatedHoursSaved)}`);
    console.log(`    Issues Resolved: ${report.output.issuesResolved}  ${delta(report.output.issuesResolved, prev.output.issuesResolved)}`);
    console.log(`    PRs Created:     ${report.output.prsCreated}  ${delta(report.output.prsCreated, prev.output.prsCreated)}`);
    console.log('');
  }
}

function renderMarkdown(report: ReportData): string {
  const lines: string[] = [];
  lines.push(`# Swarm Impact Report — ${report.period.label}`);
  lines.push(`> ${report.period.start} to ${report.period.end}`);
  lines.push('');
  lines.push('## ROI Summary');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| ROI Multiple | **${report.roi.roiMultiple.toFixed(1)}x** |`);
  lines.push(`| Hours Saved | ${report.roi.estimatedHoursSaved.toFixed(1)}h |`);
  lines.push(`| Value Generated | $${report.roi.estimatedValueSaved.toFixed(0)} |`);
  lines.push(`| Total Cost | $${report.cost.total.toFixed(2)} |`);
  lines.push(`| Break-even | ${report.roi.breakEvenHours.toFixed(1)}h of eng time |`);
  lines.push('');
  lines.push('## Output');
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Issues Resolved | ${report.output.issuesResolved} |`);
  lines.push(`| PRs Created | ${report.output.prsCreated} |`);
  lines.push(`| PRs Merged | ${report.output.prsMerged} |`);
  lines.push(`| Lines Generated | ${report.output.linesGenerated.toLocaleString()} |`);
  lines.push(`| Tests Generated | ${report.output.testsGenerated} |`);
  lines.push(`| Deps Updated | ${report.output.depsUpdated} |`);
  lines.push(`| Incidents Resolved | ${report.output.incidentsResolved} |`);
  lines.push(`| Reviews Performed | ${report.output.reviewsPerformed} |`);
  lines.push('');
  lines.push('## Quality');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Merge Rate | ${report.quality.mergeRate}% |`);
  lines.push(`| Revert Rate | ${report.quality.revertRate}% |`);
  lines.push(`| Fix Loop Success | ${report.quality.fixLoopSuccessRate}% |`);
  lines.push(`| Security Findings | ${report.quality.securityFindings} |`);
  lines.push(`| Test Failures Prevented | ${report.quality.testFailuresPrevented} |`);
  lines.push('');
  lines.push('## Cost Breakdown');
  lines.push(`| Command | Cost | % |`);
  lines.push(`|---------|------|---|`);
  for (const item of report.cost.byCommand) {
    const pct = report.cost.total > 0 ? ((item.cost / report.cost.total) * 100).toFixed(0) : '0';
    lines.push(`| ${item.command} | $${item.cost.toFixed(2)} | ${pct}% |`);
  }
  lines.push('');
  lines.push(`- Cost per issue: $${report.cost.perIssue.toFixed(2)}`);
  lines.push(`- Cost per PR: $${report.cost.perPr.toFixed(2)}`);
  lines.push(`- Cost per line: $${report.cost.perLine.toFixed(4)}`);
  lines.push('');

  if (report.comparison) {
    const prev = report.comparison.previousPeriod;
    lines.push('## Period Comparison');
    lines.push(`| Metric | Current | Previous | Change |`);
    lines.push(`|--------|---------|----------|--------|`);
    const pctChange = (curr: number, previous: number): string => {
      if (previous === 0) return curr > 0 ? '+new' : '—';
      const pct = ((curr - previous) / previous) * 100;
      return pct >= 0 ? `+${pct.toFixed(0)}%` : `${pct.toFixed(0)}%`;
    };
    lines.push(`| ROI Multiple | ${report.roi.roiMultiple.toFixed(1)}x | ${prev.roi.roiMultiple.toFixed(1)}x | ${pctChange(report.roi.roiMultiple, prev.roi.roiMultiple)} |`);
    lines.push(`| Total Cost | $${report.cost.total.toFixed(2)} | $${prev.cost.total.toFixed(2)} | ${pctChange(report.cost.total, prev.cost.total)} |`);
    lines.push(`| Hours Saved | ${report.roi.estimatedHoursSaved.toFixed(1)}h | ${prev.roi.estimatedHoursSaved.toFixed(1)}h | ${pctChange(report.roi.estimatedHoursSaved, prev.roi.estimatedHoursSaved)} |`);
    lines.push(`| Issues Resolved | ${report.output.issuesResolved} | ${prev.output.issuesResolved} | ${pctChange(report.output.issuesResolved, prev.output.issuesResolved)} |`);
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Generated by Swarm on ${new Date().toISOString().split('T')[0]}*`);
  return lines.join('\n');
}

function renderHtml(report: ReportData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Swarm Impact Report — ${report.period.label}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1c1917; color: #d6d3d1; max-width: 900px; margin: 0 auto; padding: 2rem; }
    h1 { color: #fbbf24; border-bottom: 1px solid #44403c; padding-bottom: 0.5rem; }
    h2 { color: #a8a29e; margin-top: 2rem; }
    .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin: 1rem 0; }
    .card { background: #292524; border: 1px solid #44403c; border-radius: 8px; padding: 1rem; }
    .card .label { font-size: 0.75rem; color: #78716c; text-transform: uppercase; }
    .card .value { font-size: 1.5rem; font-weight: 700; margin: 0.25rem 0; }
    .card .sub { font-size: 0.75rem; color: #78716c; }
    .roi { color: #4ade80; }
    .cost { color: #fbbf24; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #44403c; }
    th { color: #78716c; font-size: 0.75rem; text-transform: uppercase; }
    .bar-container { background: #44403c; border-radius: 4px; height: 12px; }
    .bar-fill { background: #3b82f6; border-radius: 4px; height: 100%; }
    footer { margin-top: 2rem; font-size: 0.75rem; color: #78716c; border-top: 1px solid #44403c; padding-top: 1rem; }
  </style>
</head>
<body>
  <h1>Swarm Impact Report</h1>
  <p style="color:#78716c">${report.period.label} &mdash; ${report.period.start} to ${report.period.end}</p>

  <div class="cards">
    <div class="card"><div class="label">ROI Multiple</div><div class="value roi">${report.roi.roiMultiple.toFixed(1)}x</div><div class="sub">return on investment</div></div>
    <div class="card"><div class="label">Hours Saved</div><div class="value" style="color:#22d3ee">${report.roi.estimatedHoursSaved.toFixed(1)}h</div><div class="sub">$${report.roi.estimatedValueSaved.toFixed(0)} value</div></div>
    <div class="card"><div class="label">Total Cost</div><div class="value cost">$${report.cost.total.toFixed(2)}</div><div class="sub">${report.cost.byCommand.length} commands</div></div>
    <div class="card"><div class="label">Issues Closed</div><div class="value" style="color:#d6d3d1">${report.output.issuesResolved}</div><div class="sub">${report.output.prsCreated} PRs created</div></div>
  </div>

  <h2>Output</h2>
  <table>
    <tr><th>Metric</th><th>Count</th></tr>
    <tr><td>Issues Resolved</td><td>${report.output.issuesResolved}</td></tr>
    <tr><td>PRs Created</td><td>${report.output.prsCreated}</td></tr>
    <tr><td>PRs Merged</td><td>${report.output.prsMerged}</td></tr>
    <tr><td>Lines Generated</td><td>${report.output.linesGenerated.toLocaleString()}</td></tr>
    <tr><td>Tests Generated</td><td>${report.output.testsGenerated}</td></tr>
    <tr><td>Deps Updated</td><td>${report.output.depsUpdated}</td></tr>
    <tr><td>Reviews Performed</td><td>${report.output.reviewsPerformed}</td></tr>
  </table>

  <h2>Quality</h2>
  <table>
    <tr><th>Metric</th><th>Value</th></tr>
    <tr><td>Merge Rate</td><td>${report.quality.mergeRate}%</td></tr>
    <tr><td>Revert Rate</td><td>${report.quality.revertRate}%</td></tr>
    <tr><td>Fix Loop Success</td><td>${report.quality.fixLoopSuccessRate}%</td></tr>
    <tr><td>Security Findings</td><td>${report.quality.securityFindings}</td></tr>
  </table>

  <h2>Cost Breakdown</h2>
  <table>
    <tr><th>Command</th><th>Cost</th><th>%</th><th></th></tr>
    ${report.cost.byCommand.map(item => {
      const pct = report.cost.total > 0 ? (item.cost / report.cost.total * 100) : 0;
      return `<tr><td>${item.command}</td><td>$${item.cost.toFixed(2)}</td><td>${pct.toFixed(0)}%</td><td><div class="bar-container" style="width:200px"><div class="bar-fill" style="width:${pct}%"></div></div></td></tr>`;
    }).join('\n    ')}
  </table>

  <footer>Generated by Swarm on ${new Date().toISOString().split('T')[0]}</footer>
</body>
</html>`;
}

export { generateReport };
export type { ReportData };
