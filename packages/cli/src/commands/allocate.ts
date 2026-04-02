import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import { ResourceAllocator } from '../core/resource-allocator.js';

export function registerAllocate(program: Command): void {
  const allocate = program
    .command('allocate')
    .description('Resource allocation — priority scoring, what-if scenarios, and OKR generation')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run "swarm init" first.'));
        process.exit(1);
      }

      const allocator = new ResourceAllocator(swarmDir);
      const state = allocator.getState();

      console.log(chalk.bold('\n  Resource Allocation Overview\n'));

      if (state.currentPlan) {
        const plan = state.currentPlan;
        console.log(chalk.bold('  Current Plan'));
        console.log(`    Composite score: ${scoreColor(plan.compositeScore)(plan.compositeScore + '/100')}`);
        console.log(`    Business impact: ${scoreColor(plan.scores.businessImpact)(plan.scores.businessImpact + '/100')}`);
        console.log(`    Tech risk:       ${scoreColor(plan.scores.techRisk)(plan.scores.techRisk + '/100')}`);
        console.log(`    User impact:     ${scoreColor(plan.scores.userImpact)(plan.scores.userImpact + '/100')}`);
        console.log('');

        console.log(chalk.bold('  Allocation'));
        for (const a of plan.allocations) {
          const bar = chalk.cyan('█'.repeat(Math.round(a.percentage / 3)));
          console.log(`    ${a.category.padEnd(16)} ${String(a.percentage).padStart(3)}%  ${bar}`);
          console.log(`    ${' '.repeat(16)} ${chalk.dim(a.rationale)}`);
        }
        console.log('');

        if (plan.insights.length > 0) {
          console.log(chalk.bold('  Insights'));
          for (const insight of plan.insights) {
            console.log(`    ${chalk.yellow('-')} ${insight}`);
          }
          console.log('');
        }

        console.log(chalk.dim(`  Generated: ${new Date(plan.generatedAt).toLocaleString()}`));
        console.log(chalk.dim(`  Based on ${plan.totalBudgetContext.runsAnalyzed} pipeline runs ($${plan.totalBudgetContext.historicalCost.toFixed(2)} total cost)\n`));
      } else {
        console.log(chalk.dim('  No allocation plan generated yet. Run: swarm allocate plan\n'));
      }

      // Show recent scenarios
      if (state.scenarios.length > 0) {
        console.log(chalk.bold('  Recent Scenarios'));
        for (const s of state.scenarios.slice(-3)) {
          console.log(`    ${chalk.cyan(s.type.padEnd(22))} "${chalk.dim(s.description)}"  ${chalk.dim(new Date(s.runAt).toLocaleDateString())}`);
        }
        console.log('');
      }

      // Show OKRs summary
      if (state.okrs.length > 0) {
        console.log(chalk.bold('  Active OKRs'));
        for (const okr of state.okrs) {
          console.log(`    ${chalk.cyan(okr.category.padEnd(14))} ${okr.objective}`);
          for (const kr of okr.keyResults) {
            const progress = kr.target !== 0
              ? Math.round((kr.current / kr.target) * 100)
              : 0;
            const progressColor = progress >= 80 ? chalk.green : progress >= 50 ? chalk.yellow : chalk.red;
            console.log(`      ${kr.metric.padEnd(28)} ${progressColor(`${kr.current}${kr.unit}`)} → ${chalk.dim(`${kr.target}${kr.unit}`)}`);
          }
        }
        console.log('');
      }
    });

  // ── plan ────────────────────────────────────────────────────────────────────

  allocate
    .command('plan')
    .description('Generate a resource allocation recommendation')
    .option('--format <format>', 'Output format: table or json', 'table')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run "swarm init" first.'));
        process.exit(1);
      }

      const allocator = new ResourceAllocator(swarmDir);
      const plan = allocator.generatePlan();

      if (opts.format === 'json') {
        console.log(JSON.stringify(plan, null, 2));
        return;
      }

      console.log(chalk.bold('\n  Resource Allocation Plan\n'));

      // Scores
      console.log(chalk.bold('  Priority Scores'));
      console.log(`    Business impact: ${scoreColor(plan.scores.businessImpact)(plan.scores.businessImpact + '/100')}`);
      console.log(`    Tech risk:       ${scoreColor(plan.scores.techRisk)(plan.scores.techRisk + '/100')}`);
      console.log(`    User impact:     ${scoreColor(plan.scores.userImpact)(plan.scores.userImpact + '/100')}`);
      console.log(`    ${chalk.bold('Composite:')}      ${scoreColor(plan.compositeScore)(plan.compositeScore + '/100')}`);
      console.log('');

      // Allocation breakdown
      console.log(chalk.bold('  Recommended Allocation'));
      for (const a of plan.allocations) {
        const bar = chalk.cyan('█'.repeat(Math.round(a.percentage / 2)));
        console.log(`    ${a.category.padEnd(16)} ${String(a.percentage).padStart(3)}%  ${bar}`);
        console.log(`    ${' '.repeat(16)} ${chalk.dim(a.rationale)}`);
      }
      console.log('');

      // Insights
      if (plan.insights.length > 0) {
        console.log(chalk.bold('  Key Insights'));
        for (const insight of plan.insights) {
          console.log(`    ${chalk.yellow('-')} ${insight}`);
        }
        console.log('');
      }

      // Context
      console.log(chalk.dim(`  Based on ${plan.totalBudgetContext.runsAnalyzed} pipeline runs ($${plan.totalBudgetContext.historicalCost.toFixed(2)} total cost)`));
      console.log(chalk.dim('  Saved to .swarm/allocate-state.json\n'));
    });

  // ── scenario ────────────────────────────────────────────────────────────────

  allocate
    .command('scenario <scenario>')
    .description('Run a what-if scenario analysis (e.g., "more features", "reduce budget", "improve reliability")')
    .option('--format <format>', 'Output format: table or json', 'table')
    .action((scenario: string, opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run "swarm init" first.'));
        process.exit(1);
      }

      const allocator = new ResourceAllocator(swarmDir);
      const result = allocator.runScenario(scenario);

      if (opts.format === 'json') {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(chalk.bold('\n  What-If Scenario Analysis\n'));
      console.log(`  Scenario:   ${chalk.cyan(`"${result.description}"`)}`);
      console.log(`  Type:       ${chalk.dim(result.type)}`);
      console.log(`  Confidence: ${chalk.dim(result.confidence + '%')}`);
      console.log('');

      // Adjustments table
      console.log(chalk.bold('  Allocation Adjustments'));
      for (const adj of result.adjustments) {
        const delta = adj.proposedPct - adj.currentPct;
        const deltaStr = delta > 0 ? chalk.green(`+${delta}%`) : delta < 0 ? chalk.red(`${delta}%`) : chalk.dim('0%');
        const currentBar = chalk.dim('█'.repeat(Math.round(adj.currentPct / 3)));
        const proposedBar = chalk.cyan('█'.repeat(Math.round(adj.proposedPct / 3)));
        console.log(`    ${adj.category.padEnd(16)} ${String(adj.currentPct).padStart(3)}% → ${String(adj.proposedPct).padStart(3)}% (${deltaStr})`);
        console.log(`      Current:  ${currentBar}`);
        console.log(`      Proposed: ${proposedBar}`);
      }
      console.log('');

      // Predicted outcome
      console.log(chalk.bold('  Predicted Outcome'));
      console.log(`    Velocity:       ${chalk.dim(result.predictedOutcome.velocityChange)}`);
      console.log(`    Risk:           ${chalk.dim(result.predictedOutcome.riskChange)}`);
      console.log(`    Cost:           ${chalk.dim(result.predictedOutcome.costChange)}`);
      console.log('');
      console.log(`    ${chalk.bold('Recommendation:')} ${result.predictedOutcome.recommendation}`);
      console.log('');

      console.log(chalk.dim('  Saved to .swarm/allocate-state.json\n'));
    });

  // ── okrs ────────────────────────────────────────────────────────────────────

  allocate
    .command('okrs')
    .description('Generate engineering OKRs from business goals and project data')
    .option('--goals <goals>', 'Comma-separated business goals (e.g., "velocity,quality,cost")')
    .option('--format <format>', 'Output format: table or json', 'table')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run "swarm init" first.'));
        process.exit(1);
      }

      const goals = opts.goals
        ? (opts.goals as string).split(',').map((g: string) => g.trim()).filter(Boolean)
        : undefined;

      const allocator = new ResourceAllocator(swarmDir);
      const okrs = allocator.generateOkrs(goals);

      if (opts.format === 'json') {
        console.log(JSON.stringify(okrs, null, 2));
        return;
      }

      console.log(chalk.bold('\n  Engineering OKRs\n'));

      if (okrs.length === 0) {
        console.log(chalk.dim('  No OKRs generated. Run more pipelines to generate baseline data.\n'));
        return;
      }

      for (const okr of okrs) {
        console.log(`  ${chalk.bold(okr.objective)}`);
        console.log(`  ${chalk.dim(`Category: ${okr.category}  Confidence: ${okr.confidence}%`)}`);
        console.log('');

        for (const kr of okr.keyResults) {
          const progress = kr.target !== 0
            ? Math.round((kr.current / kr.target) * 100)
            : 0;
          const progressColor = progress >= 80 ? chalk.green : progress >= 50 ? chalk.yellow : chalk.red;
          const progressBar = progressColor('█'.repeat(Math.round(Math.min(progress, 100) / 5)));
          const emptyBar = chalk.dim('░'.repeat(20 - Math.round(Math.min(progress, 100) / 5)));

          console.log(`    ${kr.metric.padEnd(28)} ${String(kr.current).padStart(6)}${kr.unit} → ${chalk.bold(String(kr.target) + kr.unit)}`);
          console.log(`    ${''.padEnd(28)} ${progressBar}${emptyBar} ${progressColor(progress + '%')}`);
        }
        console.log('');
      }

      if (goals) {
        console.log(chalk.dim(`  Generated from goals: ${goals.join(', ')}`));
      } else {
        console.log(chalk.dim('  Generated from baseline analysis. Use --goals to target specific objectives.'));
      }
      console.log(chalk.dim('  Saved to .swarm/allocate-state.json\n'));
    });
}

// ── Display helpers ───────────────────────────────────────────────────────────

function scoreColor(score: number): (text: string) => string {
  if (score >= 70) return chalk.green;
  if (score >= 40) return chalk.yellow;
  return chalk.red;
}
