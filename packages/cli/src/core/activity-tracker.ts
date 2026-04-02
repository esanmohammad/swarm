import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface ActivityEntry {
  id: string;
  timestamp: number;
  type: 'pipeline' | 'pr-created' | 'pr-merged' | 'issue-resolved' | 'test-gen' | 'deps-update' | 'incident' | 'review' | 'fix' | 'deploy' | 'failure';
  summary: string;
  details?: Record<string, unknown>;
  cost: number;
  durationMs: number;
}

export interface DailySummary {
  date: string;
  activities: ActivityEntry[];
  totalCost: number;
  itemsCompleted: number;
  itemsFailed: number;
  linesGenerated: number;
  prsCreated: number;
  issuesResolved: number;
  testsGenerated: number;
}

export interface StandupReport {
  date: string;
  completed: Array<{ summary: string; type: string; cost: number; prUrl?: string }>;
  impact: { prsCreated: number; prsMerged: number; issuesClosed: number; testsGenerated: number; linesGenerated: number };
  cost: { total: number; byType: Array<{ type: string; cost: number }> };
  blockers: Array<{ summary: string; reason: string }>;
  upcoming: Array<{ title: string; estimatedCost: number }>;
  velocity: { thisWeek: number; lastWeek: number; trend: 'up' | 'down' | 'stable' };
}

function activityDir(swarmDir: string): string {
  return join(swarmDir, 'activity');
}

