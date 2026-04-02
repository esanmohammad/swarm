import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  GovernanceLevel,
  GovernancePolicy,
  GovernanceDecision,
  GovernState,
} from '../types.js';

/** Level descriptions for human display */
export const LEVEL_LABELS: Record<GovernanceLevel, string> = {
  1: 'Full Autonomy',
  2: 'Notify After',
  3: 'Notify Before',
  4: 'Approval Required',
  5: 'Human Only',
};

/** Default domains with initial policies */
const DEFAULT_POLICIES: GovernancePolicy[] = [
  { domain: 'code-generation', level: 2, trustScore: 70, autoPromoteThreshold: 85, autoDemoteOnRevert: true },
  { domain: 'dependency-updates', level: 3, trustScore: 50, autoPromoteThreshold: 80, autoDemoteOnRevert: true },
  { domain: 'architecture', level: 4, trustScore: 30, autoPromoteThreshold: 90, autoDemoteOnRevert: true },
  { domain: 'deployment', level: 5, trustScore: 20, autoPromoteThreshold: 95, autoDemoteOnRevert: true },
  { domain: 'testing', level: 1, trustScore: 80, autoPromoteThreshold: 90, autoDemoteOnRevert: false },
  { domain: 'refactoring', level: 2, trustScore: 65, autoPromoteThreshold: 85, autoDemoteOnRevert: true },
  { domain: 'documentation', level: 1, trustScore: 90, autoPromoteThreshold: 95, autoDemoteOnRevert: false },
  { domain: 'security', level: 5, trustScore: 10, autoPromoteThreshold: 98, autoDemoteOnRevert: true },
];

function emptyState(): GovernState {
  return {
    policies: DEFAULT_POLICIES.map(p => ({ ...p })),
    decisions: [],
    trustScores: Object.fromEntries(DEFAULT_POLICIES.map(p => [p.domain, p.trustScore])),
    overrides: 0,
    totalDecisions: 0,
    autonomousRate: 0,
    budgetAllocation: {},
  };
}

export class GovernanceEngine {
  private state: GovernState;
  private filePath: string;

  constructor(swarmDir: string) {
    if (!existsSync(swarmDir)) {
      mkdirSync(swarmDir, { recursive: true });
    }
    this.filePath = join(swarmDir, 'governance.json');
    this.state = this.load();
  }

  // ── Persistence ──────────────────────────────────────────

