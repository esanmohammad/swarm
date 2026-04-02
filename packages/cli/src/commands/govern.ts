import chalk from 'chalk';
import type { Command } from 'commander';
import { requireSwarmDir } from '../core/config.js';
import { GovernanceEngine, LEVEL_LABELS } from '../core/governance.js';
import type { GovernanceLevel, GovernanceDecision } from '../types.js';

const LEVEL_COLORS: Record<GovernanceLevel, (s: string) => string> = {
  1: chalk.green,
  2: chalk.cyan,
  3: chalk.yellow,
  4: chalk.red,
  5: chalk.bgRed.white,
};

function trustBar(score: number): string {
  const filled = Math.round(score / 5);
  const empty = 20 - filled;
  const color = score >= 70 ? chalk.green : score >= 40 ? chalk.yellow : chalk.red;
  return color('\u2588'.repeat(filled)) + chalk.dim('\u2591'.repeat(empty));
}

function formatDecision(d: GovernanceDecision): void {
  const time = new Date(d.timestamp).toLocaleString();
  const levelColor = LEVEL_COLORS[d.level] ?? chalk.white;
  const statusColor =
    d.status === 'auto-approved' || d.status === 'approved' ? chalk.green
    : d.status === 'rejected' ? chalk.red
    : d.status === 'overridden' ? chalk.magenta
    : chalk.yellow;

  console.log(`  ${chalk.dim(d.id)}  ${levelColor(`L${d.level}`)} ${chalk.bold(d.action)}`);
  console.log(`    ${chalk.dim('Domain:')} ${d.domain}  ${chalk.dim('Status:')} ${statusColor(d.status)}  ${chalk.dim('Confidence:')} ${d.confidence}%`);
  console.log(`    ${chalk.dim('Reasoning:')} ${d.reasoning}`);
  if (d.alternatives.length > 0) {
    console.log(`    ${chalk.dim('Alternatives:')} ${d.alternatives.join(', ')}`);
  }
  if (d.outcome) {
    const outcomeColor = d.outcome === 'success' ? chalk.green : chalk.red;
    console.log(`    ${chalk.dim('Outcome:')} ${outcomeColor(d.outcome)}`);
  }
  console.log(`    ${chalk.dim(time)}`);
}

