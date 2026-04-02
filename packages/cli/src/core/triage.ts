/**
 * Triage Engine — classifies and prioritizes work items for the Swarm Inbox daemon.
 *
 * Scoring dimensions:
 *   - Source priority (e.g. ci-failure > github-issue)
 *   - Label priority (e.g. P0/critical > enhancement)
 *   - Age (older items score higher)
 *   - VIP requester bonus
 *   - Estimated complexity penalty
 *   - Dependency bonus (items blocking others)
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface WorkItem {
  id: string;
  source: 'github-issue' | 'github-pr' | 'ci-failure' | 'stale-pr' | 'slack' | 'scheduled' | 'manual';
  title: string;
  body: string;
  url?: string;
  labels: string[];
  author?: string;
  createdAt: string;
  priority: number;
  type: 'bug-fix' | 'feature' | 'maintenance' | 'incident' | 'review';
  status: 'queued' | 'triaging' | 'running' | 'done' | 'failed' | 'skipped' | 'needs-human';
  confidence: number;
  estimatedCost: number;
  estimatedMinutes: number;
  result?: { prUrl?: string; cost?: number; duration?: number; error?: string };
  startedAt?: number;
  completedAt?: number;
}

export interface TriageResult {
  item: WorkItem;
  score: number;
  reasoning: string;
  withinBudget: boolean;
}

export interface TriageConfig {
  vipAuthors: string[];
  sourcePriority: Record<string, number>;
  labelPriority: Record<string, number>;
  dailyBudget: number;
  perItemBudget: number;
  confidenceThresholds: { autoMerge: number; autoWork: number };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_TRIAGE_CONFIG: TriageConfig = {
  vipAuthors: [],
  sourcePriority: {
    'ci-failure': 90,
    'incident': 85,
    'github-issue': 60,
    'github-pr': 55,
    'stale-pr': 40,
    'slack': 50,
    'scheduled': 30,
    'manual': 70,
  },
  labelPriority: {
    'P0': 100,
    'critical': 95,
    'bug': 80,
    'P1': 75,
    'security': 90,
    'P2': 50,
    'enhancement': 40,
    'maintenance': 30,
    'documentation': 20,
    'chore': 15,
  },
  dailyBudget: 25,
  perItemBudget: 5,
  confidenceThresholds: { autoMerge: 85, autoWork: 60 },
};

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: Record<WorkItem['type'], RegExp[]> = {
  'bug-fix': [/bug/i, /fix/i, /crash/i, /broken/i, /error/i, /regression/i, /defect/i],
  'incident': [/incident/i, /outage/i, /down/i, /p0/i, /critical/i, /urgent/i, /sev[- ]?[01]/i],
  'review': [/review/i, /feedback/i, /approve/i],
  'maintenance': [/refactor/i, /cleanup/i, /chore/i, /update dep/i, /bump/i, /maintenance/i, /tech debt/i],
  'feature': [/feat/i, /add/i, /new/i, /implement/i, /enhance/i, /request/i],
};

export function classifyType(item: Pick<WorkItem, 'title' | 'body' | 'labels' | 'source'>): WorkItem['type'] {
  const text = `${item.title} ${item.body}`.toLowerCase();
  const labelText = item.labels.join(' ').toLowerCase();

  if (item.source === 'ci-failure') return 'bug-fix';
  if (item.source === 'github-pr' || item.source === 'stale-pr') return 'review';

  for (const [type, patterns] of Object.entries(TYPE_KEYWORDS) as [WorkItem['type'], RegExp[]][]) {
    for (const pat of patterns) {
      if (pat.test(text) || pat.test(labelText)) return type;
    }
  }

  return 'feature';
}

// ---------------------------------------------------------------------------
// Complexity estimation
// ---------------------------------------------------------------------------

function estimateComplexity(item: Pick<WorkItem, 'title' | 'body' | 'labels'>): { cost: number; minutes: number } {
  const text = `${item.title} ${item.body}`;
  const length = text.length;

  // Base estimates
  let minutes = 15;
  let cost = 0.5;

  if (length > 2000) { minutes += 15; cost += 0.5; }
  if (length > 5000) { minutes += 20; cost += 1.0; }

  const complexityMarkers = [/multiple files/i, /refactor/i, /migration/i, /breaking change/i, /cross-cutting/i];
  for (const marker of complexityMarkers) {
    if (marker.test(text)) { minutes += 10; cost += 0.5; }
  }

  const simpleMarkers = [/typo/i, /rename/i, /update readme/i, /bump version/i, /lint/i];
  for (const marker of simpleMarkers) {
    if (marker.test(text)) { minutes = Math.max(5, minutes - 10); cost = Math.max(0.2, cost - 0.3); }
  }

  return { cost: Math.round(cost * 100) / 100, minutes: Math.round(minutes) };
}

// ---------------------------------------------------------------------------
// Confidence estimation
// ---------------------------------------------------------------------------

function estimateConfidence(item: Pick<WorkItem, 'title' | 'body' | 'labels' | 'source' | 'type'>): number {
  let confidence = 70;

  // Well-described items get a boost
  if (item.body.length > 200) confidence += 5;
  if (item.body.length > 500) confidence += 5;
  if (item.body.length > 1500) confidence += 5;

  // Clear reproduction steps boost confidence
  if (/steps to reproduce/i.test(item.body) || /expected.*actual/i.test(item.body)) confidence += 10;

  // CI failures are well-defined
  if (item.source === 'ci-failure') confidence += 15;

  // Vague items lose confidence
  if (item.body.length < 50) confidence -= 15;
  if (item.title.length < 10) confidence -= 5;

  // Some types are inherently riskier
  if (item.type === 'incident') confidence -= 10;
  if (item.type === 'maintenance') confidence += 5;
  if (item.type === 'review') confidence += 10;

  return Math.max(10, Math.min(100, confidence));
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreItem(item: WorkItem, config: TriageConfig): { score: number; reasoning: string } {
  const reasons: string[] = [];
  let score = 0;

  // Source priority (0-30 points)
  const sourcePts = ((config.sourcePriority[item.source] ?? 50) / 100) * 30;
  score += sourcePts;
  reasons.push(`source:${item.source}(${sourcePts.toFixed(0)})`);

  // Label priority (0-25 points) — take the highest matching label
  let bestLabelPts = 0;
  let bestLabel = '';
  for (const label of item.labels) {
    const lp = config.labelPriority[label] ?? config.labelPriority[label.toLowerCase()] ?? 0;
    if (lp > bestLabelPts) { bestLabelPts = lp; bestLabel = label; }
  }
  const labelScore = (bestLabelPts / 100) * 25;
  score += labelScore;
  if (bestLabel) reasons.push(`label:${bestLabel}(${labelScore.toFixed(0)})`);

  // Age (0-15 points) — older items score higher, max at 14 days
  const ageMs = Date.now() - new Date(item.createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const agePts = Math.min(15, (ageDays / 14) * 15);
  score += agePts;
  reasons.push(`age:${ageDays.toFixed(1)}d(${agePts.toFixed(0)})`);

  // VIP author (0-15 points)
  if (item.author && config.vipAuthors.includes(item.author)) {
    score += 15;
    reasons.push(`vip:${item.author}(15)`);
  }

  // Complexity penalty (0 to -10 points) — complex items slightly deprioritized
  const complexityPenalty = Math.min(10, (item.estimatedMinutes / 60) * 10);
  score -= complexityPenalty;
  reasons.push(`complexity:-${complexityPenalty.toFixed(0)}`);

  // Type bonus (0-10 points)
  const typeBonus: Record<WorkItem['type'], number> = {
    'incident': 10,
    'bug-fix': 8,
    'review': 5,
    'feature': 3,
    'maintenance': 2,
  };
  const tBonus = typeBonus[item.type] ?? 0;
  score += tBonus;
  reasons.push(`type:${item.type}(${tBonus})`);

  // Confidence bonus (0-5 points) — higher confidence = slightly preferred
  const confBonus = (item.confidence / 100) * 5;
  score += confBonus;

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasoning: reasons.join(', ') };
}

// ---------------------------------------------------------------------------
// Main triage function
// ---------------------------------------------------------------------------

export function triageWorkItems(items: WorkItem[], config: TriageConfig): TriageResult[] {
  let remainingBudget = config.dailyBudget;

  // Enrich items with classification and estimates if not already set
  for (const item of items) {
    if (!item.type) {
      item.type = classifyType(item);
    }
    if (!item.estimatedCost || !item.estimatedMinutes) {
      const est = estimateComplexity(item);
      item.estimatedCost = item.estimatedCost || est.cost;
      item.estimatedMinutes = item.estimatedMinutes || est.minutes;
    }
    if (!item.confidence) {
      item.confidence = estimateConfidence(item);
    }
  }

  // Score all items
  const results: TriageResult[] = items.map((item) => {
    const { score, reasoning } = scoreItem(item, config);
    return { item: { ...item, priority: score }, score, reasoning, withinBudget: true };
  });

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Budget check
  for (const result of results) {
    const itemCost = Math.min(result.item.estimatedCost, config.perItemBudget);
    if (itemCost <= remainingBudget) {
      remainingBudget -= itemCost;
      result.withinBudget = true;
    } else {
      result.withinBudget = false;
    }
  }

  return results;
}
