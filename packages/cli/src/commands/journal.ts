import chalk from 'chalk';
import type { Command } from 'commander';
import { requireSwarmDir } from '../core/config.js';
import {
  getRecentDecisions,
  runLearningEngine,
  runCalibration,
  getJournalRules,
} from '../core/decision-journal.js';

export function registerJournal(program: Command): void {
  const cmd = program
    .command('journal')
    .description('Decision journal — track decisions, outcomes, and learnings')
    .action(async () => {
      showRecent();
    });

  cmd
    .command('recent')
    .description('Show recent decisions with outcomes')
    .option('-n, --limit <count>', 'Number of entries to show', '20')
    .action(async (opts) => {
      showRecent(parseInt(opts.limit, 10) || 20);
    });

  cmd
    .command('analyze')
    .description('Run learning engine and show findings')
    .action(async () => {
      const swarmDir = requireSwarmDir();
      const newRules = runLearningEngine(swarmDir);
      const allRules = getJournalRules(swarmDir);

      if (newRules.length === 0) {
        console.log(chalk.dim('No new rules generated. Need more decisions with outcomes (minimum 3 per type).'));
      } else {
        console.log(chalk.bold.cyan(`Learning engine generated ${newRules.length} new rule(s):\n`));
        for (const rule of newRules) {
          const icon = rule.rule.startsWith('CRITICAL') ? chalk.red('\u2718') : chalk.yellow('\u26A0');
          console.log(`  ${icon}  ${chalk.white(rule.rule)}`);
          console.log(chalk.dim(`     Source: ${rule.source}`));
          console.log(chalk.dim(`     Applies to: ${rule.appliesTo.join(', ')}`));
          console.log();
        }
      }

      if (allRules.length > 0) {
        console.log(chalk.dim(`\nTotal rules in journal: ${allRules.length}`));
      }
    });

  cmd
    .command('rules')
    .description('Show auto-generated rules')
    .action(async () => {
      const swarmDir = requireSwarmDir();
      const rules = getJournalRules(swarmDir);

      if (rules.length === 0) {
        console.log(chalk.dim('No rules generated yet. Run "swarm journal analyze" after recording some decisions with outcomes.'));
        return;
      }

      console.log(chalk.bold.cyan(`Decision Journal Rules (${rules.length})\n`));

      for (const rule of rules) {
        const status = rule.enabled ? chalk.green('\u2713 enabled') : chalk.dim('\u2717 disabled');
        const created = new Date(rule.createdAt).toLocaleDateString();

        console.log(`  ${status}  ${chalk.white(rule.rule)}`);
        console.log(chalk.dim(`     ID: ${rule.id}  |  Created: ${created}  |  Applies to: ${rule.appliesTo.join(', ')}`));
        console.log(chalk.dim(`     Source: ${rule.source}`));
        console.log();
      }
    });

  cmd
    .command('calibrate')
    .description('Run calibration report')
    .action(async () => {
      const swarmDir = requireSwarmDir();
      const report = runCalibration(swarmDir);

      console.log(chalk.bold.cyan('Calibration Report\n'));
      console.log(chalk.dim(`Total decisions: ${report.totalDecisions}`));
      console.log();

      // Accuracy by type
      if (report.accuracyByType.length > 0) {
        console.log(chalk.bold('Accuracy by Type:'));
        const maxTotal = Math.max(...report.accuracyByType.map(a => a.total), 1);

        for (const entry of report.accuracyByType) {
          const pct = (entry.accuracy * 100).toFixed(0);
          const barLen = Math.round((entry.total / maxTotal) * 20);
          const bar = entry.accuracy >= 0.8
            ? chalk.green('\u2588'.repeat(Math.round(entry.accuracy * barLen)) + chalk.dim('\u2591'.repeat(barLen - Math.round(entry.accuracy * barLen))))
            : entry.accuracy >= 0.6
              ? chalk.yellow('\u2588'.repeat(Math.round(entry.accuracy * barLen)) + chalk.dim('\u2591'.repeat(barLen - Math.round(entry.accuracy * barLen))))
              : chalk.red('\u2588'.repeat(Math.round(entry.accuracy * barLen)) + chalk.dim('\u2591'.repeat(barLen - Math.round(entry.accuracy * barLen))));

          console.log(`  ${chalk.white(entry.type.padEnd(18))} ${bar} ${pct}% (${entry.successful}/${entry.total})`);
        }
        console.log();
      }

      // Overconfident
      if (report.overconfident.length > 0) {
        console.log(chalk.bold.red(`Overconfident Decisions (${report.overconfident.length}):`));
        for (const d of report.overconfident.slice(0, 5)) {
          const time = new Date(d.timestamp).toLocaleString();
          console.log(`  ${chalk.red('\u2718')}  ${chalk.dim(time)}  ${chalk.white(d.type)}  conf=${chalk.red((d.confidence * 100).toFixed(0) + '%')}`);
          console.log(chalk.dim(`     ${d.context.slice(0, 80)}`));
        }
        console.log();
      }

      // Underconfident
      if (report.underconfident.length > 0) {
        console.log(chalk.bold.green(`Underconfident Decisions (${report.underconfident.length}):`));
        for (const d of report.underconfident.slice(0, 5)) {
          const time = new Date(d.timestamp).toLocaleString();
          console.log(`  ${chalk.green('\u2713')}  ${chalk.dim(time)}  ${chalk.white(d.type)}  conf=${chalk.green((d.confidence * 100).toFixed(0) + '%')}`);
          console.log(chalk.dim(`     ${d.context.slice(0, 80)}`));
        }
        console.log();
      }

      // Recommendations
      if (report.recommendations.length > 0) {
        console.log(chalk.bold('Recommendations:'));
        for (const r of report.recommendations) {
          console.log(`  ${chalk.yellow('\u2192')}  ${chalk.white(r)}`);
        }
        console.log();
      }
    });
}

function showRecent(limit: number = 20): void {
  const swarmDir = requireSwarmDir();
  const decisions = getRecentDecisions(swarmDir, limit);

  if (decisions.length === 0) {
    console.log(chalk.dim('No decisions recorded yet.'));
    return;
  }

  console.log(chalk.dim(`Showing ${decisions.length} most recent decisions\n`));

  for (const d of decisions) {
    const time = new Date(d.timestamp).toLocaleString();
    const outcomeIcon = d.outcome === 'success' ? chalk.green('\u2713')
      : d.outcome === 'failure' ? chalk.red('\u2718')
      : chalk.dim('\u25CB');

    const confColor = d.confidence >= 0.8 ? chalk.green
      : d.confidence >= 0.6 ? chalk.yellow
      : chalk.red;

    const parts = [
      outcomeIcon,
      chalk.dim(time),
      chalk.cyan(d.type.padEnd(18)),
      confColor(`${(d.confidence * 100).toFixed(0)}%`),
      chalk.white(d.decision.slice(0, 50)),
    ];

    console.log(parts.join('  '));

    if (d.outcomeDetail) {
      console.log(chalk.dim(`     ${d.outcomeDetail.slice(0, 80)}`));
    }
  }
}