function ensureActivityDir(swarmDir: string): string {
  const dir = activityDir(swarmDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function dateStr(d?: Date): string {
  return (d ?? new Date()).toISOString().split('T')[0];
}

export function logActivity(swarmDir: string, entry: Omit<ActivityEntry, 'id' | 'timestamp'>): void {
  const dir = ensureActivityDir(swarmDir);
  const date = dateStr();
  const file = join(dir, `${date}.jsonl`);
  const record: ActivityEntry = {
    ...entry,
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
  };
  appendFileSync(file, JSON.stringify(record) + '\n');
}

function readActivitiesForDate(swarmDir: string, date: string): ActivityEntry[] {
  const file = join(activityDir(swarmDir), `${date}.jsonl`);
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
  const entries: ActivityEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as ActivityEntry);
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

export function getDailySummary(swarmDir: string, date?: string): DailySummary {
  const targetDate = date ?? dateStr();
  const activities = readActivitiesForDate(swarmDir, targetDate);

  const totalCost = activities.reduce((sum, a) => sum + a.cost, 0);
  const itemsCompleted = activities.filter(a => a.type !== 'failure').length;
  const itemsFailed = activities.filter(a => a.type === 'failure').length;
  const linesGenerated = activities.reduce((sum, a) => {
    const lines = (a.details?.linesGenerated as number) ?? 0;
    return sum + lines;
  }, 0);
  const prsCreated = activities.filter(a => a.type === 'pr-created').length;
  const issuesResolved = activities.filter(a => a.type === 'issue-resolved').length;
  const testsGenerated = activities.filter(a => a.type === 'test-gen').length;

  return {
    date: targetDate,
    activities,
    totalCost,
    itemsCompleted,
    itemsFailed,
    linesGenerated,
    prsCreated,
    issuesResolved,
    testsGenerated,
  };
}

export function getWeeklySummary(swarmDir: string): DailySummary[] {
  const summaries: DailySummary[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    summaries.push(getDailySummary(swarmDir, dateStr(d)));
  }
  return summaries;
}

function getDateRange(swarmDir: string, since: string): DailySummary[] {
  const sinceDate = new Date(since);
  const now = new Date();
  const summaries: DailySummary[] = [];
  const current = new Date(sinceDate);
  while (current <= now) {
    summaries.push(getDailySummary(swarmDir, dateStr(current)));
    current.setDate(current.getDate() + 1);
  }
  return summaries;
}

function buildStandupReport(summaries: DailySummary[]): StandupReport {
  const allActivities = summaries.flatMap(s => s.activities);
  const completed = allActivities
    .filter(a => a.type !== 'failure')
    .map(a => ({
      summary: a.summary,
      type: a.type,
      cost: a.cost,
      prUrl: (a.details?.prUrl as string) ?? undefined,
    }));

  const prsCreated = allActivities.filter(a => a.type === 'pr-created').length;
  const prsMerged = allActivities.filter(a => a.type === 'pr-merged').length;
  const issuesClosed = allActivities.filter(a => a.type === 'issue-resolved').length;
  const testsGenerated = allActivities.filter(a => a.type === 'test-gen').length;
  const linesGenerated = allActivities.reduce((sum, a) => sum + ((a.details?.linesGenerated as number) ?? 0), 0);

  const totalCost = allActivities.reduce((sum, a) => sum + a.cost, 0);
  const costByTypeMap = new Map<string, number>();
  for (const a of allActivities) {
    costByTypeMap.set(a.type, (costByTypeMap.get(a.type) ?? 0) + a.cost);
  }
  const byType = Array.from(costByTypeMap.entries())
    .map(([type, cost]) => ({ type, cost }))
    .sort((a, b) => b.cost - a.cost);

  const blockers = allActivities
    .filter(a => a.type === 'failure')
    .map(a => ({
      summary: a.summary,
      reason: (a.details?.reason as string) ?? 'Unknown failure',
    }));

  // Upcoming: check for queued items in details
  const upcoming: Array<{ title: string; estimatedCost: number }> = [];
  for (const a of allActivities) {
    if (a.details?.upcoming && Array.isArray(a.details.upcoming)) {
      for (const item of a.details.upcoming as Array<{ title: string; estimatedCost?: number }>) {
        upcoming.push({ title: item.title, estimatedCost: item.estimatedCost ?? 0 });
      }
    }
  }

  // Velocity: compare this week vs last week
  const now = new Date();
  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());
  thisWeekStart.setHours(0, 0, 0, 0);
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const thisWeekCount = allActivities.filter(a => a.type !== 'failure' && a.timestamp >= thisWeekStart.getTime()).length;
  const lastWeekCount = allActivities.filter(a => a.type !== 'failure' && a.timestamp >= lastWeekStart.getTime() && a.timestamp < thisWeekStart.getTime()).length;

  let trend: 'up' | 'down' | 'stable' = 'stable';
  if (thisWeekCount > lastWeekCount * 1.1) trend = 'up';
  else if (thisWeekCount < lastWeekCount * 0.9) trend = 'down';

  const reportDate = summaries.length === 1 ? summaries[0].date : `${summaries[0].date} to ${summaries[summaries.length - 1].date}`;

  return {
    date: reportDate,
    completed,
    impact: { prsCreated, prsMerged, issuesClosed, testsGenerated, linesGenerated },
    cost: { total: totalCost, byType },
    blockers,
    upcoming,
    velocity: { thisWeek: thisWeekCount, lastWeek: lastWeekCount, trend },
  };
}

function formatMarkdown(report: StandupReport): string {
  const lines: string[] = [];
  lines.push(`# Standup Report — ${report.date}`);
  lines.push('');

  // Completed
  lines.push('## Completed');
  if (report.completed.length === 0) {
    lines.push('- _No completed items_');
  } else {
    for (const item of report.completed) {
      const prLink = item.prUrl ? ` ([PR](${item.prUrl}))` : '';
      lines.push(`- **[${item.type}]** ${item.summary} ($${item.cost.toFixed(2)})${prLink}`);
    }
  }
  lines.push('');

  // Impact
  lines.push('## Impact');
  lines.push(`- PRs created: ${report.impact.prsCreated}`);
  lines.push(`- PRs merged: ${report.impact.prsMerged}`);
  lines.push(`- Issues closed: ${report.impact.issuesClosed}`);
  lines.push(`- Tests generated: ${report.impact.testsGenerated}`);
  lines.push(`- Lines generated: ${report.impact.linesGenerated}`);
  lines.push('');

  // Cost
  lines.push('## Cost');
  lines.push(`- **Total: $${report.cost.total.toFixed(2)}**`);
  if (report.cost.byType.length > 0) {
    lines.push('- Breakdown:');
    for (const item of report.cost.byType) {
      lines.push(`  - ${item.type}: $${item.cost.toFixed(2)}`);
    }
  }
  lines.push('');

  // Blockers
  lines.push('## Blockers');
  if (report.blockers.length === 0) {
    lines.push('- _No blockers_');
  } else {
    for (const b of report.blockers) {
      lines.push(`- ${b.summary} — ${b.reason}`);
    }
  }
  lines.push('');

  // Upcoming
  lines.push('## Upcoming');
  if (report.upcoming.length === 0) {
    lines.push('- _No queued items_');
  } else {
    for (const u of report.upcoming) {
      lines.push(`- ${u.title} (est. $${u.estimatedCost.toFixed(2)})`);
    }
  }
  lines.push('');

  // Velocity
  lines.push('## Velocity');
  const trendIcon = report.velocity.trend === 'up' ? '+' : report.velocity.trend === 'down' ? '-' : '=';
  lines.push(`- This week: ${report.velocity.thisWeek} items | Last week: ${report.velocity.lastWeek} items | Trend: ${trendIcon}`);
  lines.push('');

  return lines.join('\n');
}

function formatSlack(report: StandupReport): string {
  const lines: string[] = [];
  lines.push(`:clipboard: *Standup Report — ${report.date}*`);
  lines.push('');

  lines.push(':white_check_mark: *Completed*');
  if (report.completed.length === 0) {
    lines.push('_No completed items_');
  } else {
    for (const item of report.completed) {
      const prLink = item.prUrl ? ` (<${item.prUrl}|PR>)` : '';
      lines.push(`  - [${item.type}] ${item.summary} ($${item.cost.toFixed(2)})${prLink}`);
    }
  }
  lines.push('');

  lines.push(':chart_with_upwards_trend: *Impact*');
  lines.push(`  PRs: ${report.impact.prsCreated} created, ${report.impact.prsMerged} merged | Issues: ${report.impact.issuesClosed} closed | Tests: ${report.impact.testsGenerated} | Lines: ${report.impact.linesGenerated}`);
  lines.push('');

  lines.push(`:moneybag: *Cost: $${report.cost.total.toFixed(2)}*`);
  if (report.cost.byType.length > 0) {
    for (const item of report.cost.byType) {
      lines.push(`  ${item.type}: $${item.cost.toFixed(2)}`);
    }
  }
  lines.push('');

  if (report.blockers.length > 0) {
    lines.push(':rotating_light: *Blockers*');
    for (const b of report.blockers) {
      lines.push(`  - ${b.summary} — ${b.reason}`);
    }
    lines.push('');
  }

  if (report.upcoming.length > 0) {
    lines.push(':soon: *Upcoming*');
    for (const u of report.upcoming) {
      lines.push(`  - ${u.title} (est. $${u.estimatedCost.toFixed(2)})`);
    }
    lines.push('');
  }

  const trendEmoji = report.velocity.trend === 'up' ? ':arrow_up:' : report.velocity.trend === 'down' ? ':arrow_down:' : ':left_right_arrow:';
  lines.push(`:runner: *Velocity* ${trendEmoji} This week: ${report.velocity.thisWeek} | Last week: ${report.velocity.lastWeek}`);

  return lines.join('\n');
}

export function generateStandupReport(swarmDir: string, options: { weekly?: boolean; since?: string; format?: 'markdown' | 'slack' | 'json' }): string {
  let summaries: DailySummary[];

  if (options.since) {
    summaries = getDateRange(swarmDir, options.since);
  } else if (options.weekly) {
    summaries = getWeeklySummary(swarmDir);
  } else {
    summaries = [getDailySummary(swarmDir)];
  }

  const report = buildStandupReport(summaries);

  const format = options.format ?? 'markdown';
  if (format === 'json') {
    return JSON.stringify(report, null, 2);
  } else if (format === 'slack') {
    return formatSlack(report);
  } else {
    return formatMarkdown(report);
  }
}

/** Build a StandupReport object (for dashboard/WS use) */
export function getStandupReportData(swarmDir: string, options: { weekly?: boolean; since?: string }): StandupReport {
  let summaries: DailySummary[];
  if (options.since) {
    summaries = getDateRange(swarmDir, options.since);
  } else if (options.weekly) {
    summaries = getWeeklySummary(swarmDir);
  } else {
    summaries = [getDailySummary(swarmDir)];
  }
  return buildStandupReport(summaries);
}
