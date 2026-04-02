import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Decision {
  id: string;
  timestamp: number;
  type: 'auto-merge' | 'confidence-gate' | 'review-verdict' | 'fix-approach' | 'skip-item' | 'model-choice' | 'scope-decision' | 'retry-decision';
  context: string;
  decision: string;
  reasoning: string;
  confidence: number;
  alternatives: string[];
  outcome?: 'success' | 'failure' | 'pending';
  outcomeDetail?: string;
  outcomeTimestamp?: number;
}

export interface JournalRule {
  id: string;
  rule: string;
  source: string;
  createdAt: number;
  enabled: boolean;
  appliesTo: string[];
}

export interface CalibrationReport {
  totalDecisions: number;
  accuracyByType: Array<{ type: string; total: number; successful: number; accuracy: number }>;
  overconfident: Decision[];
  underconfident: Decision[];
  rules: JournalRule[];
  recommendations: string[];
}

function ensureJournalDir(swarmDir: string): string {
  const journalDir = join(swarmDir, 'journal');
  if (!existsSync(journalDir)) {
    mkdirSync(journalDir, { recursive: true });
  }
  return journalDir;
}

function decisionsPath(swarmDir: string): string {
  return join(ensureJournalDir(swarmDir), 'decisions.jsonl');
}

function rulesPath(swarmDir: string): string {
  return join(ensureJournalDir(swarmDir), 'rules.json');
}

function readAllDecisions(swarmDir: string): Decision[] {
  const filePath = decisionsPath(swarmDir);
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line) as Decision; } catch { return null; }
      })
      .filter(Boolean) as Decision[];
  } catch {
    return [];
  }
}

function writeAllDecisions(swarmDir: string, decisions: Decision[]): void {
  const filePath = decisionsPath(swarmDir);
  ensureJournalDir(swarmDir);
  const content = decisions.map(d => JSON.stringify(d)).join('\n') + (decisions.length > 0 ? '\n' : '');
  writeFileSync(filePath, content);
}

