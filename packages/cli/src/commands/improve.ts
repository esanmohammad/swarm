import chalk from 'chalk';
import type { Command } from 'commander';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import { SelfImprovementEngine } from '../core/self-improvement.js';

export function registerImprove(program: Command): void {
  const improve = program
    .command('improve')
    .description('Self-improving agent loop — analyze runs, tune configuration, generate reports')
    .action(() => {
      // Default action: show current status/tuning
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const engine = new SelfImprovementEngine(swarmDir);
      const state = engine.getState();

      console.log(chalk.bold('\nSelf-Improvement Status\n'));

      // Records summary
      console.log(chalk.bold('  Performance Records'));
      console.log(`    Total recorded runs: ${state.records.length}`);
      if (state.records.length > 0) {
        const latest = state.records[state.records.length - 1];
        console.log(`    Latest run: ${latest.runId} (${new Date(latest.timestamp).toLocaleDateString()})`);
        console.log(`    Latest model: ${chalk.cyan(latest.model)} | Strategy: ${chalk.cyan(latest.strategy)}`);
      } else {
        console.log(chalk.dim('    No runs recorded yet. Run pipelines to populate data.'));
      }
      console.log('');

      // Strategies
      console.log(chalk.bold('  Strategy Analysis'));
      if (state.strategies.length > 0) {
        for (const strat of state.strategies) {
          const rateColor = strat.successRate >= 70 ? chalk.green : strat.successRate >= 40 ? chalk.yellow : chalk.red;
          console.log(`    ${chalk.cyan(strat.strategy)} (${strat.taskType}): ${rateColor(strat.successRate + '%')} success | $${strat.avgCost.toFixed(2)} avg cost | ${strat.sampleSize} runs`);
        }
      } else {
        console.log(chalk.dim('    No strategies analyzed yet. Run `hivemind improve analyze` to generate.'));
      }
      console.log('');

      // Tuning
      console.log(chalk.bold('  Current Tuning'));
      const modelKeys = Object.keys(state.tuning.modelOverrides);
      const stratKeys = Object.keys(state.tuning.strategyOverrides);
      if (modelKeys.length === 0 && stratKeys.length === 0 && state.tuning.promptVariants.length === 0) {
        console.log(chalk.dim('    No tuning applied. Run `hivemind improve apply` to auto-tune.'));
      } else {
        if (modelKeys.length > 0) {
          console.log('    Model overrides:');
          for (const key of modelKeys) {
            console.log(`      ${key} ${chalk.yellow('->')} ${chalk.cyan(state.tuning.modelOverrides[key])}`);
          }
        }
        if (stratKeys.length > 0) {
          console.log('    Strategy overrides:');
          for (const key of stratKeys) {
            console.log(`      ${key} ${chalk.yellow('->')} ${chalk.cyan(state.tuning.strategyOverrides[key])}`);
          }
        }
        if (state.tuning.promptVariants.length > 0) {
          console.log('    Prompt variants:');
          for (const v of state.tuning.promptVariants) {
            console.log(`      ${v.persona}: ${v.variant} (effectiveness: ${v.effectivenessScore}%)`);
          }
        }
      }
      console.log('');

      // Report
      if (state.report) {
        console.log(chalk.bold('  Latest Report'));
        console.log(`    Generated: ${new Date(state.report.generatedAt).toLocaleString()}`);
        console.log(`    Period: ${state.report.period}`);
        console.log(`    Recommendations: ${state.report.recommendations.length}`);
      } else {
        console.log(chalk.dim('  No report generated yet. Run `hivemind improve report` to generate.'));
      }
      console.log('');
    });

  // ── swarm improve analyze ────────────────────────────────────

  improve
    .command('analyze')
    .description('Analyze last N pipeline runs for strategy effectiveness')
    .option('-n, --count <n>', 'Number of recent runs to analyze', '50')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const count = parseInt(opts.count) || 50;
      const engine = new SelfImprovementEngine(swarmDir);
      const strategies = engine.analyze(count);

      if (opts.json) {
        console.log(JSON.stringify(strategies, null, 2));
        return;
      }

      if (strategies.length === 0) {
        console.log(chalk.dim('No data to analyze. Run more pipelines first.'));
        return;
      }

      console.log(chalk.bold(`\nStrategy Analysis (last ${count} runs)\n`));

      for (const strat of strategies) {
        const rateColor = strat.successRate >= 70 ? chalk.green : strat.successRate >= 40 ? chalk.yellow : chalk.red;
        const bar = '\u2588'.repeat(Math.round(strat.successRate / 5));
        console.log(`  ${chalk.bold(strat.strategy)} (${strat.taskType})`);
        console.log(`    Success: ${rateColor(strat.successRate + '%')} ${chalk.blue(bar)}`);
        console.log(`    Avg cost: $${strat.avgCost.toFixed(2)} | Avg duration: ${formatDuration(strat.avgDuration)} | Samples: ${strat.sampleSize}`);
        console.log(`    ${chalk.yellow('\u2192')} ${strat.recommendation}`);
        console.log('');
      }

      // Model effectiveness
      const models = engine.getModelEffectiveness();
      if (models.length > 0) {
        console.log(chalk.bold('  Model Effectiveness\n'));
        for (const m of models) {
          const rateColor = m.successRate >= 70 ? chalk.green : m.successRate >= 40 ? chalk.yellow : chalk.red;
          console.log(`    ${chalk.cyan(m.model.padEnd(12))} ${rateColor(String(m.successRate).padStart(3) + '%')} success | $${m.avgCost.toFixed(2)} avg cost | ${m.avgFixIterations} avg fixes | ${m.runs} runs`);
        }
        console.log('');
      }
    });

  // ── swarm improve report ─────────────────────────────────────

  improve
    .command('report')
    .description('Generate a self-assessment report with trends and recommendations')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const engine = new SelfImprovementEngine(swarmDir);
      const state = engine.getState();

      if (state.records.length === 0) {
        console.log(chalk.dim('No performance records. Run pipelines to generate data.'));
        return;
      }

      const report = engine.generateReport();

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      console.log(chalk.bold(`\nSelf-Assessment Report\n`));
      console.log(chalk.dim(`  Period: ${report.period}`));
      console.log(chalk.dim(`  Generated: ${new Date(report.generatedAt).toLocaleString()}`));
      console.log('');

      const printTrend = (label: string, items: Array<{ metric: string; current: number; previous: number; change: number }>) => {
        console.log(chalk.bold(`  ${label}`));
        for (const item of items) {
          const arrow = item.change > 0 ? chalk.green('\u2191') : item.change < 0 ? chalk.red('\u2193') : chalk.dim('\u2192');
          const changeStr = item.change > 0 ? `+${item.change}` : String(item.change);
          console.log(`    ${item.metric.padEnd(32)} ${String(item.current).padStart(6)} ${arrow} ${chalk.dim(`(${changeStr} from ${item.previous})`)}`);
        }
        console.log('');
      };

      printTrend('Accuracy Trends', report.accuracyTrend);
      printTrend('Quality Trends', report.qualityTrend);
      printTrend('Efficiency Trends', report.efficiencyTrend);

      if (report.recommendations.length > 0) {
        console.log(chalk.bold('  Recommendations'));
        for (const rec of report.recommendations) {
          console.log(`    ${chalk.yellow('\u2192')} ${rec}`);
        }
        console.log('');
      }
    });

  // ── swarm improve apply ──────────────────────────────────────

  improve
    .command('apply')
    .description('Apply recommended tuning changes based on analysis')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const engine = new SelfImprovementEngine(swarmDir);
      const state = engine.getState();

      if (state.records.length < 3) {
        console.log(chalk.yellow('Not enough data to auto-tune. Need at least 3 recorded runs.'));
        return;
      }

      // Ensure strategies are up to date
      engine.analyze();

      const result = engine.applyTuning();

      console.log(chalk.bold('\nAuto-Tuning Applied\n'));
      for (const change of result.applied) {
        console.log(`  ${chalk.green('\u2713')} ${change}`);
      }
      console.log('');
      console.log(chalk.dim('Tuning is stored in .swarm/self-improvement.json'));
      console.log(chalk.dim('Run `hivemind improve reset` to revert to defaults.'));
      console.log('');
    });

  // ── swarm improve reset ──────────────────────────────────────

  improve
    .command('reset')
    .description('Revert all tuning to default configuration')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const engine = new SelfImprovementEngine(swarmDir);
      engine.resetTuning();

      console.log(chalk.green('\nTuning reset to defaults.'));
      console.log(chalk.dim('All model overrides, strategy overrides, and prompt variant scores cleared.'));
      console.log(chalk.dim('Performance records are preserved. Run `hivemind improve analyze` to re-analyze.'));
      console.log('');
    });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
