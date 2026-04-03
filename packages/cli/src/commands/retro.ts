import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import type { HistoryEntry } from '../types.js';

interface RetroReport {
  period: { start: string; end: string };
  wentWell: Array<{ summary: string; evidence: string }>;
  wentPoorly: Array<{ summary: string; evidence: string; impact: string }>;
  actionItems: Array<{
    description: string;
    configChange?: { key: string; oldValue: unknown; newValue: unknown };
    priority: 'high' | 'medium' | 'low';
  }>;
  metrics: {
    totalRuns: number;
    successRate: number;
    avgCost: number;
    revertRate: number;
    fixIterationAvg: number;
  };
}

export function registerRetro(program: Command): void {
  program
    .command('retro')
    .description('Run a self-improvement retrospective on recent pipeline activity')
    .option('--period <period>', 'Retrospective period: weekly, biweekly, monthly', 'biweekly')
    .option('--auto-apply', 'Automatically apply recommended config changes')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const config = loadConfig();
      const period = opts.period as 'weekly' | 'biweekly' | 'monthly';
      if (!['weekly', 'biweekly', 'monthly'].includes(period)) {
        console.error(chalk.red(`Invalid period "${opts.period}". Use: weekly, biweekly, monthly`));
        process.exit(1);
      }

      const periodDays = period === 'weekly' ? 7 : period === 'monthly' ? 30 : 14;
      const now = Date.now();
      const cutoff = now - periodDays * 86400000;
      const periodStart = new Date(cutoff).toISOString().split('T')[0];
      const periodEnd = new Date(now).toISOString().split('T')[0];

      // Gather data sources
      const history = loadHistory(swarmDir, cutoff);
      const activityLogs = loadActivityLogs(swarmDir, cutoff);
      const decisions = loadDecisions(swarmDir, cutoff);
      const auditEvents = loadAuditEvents(swarmDir, cutoff);

      if (history.length === 0 && activityLogs.length === 0) {
        console.log(chalk.dim(`No pipeline activity found in the last ${periodDays} days.`));
        return;
      }

      // Analyze
      const report = analyzeRetro({
        history,
        activityLogs,
        decisions,
        auditEvents,
        periodStart,
        periodEnd,
        config,
      });

      // Save report as markdown
      const reportsDir = join(swarmDir, 'reports');
      if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
      const reportFile = join(reportsDir, `retro-${periodEnd}.md`);
      writeFileSync(reportFile, formatReportMarkdown(report), 'utf-8');

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      // Pretty print
      printReport(report);
      console.log(chalk.dim(`\nReport saved to ${reportFile}`));

      // Auto-apply config changes
      if (opts.autoApply && report.actionItems.some(a => a.configChange)) {
        applyConfigChanges(swarmDir, report);
      }
    });
}

// --- Data Loading ---

function loadHistory(swarmDir: string, cutoff: number): HistoryEntry[] {
  const historyFile = join(swarmDir, 'history.json');
  if (!existsSync(historyFile)) return [];
  try {
    const raw = JSON.parse(readFileSync(historyFile, 'utf-8'));
    const entries: HistoryEntry[] = Array.isArray(raw) ? raw : [];
    return entries.filter(h => h.timestamp >= cutoff);
  } catch {
    return [];
  }
}

interface ActivityLogEntry {
  timestamp: number;
  type: string;
  summary: string;
  cost?: number;
  success?: boolean;
  prUrl?: string;
}

function loadActivityLogs(swarmDir: string, cutoff: number): ActivityLogEntry[] {
  const activityDir = join(swarmDir, 'activity');
  if (!existsSync(activityDir)) return [];
  const entries: ActivityLogEntry[] = [];
  try {
    const files = readdirSync(activityDir).filter(f => f.endsWith('.json') || f.endsWith('.jsonl'));
    for (const file of files) {
      const content = readFileSync(join(activityDir, file), 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.timestamp && entry.timestamp >= cutoff) {
            entries.push(entry);
          }
        } catch { /* skip malformed lines */ }
      }
    }
  } catch { /* skip if unreadable */ }
  return entries;
}

interface DecisionEntry {
  timestamp: number;
  decision: string;
  outcome?: 'success' | 'failure' | 'reverted';
  context?: string;
}