  private load(): GovernState {
    if (!existsSync(this.filePath)) return emptyState();
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw) as GovernState;
    } catch {
      return emptyState();
    }
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  // ── Decision Classification ──────────────────────────────

  /**
   * Classify an action within a domain into a governance level.
   * Returns the level from the matching policy, falling back to level 4
   * for unknown domains.
   */
  classifyDecision(action: string, domain: string): GovernanceDecision {
    const policy = this.state.policies.find(p => p.domain === domain);
    const level: GovernanceLevel = policy?.level ?? 4;
    const trustScore = this.state.trustScores[domain] ?? 50;

    // Confidence based on trust score and number of prior decisions
    const domainDecisions = this.state.decisions.filter(d => d.domain === domain);
    const historyFactor = Math.min(domainDecisions.length / 20, 1);
    const confidence = Math.round(trustScore * 0.7 + historyFactor * 30);

    const decision: GovernanceDecision = {
      id: randomUUID().slice(0, 8),
      action,
      domain,
      level,
      confidence,
      reasoning: this.buildReasoning(action, domain, level, trustScore),
      alternatives: this.suggestAlternatives(level),
      status: level <= 2 ? 'auto-approved' : 'pending',
      timestamp: Date.now(),
    };

    return decision;
  }

  private buildReasoning(action: string, domain: string, level: GovernanceLevel, trust: number): string {
    const parts: string[] = [];
    parts.push(`Domain "${domain}" policy is ${LEVEL_LABELS[level]} (level ${level}).`);
    parts.push(`Current trust score: ${trust}/100.`);
    if (level <= 2) {
      parts.push('Auto-approved based on autonomy level and trust score.');
    } else if (level <= 4) {
      parts.push('Requires approval before proceeding.');
    } else {
      parts.push('Human-only domain — must be performed manually.');
    }
    return parts.join(' ');
  }

  private suggestAlternatives(level: GovernanceLevel): string[] {
    const alts: string[] = [];
    if (level >= 4) alts.push('Delegate to lower-trust sub-task');
    if (level >= 3) alts.push('Request scope reduction');
    if (level >= 2) alts.push('Add automated verification step');
    return alts;
  }

  // ── Decision Recording ───────────────────────────────────

  /** Record a classified decision and persist it. */
  recordDecision(decision: GovernanceDecision): void {
    this.state.decisions.push(decision);
    this.state.totalDecisions++;

    // Update autonomous rate
    const autoCount = this.state.decisions.filter(d => d.status === 'auto-approved').length;
    this.state.autonomousRate = Math.round((autoCount / this.state.totalDecisions) * 100);

    this.save();
  }

  // ── Override Mechanism ───────────────────────────────────

  /**
   * Override a pending decision.
   * Logs the override and auto-reduces trust on repeated overrides.
   */
  override(decisionId: string, action: 'approve' | 'reject'): GovernanceDecision | null {
    const decision = this.state.decisions.find(d => d.id === decisionId);
    if (!decision) return null;

    decision.status = action === 'approve' ? 'approved' : 'rejected';
    decision.resolvedAt = Date.now();
    decision.resolvedBy = 'human-override';
    this.state.overrides++;

    // Count recent overrides for this domain (last 20 decisions)
    const domainDecisions = this.state.decisions
      .filter(d => d.domain === decision.domain)
      .slice(-20);
    const recentOverrides = domainDecisions.filter(
      d => d.resolvedBy === 'human-override'
    ).length;

    // Auto-reduce trust if repeated overrides (more than 3 in last 20)
    if (recentOverrides > 3) {
      const trustDelta = Math.min(recentOverrides * 2, 15);
      this.adjustTrust(decision.domain, -trustDelta);
    }

    this.save();
    return decision;
  }

  // ── Trust Scoring ────────────────────────────────────────

  /** Get the current trust score for a domain. */
  getTrustScore(domain: string): number {
    return this.state.trustScores[domain] ?? 50;
  }

  /**
   * Adjust trust for a domain. Positive delta = increase on success,
   * negative delta = decrease on revert/incident.
   */
  adjustTrust(domain: string, delta: number): void {
    const current = this.state.trustScores[domain] ?? 50;
    const updated = Math.max(0, Math.min(100, current + delta));
    this.state.trustScores[domain] = updated;

    // Update matching policy's trustScore
    const policy = this.state.policies.find(p => p.domain === domain);
    if (policy) {
      policy.trustScore = updated;
    }

    // Auto-promote / demote based on thresholds
    this.evaluatePromotion(domain);
    this.save();
  }

  /** Record a successful outcome — increases trust. */
  recordSuccess(domain: string): void {
    this.adjustTrust(domain, 3);
    // Update last decision outcome
    const last = [...this.state.decisions]
      .reverse()
      .find(d => d.domain === domain && !d.outcome);
    if (last) {
      last.outcome = 'success';
    }
    this.save();
  }

  /** Record a revert/incident — decreases trust. */
  recordIncident(domain: string): void {
    this.adjustTrust(domain, -10);
    const policy = this.state.policies.find(p => p.domain === domain);
    if (policy?.autoDemoteOnRevert) {
      this.demotePolicy(domain);
    }
    // Update last decision outcome
    const last = [...this.state.decisions]
      .reverse()
      .find(d => d.domain === domain && !d.outcome);
    if (last) {
      last.outcome = 'reverted';
    }
    this.save();
  }

  // ── Auto-Promote / Demote ────────────────────────────────

  private evaluatePromotion(domain: string): void {
    const policy = this.state.policies.find(p => p.domain === domain);
    if (!policy) return;

    const trust = this.state.trustScores[domain] ?? 50;

    // Auto-promote: trust exceeds threshold and level > 1
    if (trust >= policy.autoPromoteThreshold && policy.level > 1) {
      policy.level = (policy.level - 1) as GovernanceLevel;
    }
  }

  private demotePolicy(domain: string): void {
    const policy = this.state.policies.find(p => p.domain === domain);
    if (!policy || policy.level >= 5) return;
    policy.level = (policy.level + 1) as GovernanceLevel;
  }

  // ── Policy Management ────────────────────────────────────

  /** Get the policy for a specific domain. */
  getPolicy(domain: string): GovernancePolicy | undefined {
    return this.state.policies.find(p => p.domain === domain);
  }

  /** Set or update the policy for a domain. */
  setPolicy(domain: string, level: GovernanceLevel): void {
    const existing = this.state.policies.find(p => p.domain === domain);
    if (existing) {
      existing.level = level;
    } else {
      this.state.policies.push({
        domain,
        level,
        trustScore: this.state.trustScores[domain] ?? 50,
        autoPromoteThreshold: 85,
        autoDemoteOnRevert: true,
      });
      if (!(domain in this.state.trustScores)) {
        this.state.trustScores[domain] = 50;
      }
    }
    this.save();
  }

  // ── Budget Governance ────────────────────────────────────

  /** Set a budget allocation for a surface/priority. */
  allocateBudget(surface: string, amount: number): void {
    this.state.budgetAllocation[surface] = {
      allocated: amount,
      spent: this.state.budgetAllocation[surface]?.spent ?? 0,
    };
    this.save();
  }

  /** Record spend against a surface budget. Returns true if within budget. */
  recordSpend(surface: string, amount: number): boolean {
    const alloc = this.state.budgetAllocation[surface];
    if (!alloc) return true; // No budget constraint
    alloc.spent += amount;
    this.save();
    return alloc.spent <= alloc.allocated;
  }

  /** Check if a surface is within budget. */
  isWithinBudget(surface: string): boolean {
    const alloc = this.state.budgetAllocation[surface];
    if (!alloc) return true;
    return alloc.spent <= alloc.allocated;
  }

  // ── Audit Trail ──────────────────────────────────────────

  /** Get the decision audit trail, optionally limited. */
  getAuditTrail(limit?: number): GovernanceDecision[] {
    const sorted = [...this.state.decisions].sort((a, b) => b.timestamp - a.timestamp);
    return limit ? sorted.slice(0, limit) : sorted;
  }

  // ── State Access ─────────────────────────────────────────

  /** Get the full governance state. */
  getState(): GovernState {
    return this.state;
  }
}