export function logDecision(swarmDir: string, entry: Omit<Decision, 'id' | 'timestamp'>): string {
  const id = `dec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const decision: Decision = {
    id,
    timestamp: Date.now(),
    ...entry,
  };
  const filePath = decisionsPath(swarmDir);
  try {
    appendFileSync(filePath, JSON.stringify(decision) + '\n');
  } catch {
    // Non-critical
  }
  return id;
}

export function updateOutcome(swarmDir: string, decisionId: string, outcome: 'success' | 'failure', detail?: string): void {
  const decisions = readAllDecisions(swarmDir);
  const idx = decisions.findIndex(d => d.id === decisionId);
  if (idx === -1) return;

  decisions[idx].outcome = outcome;
  decisions[idx].outcomeTimestamp = Date.now();
  if (detail) {
    decisions[idx].outcomeDetail = detail;
  }

  writeAllDecisions(swarmDir, decisions);
}

export function getRecentDecisions(swarmDir: string, limit: number = 20): Decision[] {
  const decisions = readAllDecisions(swarmDir);
  // Return newest first
  decisions.sort((a, b) => b.timestamp - a.timestamp);
  return decisions.slice(0, limit);
}

export function runLearningEngine(swarmDir: string): JournalRule[] {
  const decisions = readAllDecisions(swarmDir);
  const resolved = decisions.filter(d => d.outcome === 'success' || d.outcome === 'failure');

  // Compute accuracy per type
  const byType = new Map<string, { total: number; successful: number }>();
  for (const d of resolved) {
    const entry = byType.get(d.type) || { total: 0, successful: 0 };
    entry.total++;
    if (d.outcome === 'success') entry.successful++;
    byType.set(d.type, entry);
  }

  const rules: JournalRule[] = [];
  const now = Date.now();

  for (const [type, stats] of byType) {
    if (stats.total < 3) continue; // Need enough data
    const accuracy = stats.successful / stats.total;

    if (accuracy < 0.8) {
      // Analyze failures in this type for common patterns
      const failures = resolved.filter(d => d.type === type && d.outcome === 'failure');
      const contexts = failures.map(d => d.context).join(' ');

      let ruleText: string;
      if (accuracy < 0.5) {
        ruleText = `CRITICAL: ${type} decisions have only ${(accuracy * 100).toFixed(0)}% accuracy (${stats.successful}/${stats.total}). Require manual review before proceeding.`;
      } else {
        ruleText = `WARNING: ${type} decisions have ${(accuracy * 100).toFixed(0)}% accuracy (${stats.successful}/${stats.total}). Consider additional validation.`;
      }

      rules.push({
        id: `rule-${type}-${now}`,
        rule: ruleText,
        source: `learning-engine: analyzed ${stats.total} decisions`,
        createdAt: now,
        enabled: true,
        appliesTo: [type],
      });

      // Check if high-confidence failures are common
      const highConfFailures = failures.filter(d => d.confidence > 0.8);
      if (highConfFailures.length >= 2) {
        rules.push({
          id: `rule-${type}-overconf-${now}`,
          rule: `Overconfidence detected in ${type}: ${highConfFailures.length} high-confidence failures. Lower default confidence threshold.`,
          source: `learning-engine: ${highConfFailures.length} failures with >80% confidence`,
          createdAt: now,
          enabled: true,
          appliesTo: [type],
        });
      }
    }
  }

  // Save rules
  const existingRules = getJournalRules(swarmDir);
  const allRules = [...existingRules, ...rules];
  const filePath = rulesPath(swarmDir);
  try {
    writeFileSync(filePath, JSON.stringify(allRules, null, 2));
  } catch {
    // Non-critical
  }

  return rules;
}

export function runCalibration(swarmDir: string): CalibrationReport {
  const decisions = readAllDecisions(swarmDir);
  const resolved = decisions.filter(d => d.outcome === 'success' || d.outcome === 'failure');

  // Accuracy by type
  const byType = new Map<string, { total: number; successful: number }>();
  for (const d of resolved) {
    const entry = byType.get(d.type) || { total: 0, successful: 0 };
    entry.total++;
    if (d.outcome === 'success') entry.successful++;
    byType.set(d.type, entry);
  }

  const accuracyByType = Array.from(byType.entries()).map(([type, stats]) => ({
    type,
    total: stats.total,
    successful: stats.successful,
    accuracy: stats.total > 0 ? stats.successful / stats.total : 0,
  }));

  // Overconfident: >90% confidence but failed
  const overconfident = resolved.filter(d => d.confidence > 0.9 && d.outcome === 'failure');

  // Underconfident: <60% confidence but succeeded
  const underconfident = resolved.filter(d => d.confidence < 0.6 && d.outcome === 'success');

  const rules = getJournalRules(swarmDir);

  // Generate recommendations
  const recommendations: string[] = [];

  if (overconfident.length > 0) {
    recommendations.push(`${overconfident.length} decision(s) were overconfident (>90% confidence but failed). Consider lowering confidence thresholds.`);
  }
  if (underconfident.length > 0) {
    recommendations.push(`${underconfident.length} decision(s) were underconfident (<60% confidence but succeeded). These areas may be safer than assumed.`);
  }

  const lowAccuracyTypes = accuracyByType.filter(a => a.accuracy < 0.7 && a.total >= 3);
  for (const t of lowAccuracyTypes) {
    recommendations.push(`"${t.type}" has ${(t.accuracy * 100).toFixed(0)}% accuracy across ${t.total} decisions. Needs attention.`);
  }

  if (resolved.length === 0) {
    recommendations.push('No decisions with outcomes yet. Update outcomes to enable calibration analysis.');
  }

  if (decisions.length > 0 && resolved.length / decisions.length < 0.5) {
    recommendations.push(`Only ${((resolved.length / decisions.length) * 100).toFixed(0)}% of decisions have outcomes recorded. Track more outcomes for better analysis.`);
  }

  return {
    totalDecisions: decisions.length,
    accuracyByType,
    overconfident,
    underconfident,
    rules,
    recommendations,
  };
}

export function getJournalRules(swarmDir: string): JournalRule[] {
  const filePath = rulesPath(swarmDir);
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as JournalRule[];
  } catch {
    return [];
  }
}