export function registerGovern(program: Command): void {
  const govern = program
    .command('govern')
    .description('Autonomous decision governance framework')
    .action(async () => {
      const swarmDir = requireSwarmDir();
      const engine = new GovernanceEngine(swarmDir);
      const state = engine.getState();

      console.log(chalk.bold('\nGovernance Overview\n'));

      // Summary stats
      console.log(`  ${chalk.dim('Total decisions:')}  ${state.totalDecisions}`);
      console.log(`  ${chalk.dim('Overrides:')}        ${state.overrides}`);
      console.log(`  ${chalk.dim('Autonomous rate:')}  ${state.autonomousRate}%`);
      console.log();

      // Policy summary table
      console.log(chalk.bold('  Domain                   Level  Trust'));
      console.log(chalk.dim('  ' + '\u2500'.repeat(50)));

      for (const policy of state.policies) {
        const levelColor = LEVEL_COLORS[policy.level] ?? chalk.white;
        const label = LEVEL_LABELS[policy.level];
        console.log(
          `  ${policy.domain.padEnd(25)} ${levelColor(`L${policy.level} ${label.padEnd(18)}`)} ${trustBar(policy.trustScore)} ${policy.trustScore}`
        );
      }

      // Budget summary
      const budgetEntries = Object.entries(state.budgetAllocation);
      if (budgetEntries.length > 0) {
        console.log(chalk.bold('\n  Budget Allocation'));
        console.log(chalk.dim('  ' + '\u2500'.repeat(50)));
        for (const [surface, budget] of budgetEntries) {
          const pct = budget.allocated > 0 ? Math.round((budget.spent / budget.allocated) * 100) : 0;
          const color = pct > 90 ? chalk.red : pct > 70 ? chalk.yellow : chalk.green;
          console.log(
            `  ${surface.padEnd(25)} ${color(`$${budget.spent.toFixed(2)}`)} / $${budget.allocated.toFixed(2)} (${pct}%)`
          );
        }
      }

      // Recent decisions
      const recent = engine.getAuditTrail(5);
      if (recent.length > 0) {
        console.log(chalk.bold('\n  Recent Decisions'));
        console.log(chalk.dim('  ' + '\u2500'.repeat(50)));
        for (const d of recent) {
          formatDecision(d);
          console.log();
        }
      }

      console.log();
    });

  // ── status ──────────────────────────────────────────────

  govern
    .command('status')
    .description('Show autonomy levels and trust scores')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const engine = new GovernanceEngine(swarmDir);
      const state = engine.getState();

      if (opts.json) {
        console.log(JSON.stringify({
          policies: state.policies,
          trustScores: state.trustScores,
          autonomousRate: state.autonomousRate,
          totalDecisions: state.totalDecisions,
          overrides: state.overrides,
        }, null, 2));
        return;
      }

      console.log(chalk.bold('\nGovernance Status\n'));

      for (const policy of state.policies) {
        const levelColor = LEVEL_COLORS[policy.level] ?? chalk.white;
        const label = LEVEL_LABELS[policy.level];

        console.log(`  ${chalk.bold(policy.domain)}`);
        console.log(`    Level:      ${levelColor(`${policy.level} — ${label}`)}`);
        console.log(`    Trust:      ${trustBar(policy.trustScore)} ${policy.trustScore}/100`);
        console.log(`    Promote at: ${policy.autoPromoteThreshold}`);
        console.log(`    Demote on revert: ${policy.autoDemoteOnRevert ? chalk.yellow('yes') : chalk.dim('no')}`);
        console.log();
      }

      console.log(chalk.dim(`  Autonomous rate: ${state.autonomousRate}% | Total decisions: ${state.totalDecisions} | Overrides: ${state.overrides}\n`));
    });

  // ── policy ──────────────────────────────────────────────

  govern
    .command('policy')
    .description('Show or edit governance policy for a domain')
    .option('-d, --domain <domain>', 'Domain to show/edit')
    .option('-l, --level <level>', 'Set governance level (1-5)')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const engine = new GovernanceEngine(swarmDir);

      // If setting a level
      if (opts.domain && opts.level) {
        const level = parseInt(opts.level, 10) as GovernanceLevel;
        if (level < 1 || level > 5) {
          console.error(chalk.red('Level must be between 1 and 5.'));
          process.exitCode = 1;
          return;
        }
        engine.setPolicy(opts.domain, level);
        console.log(chalk.green(`Policy for "${opts.domain}" set to level ${level} — ${LEVEL_LABELS[level]}`));
        return;
      }

      // Show policy for a specific domain
      if (opts.domain) {
        const policy = engine.getPolicy(opts.domain);
        if (!policy) {
          console.log(chalk.dim(`No policy found for domain "${opts.domain}".`));
          return;
        }
        if (opts.json) {
          console.log(JSON.stringify(policy, null, 2));
          return;
        }
        const levelColor = LEVEL_COLORS[policy.level] ?? chalk.white;
        console.log(chalk.bold(`\nPolicy: ${policy.domain}\n`));
        console.log(`  Level:              ${levelColor(`${policy.level} — ${LEVEL_LABELS[policy.level]}`)}`);
        console.log(`  Trust Score:        ${trustBar(policy.trustScore)} ${policy.trustScore}/100`);
        console.log(`  Auto-promote at:    ${policy.autoPromoteThreshold}`);
        console.log(`  Demote on revert:   ${policy.autoDemoteOnRevert ? 'yes' : 'no'}`);
        console.log();
        return;
      }

      // Show all policies
      const state = engine.getState();
      if (opts.json) {
        console.log(JSON.stringify(state.policies, null, 2));
        return;
      }

      console.log(chalk.bold('\nAll Governance Policies\n'));
      console.log(`  ${'Domain'.padEnd(25)} ${'Level'.padEnd(22)} ${'Trust'.padEnd(6)} ${'Promote At'.padEnd(12)} Demote`);
      console.log(chalk.dim('  ' + '\u2500'.repeat(75)));

      for (const p of state.policies) {
        const levelColor = LEVEL_COLORS[p.level] ?? chalk.white;
        console.log(
          `  ${p.domain.padEnd(25)} ${levelColor(`L${p.level} ${LEVEL_LABELS[p.level]}`.padEnd(22))} ${String(p.trustScore).padEnd(6)} ${String(p.autoPromoteThreshold).padEnd(12)} ${p.autoDemoteOnRevert ? 'yes' : 'no'}`
        );
      }
      console.log();
    });

  // ── audit ───────────────────────────────────────────────

  govern
    .command('audit')
    .description('View the decision audit trail')
    .option('-n, --limit <count>', 'Number of entries to show', '20')
    .option('-d, --domain <domain>', 'Filter by domain')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const engine = new GovernanceEngine(swarmDir);
      const limit = parseInt(opts.limit, 10) || 20;

      let trail = engine.getAuditTrail(limit);

      if (opts.domain) {
        trail = trail.filter(d => d.domain === opts.domain);
      }

      if (trail.length === 0) {
        console.log(chalk.dim('No governance decisions recorded yet.'));
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(trail, null, 2));
        return;
      }

      console.log(chalk.bold(`\nDecision Audit Trail — ${trail.length} entries\n`));

      for (const d of trail) {
        formatDecision(d);
        console.log();
      }
    });

  // ── trust ───────────────────────────────────────────────

  govern
    .command('trust')
    .description('Show trust score details per domain')
    .option('-d, --domain <domain>', 'Show specific domain')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const engine = new GovernanceEngine(swarmDir);
      const state = engine.getState();

      if (opts.json) {
        console.log(JSON.stringify(state.trustScores, null, 2));
        return;
      }

      console.log(chalk.bold('\nTrust Scores\n'));

      const domains = opts.domain
        ? [opts.domain]
        : Object.keys(state.trustScores).sort();

      for (const domain of domains) {
        const score = state.trustScores[domain];
        if (score === undefined) {
          console.log(chalk.dim(`  No trust score for "${domain}".`));
          continue;
        }

        const policy = engine.getPolicy(domain);
        const levelColor = policy ? (LEVEL_COLORS[policy.level] ?? chalk.white) : chalk.white;

        console.log(`  ${chalk.bold(domain)}`);
        console.log(`    Score:  ${trustBar(score)} ${score}/100`);

        if (policy) {
          console.log(`    Level:  ${levelColor(`L${policy.level} — ${LEVEL_LABELS[policy.level]}`)}`);
          console.log(`    Promote threshold: ${policy.autoPromoteThreshold}`);
          const gap = policy.autoPromoteThreshold - score;
          if (gap > 0) {
            console.log(`    ${chalk.dim(`${gap} points to auto-promotion`)}`);
          } else {
            console.log(`    ${chalk.green('Eligible for promotion')}`);
          }
        }

        // Domain-specific decision stats
        const decisions = state.decisions.filter(d => d.domain === domain);
        const successes = decisions.filter(d => d.outcome === 'success').length;
        const reverts = decisions.filter(d => d.outcome === 'reverted').length;
        const overrides = decisions.filter(d => d.resolvedBy === 'human-override').length;

        if (decisions.length > 0) {
          console.log(`    Decisions: ${decisions.length} total, ${successes} success, ${reverts} reverted, ${overrides} overrides`);
        }

        console.log();
      }
    });

  // ── override ────────────────────────────────────────────

  govern
    .command('override <decision-id>')
    .description('Override a pending governance decision')
    .requiredOption('-a, --action <action>', 'Action to take: approve or reject')
    .action(async (decisionId: string, opts) => {
      const swarmDir = requireSwarmDir();
      const engine = new GovernanceEngine(swarmDir);

      const action = opts.action as 'approve' | 'reject';
      if (action !== 'approve' && action !== 'reject') {
        console.error(chalk.red('Action must be "approve" or "reject".'));
        process.exitCode = 1;
        return;
      }

      const decision = engine.override(decisionId, action);

      if (!decision) {
        console.error(chalk.red(`Decision "${decisionId}" not found.`));
        process.exitCode = 1;
        return;
      }

      const statusColor = action === 'approve' ? chalk.green : chalk.red;
      console.log(statusColor(`Decision ${decisionId} ${action}d.`));
      console.log(chalk.dim(`  Action: ${decision.action}`));
      console.log(chalk.dim(`  Domain: ${decision.domain}`));
      console.log(chalk.dim(`  Level:  ${decision.level} — ${LEVEL_LABELS[decision.level]}`));

      const state = engine.getState();
      if (state.overrides > 5) {
        console.log(chalk.yellow(`\nNote: ${state.overrides} total overrides recorded. Frequent overrides may reduce domain trust.`));
      }
    });
}