function loadDecisions(swarmDir: string, cutoff: number): DecisionEntry[] {
  const decisionsFile = join(swarmDir, 'journal', 'decisions.jsonl');
  if (!existsSync(decisionsFile)) return [];
  const entries: DecisionEntry[] = [];
  try {
    const content = readFileSync(decisionsFile, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.timestamp && entry.timestamp >= cutoff) {
          entries.push(entry);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return entries;
}

interface AuditEvent {
  timestamp: number;
  event: string;
  details?: Record<string, unknown>;
}

function loadAuditEvents(swarmDir: string, cutoff: number): AuditEvent[] {
  const auditFile = join(swarmDir, 'audit.jsonl');
  if (!existsSync(auditFile)) return [];
  const entries: AuditEvent[] = [];
  try {
    const content = readFileSync(auditFile, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.timestamp && entry.timestamp >= cutoff) {
          entries.push(entry);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return entries;
}

// --- Analysis ---

interface AnalysisInput {
  history: HistoryEntry[];
  activityLogs: ActivityLogEntry[];
  decisions: DecisionEntry[];
  auditEvents: AuditEvent[];
  periodStart: string;
  periodEnd: string;
  config: unknown;
}

function analyzeRetro(input: AnalysisInput): RetroReport {
  const { history, activityLogs, decisions, periodStart, periodEnd, config } = input;

  const totalRuns = history.length;
  const passedRuns = history.filter(h => {
    const stages = Object.values(h.stagesSummary);
    return stages.every(s => s === 'done' || s === 'skipped' || s === 'pending');
  });
  const failedRuns = history.filter(h => {
    const stages = Object.values(h.stagesSummary);
    return stages.some(s => s === 'error');
  });
  const successRate = totalRuns > 0 ? Math.round((passedRuns.length / totalRuns) * 100) : 0;
  const totalCost = history.reduce((sum, h) => sum + h.totalCost.totalUsd, 0);
  const avgCost = totalRuns > 0 ? totalCost / totalRuns : 0;
  const fixIterationAvg = totalRuns > 0
    ? history.reduce((sum, h) => sum + (h.fixIterations ?? 0), 0) / totalRuns
    : 0;

  // Revert rate from decisions
  const revertedDecisions = decisions.filter(d => d.outcome === 'reverted');
  const revertRate = decisions.length > 0
    ? Math.round((revertedDecisions.length / decisions.length) * 100)
    : 0;

  // Went Well
  const wentWell: RetroReport['wentWell'] = [];

  if (successRate >= 80 && totalRuns >= 2) {
    wentWell.push({
      summary: `High success rate: ${successRate}% across ${totalRuns} runs`,
      evidence: `${passedRuns.length} of ${totalRuns} pipeline runs completed without errors`,
    });
  }

  const lowCostRuns = history.filter(h => h.totalCost.totalUsd < avgCost * 0.5);
  if (lowCostRuns.length > 0) {
    wentWell.push({
      summary: `${lowCostRuns.length} runs completed well under average cost`,
      evidence: `These runs cost less than $${(avgCost * 0.5).toFixed(2)} vs avg $${avgCost.toFixed(2)}`,
    });
  }

  const fastRuns = history.filter(h => (h.fixIterations ?? 0) <= 1);
  if (fastRuns.length > 0 && totalRuns >= 2) {
    wentWell.push({
      summary: `${fastRuns.length} runs resolved with minimal fix iterations`,
      evidence: `${fastRuns.length} of ${totalRuns} runs needed 0-1 fix iterations`,
    });
  }

  const successfulAutoMerges = activityLogs.filter(
    a => a.type === 'pr-merged' && a.success !== false
  );
  if (successfulAutoMerges.length > 0) {
    wentWell.push({
      summary: `${successfulAutoMerges.length} PRs merged successfully`,
      evidence: `Auto-merges that stuck without reverts`,
    });
  }

  // Went Poorly
  const wentPoorly: RetroReport['wentPoorly'] = [];

  if (failedRuns.length > 0) {
    const failedCost = failedRuns.reduce((sum, h) => sum + h.totalCost.totalUsd, 0);
    wentPoorly.push({
      summary: `${failedRuns.length} pipeline runs failed`,
      evidence: `Failed runs: ${failedRuns.map(r => r.runId.slice(0, 8)).join(', ')}`,
      impact: `$${failedCost.toFixed(2)} spent on failed runs`,
    });
  }

  if (revertedDecisions.length > 0) {
    wentPoorly.push({
      summary: `${revertedDecisions.length} decisions were reverted`,
      evidence: revertedDecisions.map(d => d.decision).join('; '),
      impact: `${revertRate}% revert rate suggests quality or confidence issues`,
    });
  }

  const highCostRuns = history.filter(h => h.totalCost.totalUsd > avgCost * 2);
  if (highCostRuns.length > 0) {
    const wastedCost = highCostRuns.reduce((sum, h) => sum + (h.totalCost.totalUsd - avgCost), 0);
    wentPoorly.push({
      summary: `${highCostRuns.length} runs had unusually high cost`,
      evidence: `Runs exceeded 2x average cost ($${(avgCost * 2).toFixed(2)})`,
      impact: `Estimated $${wastedCost.toFixed(2)} overspend`,
    });
  }

  const highFixRuns = history.filter(h => (h.fixIterations ?? 0) > 3);
  if (highFixRuns.length > 0) {
    wentPoorly.push({
      summary: `${highFixRuns.length} runs needed excessive fix iterations (>3)`,
      evidence: `Fix iterations: ${highFixRuns.map(h => h.fixIterations).join(', ')}`,
      impact: `Extended cycle time and increased cost per run`,
    });
  }

  // Action Items
  const actionItems: RetroReport['actionItems'] = [];

  // Check per-stage costs to recommend model changes
  if (history.length > 0) {
    const stageMap = new Map<string, { totalCost: number; count: number }>();
    for (const entry of history) {
      if (!entry.stageBreakdowns) continue;
      for (const sb of entry.stageBreakdowns) {
        const existing = stageMap.get(sb.name) || { totalCost: 0, count: 0 };
        existing.totalCost += sb.cost;
        existing.count += 1;
        stageMap.set(sb.name, existing);
      }
    }
    for (const [stage, data] of stageMap) {
      const pct = totalCost > 0 ? (data.totalCost / totalCost) * 100 : 0;
      if (pct > 40) {
        const currentModel = (config as unknown as Record<string, unknown>).model ?? 'opus';
        actionItems.push({
          description: `"${stage}" accounts for ${pct.toFixed(0)}% of total cost — consider switching to a cheaper model for this stage`,
          configChange: {
            key: `stageModels.${stage}`,
            oldValue: currentModel,
            newValue: 'sonnet',
          },
          priority: 'high',
        });
      }
    }
  }

  if (fixIterationAvg > 2.5) {
    actionItems.push({
      description: `Average ${fixIterationAvg.toFixed(1)} fix iterations — tighten test coverage or improve prompts`,
      configChange: {
        key: 'maxFixIterations',
        oldValue: (config as unknown as Record<string, unknown>).maxFixIterations ?? 5,
        newValue: Math.max(3, Math.ceil(fixIterationAvg)),
      },
      priority: 'high',
    });
  }

  if (successRate < 60 && totalRuns >= 3) {
    actionItems.push({
      description: `Only ${successRate}% success rate — review failure patterns and consider running \`hivemind learn\``,
      priority: 'high',
    });
  }

  if (avgCost > 8) {
    actionItems.push({
      description: `Average cost $${avgCost.toFixed(2)}/run — enable --lean mode or set budget limits`,
      configChange: {
        key: 'budget',
        oldValue: (config as unknown as Record<string, unknown>).budget ?? null,
        newValue: Math.ceil(avgCost * 0.7),
      },
      priority: 'medium',
    });
  }

  if (revertRate > 20) {
    actionItems.push({
      description: `${revertRate}% revert rate — raise confidence thresholds before auto-merging`,
      configChange: {
        key: 'confidenceThreshold',
        oldValue: (config as unknown as Record<string, unknown>).confidenceThreshold ?? 0.7,
        newValue: 0.85,
      },
      priority: 'medium',
    });
  }

  if (wentWell.length === 0 && totalRuns > 0) {
    actionItems.push({
      description: 'No strong positives detected — consider running a smaller pilot to establish baselines',
      priority: 'low',
    });
  }

  return {
    period: { start: periodStart, end: periodEnd },
    wentWell,
    wentPoorly,
    actionItems,
    metrics: {
      totalRuns,
      successRate,
      avgCost,
      revertRate,
      fixIterationAvg,
    },
  };
}

// --- Output ---

function printReport(report: RetroReport): void {
  console.log(chalk.bold(`\nRetrospective: ${report.period.start} to ${report.period.end}\n`));

  // Metrics
  console.log(chalk.bold('  Metrics'));
  console.log(`    Runs: ${report.metrics.totalRuns} | Success rate: ${chalk.green(report.metrics.successRate + '%')}`);
  console.log(`    Avg cost: ${chalk.yellow('$' + report.metrics.avgCost.toFixed(2))} | Revert rate: ${report.metrics.revertRate}%`);
  console.log(`    Avg fix iterations: ${report.metrics.fixIterationAvg.toFixed(1)}`);
  console.log('');

  // Went Well
  if (report.wentWell.length > 0) {
    console.log(chalk.bold('  Went Well'));
    for (const item of report.wentWell) {
      console.log(`    ${chalk.green('+')} ${item.summary}`);
      console.log(chalk.dim(`      ${item.evidence}`));
    }
    console.log('');
  }

  // Went Poorly
  if (report.wentPoorly.length > 0) {
    console.log(chalk.bold('  Went Poorly'));
    for (const item of report.wentPoorly) {
      console.log(`    ${chalk.red('-')} ${item.summary}`);
      console.log(chalk.dim(`      ${item.evidence}`));
      console.log(chalk.red(`      Impact: ${item.impact}`));
    }
    console.log('');
  }

  // Action Items
  if (report.actionItems.length > 0) {
    console.log(chalk.bold('  Action Items'));
    for (const item of report.actionItems) {
      const priorityColor = item.priority === 'high' ? chalk.red : item.priority === 'medium' ? chalk.yellow : chalk.dim;
      console.log(`    ${priorityColor(`[${item.priority}]`)} ${item.description}`);
      if (item.configChange) {
        console.log(chalk.dim(`      Config: ${item.configChange.key}: ${JSON.stringify(item.configChange.oldValue)} -> ${JSON.stringify(item.configChange.newValue)}`));
      }
    }
    console.log('');
  }

  if (report.wentWell.length === 0 && report.wentPoorly.length === 0) {
    console.log(chalk.dim('  Not enough data for meaningful analysis. Run more pipelines and try again.'));
    console.log('');
  }
}

function formatReportMarkdown(report: RetroReport): string {
  const lines: string[] = [];
  lines.push(`# Retrospective: ${report.period.start} to ${report.period.end}`);
  lines.push('');

  lines.push('## Metrics');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Runs | ${report.metrics.totalRuns} |`);
  lines.push(`| Success Rate | ${report.metrics.successRate}% |`);
  lines.push(`| Avg Cost | $${report.metrics.avgCost.toFixed(2)} |`);
  lines.push(`| Revert Rate | ${report.metrics.revertRate}% |`);
  lines.push(`| Avg Fix Iterations | ${report.metrics.fixIterationAvg.toFixed(1)} |`);
  lines.push('');

  if (report.wentWell.length > 0) {
    lines.push('## Went Well');
    lines.push('');
    for (const item of report.wentWell) {
      lines.push(`- **${item.summary}**`);
      lines.push(`  - Evidence: ${item.evidence}`);
    }
    lines.push('');
  }

  if (report.wentPoorly.length > 0) {
    lines.push('## Went Poorly');
    lines.push('');
    for (const item of report.wentPoorly) {
      lines.push(`- **${item.summary}**`);
      lines.push(`  - Evidence: ${item.evidence}`);
      lines.push(`  - Impact: ${item.impact}`);
    }
    lines.push('');
  }

  if (report.actionItems.length > 0) {
    lines.push('## Action Items');
    lines.push('');
    for (const item of report.actionItems) {
      lines.push(`- [${item.priority.toUpperCase()}] ${item.description}`);
      if (item.configChange) {
        lines.push(`  - Config change: \`${item.configChange.key}\`: \`${JSON.stringify(item.configChange.oldValue)}\` -> \`${JSON.stringify(item.configChange.newValue)}\``);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// --- Auto-apply ---

function applyConfigChanges(swarmDir: string, report: RetroReport): void {
  const configFile = join(swarmDir, 'config.yaml');
  if (!existsSync(configFile)) {
    console.log(chalk.yellow('  No config.yaml found — skipping auto-apply.'));
    return;
  }

  const changes = report.actionItems.filter(a => a.configChange);
  if (changes.length === 0) return;

  console.log(chalk.bold('\n  Applying config changes:\n'));

  // Read the raw config as text for yaml manipulation
  let configContent = readFileSync(configFile, 'utf-8');

  for (const item of changes) {
    const change = item.configChange!;
    console.log(`    ${chalk.yellow(change.key)}: ${JSON.stringify(change.oldValue)} ${chalk.dim('->')} ${JSON.stringify(change.newValue)}`);

    // Simple yaml key replacement: look for the key and replace the value
    // For nested keys like stageModels.engineer, we handle top-level only for safety
    const topKey = change.key.split('.')[0];
    const regex = new RegExp(`^(${topKey}:\\s*)(.*)$`, 'm');
    if (regex.test(configContent)) {
      configContent = configContent.replace(regex, `$1${JSON.stringify(change.newValue)}`);
    } else {
      // Append the key
      configContent += `\n${topKey}: ${JSON.stringify(change.newValue)}\n`;
    }
  }

  writeFileSync(configFile, configContent, 'utf-8');
  console.log(chalk.green(`\n  Config updated at ${configFile}`));
}

/** Export for dashboard / WS server use */
export { analyzeRetro, loadHistory, loadActivityLogs, loadDecisions, loadAuditEvents };
export type { RetroReport, ActivityLogEntry, DecisionEntry, AuditEvent };
