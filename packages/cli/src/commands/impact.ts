import { Command } from 'commander';
import chalk from 'chalk';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import { StateManager } from '../core/state.js';
import { ImpactAnalyzer } from '../core/impact-analyzer.js';
import type { ImpactReport } from '../types.js';

const DEFAULT_HOURLY_RATE = 150;

export function registerImpact(program: Command): void {
  const impact = program
    .command('impact')
    .description('Business impact analysis — ROI, value metrics, and feature impact tracking')
    .argument('[period]', 'Time period to analyze (e.g., "last 30 days", "last quarter")')
    .option('--hourly-rate <rate>', 'Developer hourly rate for value estimation', String(DEFAULT_HOURLY_RATE))
    .option('--format <format>', 'Output format: table or json', 'table')
    .action((period: string | undefined, opts) => {
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
      const history = state.listHistory();
      const hourlyRate = parseFloat(opts.hourlyRate) || DEFAULT_HOURLY_RATE;
      const analyzer = new ImpactAnalyzer(swarmDir);

      if (!period) {
        // Show latest saved report or generate one for last 30 days
        const existing = analyzer.getReport();
        if (existing) {
          printReport(existing, opts.format);
          return;
        }
        period = 'last 30 days';
      }

      if (history.length === 0) {
        console.log(chalk.dim('No pipeline history found. Run a pipeline to generate impact data.'));
        return;
      }

      const report = analyzer.analyzePeriod(history, period, hourlyRate);
      printReport(report, opts.format);
    });

  // ── estimate ────────────────────────────────────────────────────────────────

  impact
    .command('estimate <feature>')
    .description('Predict business impact before building a feature')
    .option('--hourly-rate <rate>', 'Developer hourly rate for value estimation', String(DEFAULT_HOURLY_RATE))
    .option('--format <format>', 'Output format: table or json', 'table')
    .action((feature: string, opts) => {
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
      const history = state.listHistory();
      const hourlyRate = parseFloat(opts.hourlyRate) || DEFAULT_HOURLY_RATE;
      const analyzer = new ImpactAnalyzer(swarmDir);

      if (history.length === 0) {
        console.log(chalk.dim('No pipeline history found. Run at least one pipeline to generate estimates.'));
        return;
      }

      const estimate = analyzer.estimateImpact(feature, history, hourlyRate);

      if (opts.format === 'json') {
        console.log(JSON.stringify(estimate, null, 2));
        return;
      }

      console.log(chalk.bold('\n  Impact Estimate\n'));
      console.log(chalk.dim(`  Feature: "${feature}"\n`));

      console.log(`    Estimated cost:    ${chalk.yellow('$' + estimate.estimatedCost.toFixed(2))}`);
      console.log(`    Estimated value:   ${chalk.green('$' + estimate.estimatedValue.toFixed(2))}`);
      console.log(`    Estimated ROI:     ${roiColor(estimate.estimatedRoi)(estimate.estimatedRoi + 'x')}`);
      console.log(`    Confidence:        ${chalk.yellow(estimate.confidence + '%')}`);

      console.log(chalk.bold('\n  Value Breakdown'));
      for (const item of estimate.breakdown) {
        console.log(`    ${item.label.padEnd(30)} ${chalk.dim(item.hours + 'h')}  ${chalk.green('$' + item.value.toFixed(2))}`);
      }

      console.log(chalk.dim('\n  Based on historical pipeline data. Adjust --hourly-rate to refine.\n'));
    });

  // ── roi ─────────────────────────────────────────────────────────────────────

  impact
    .command('roi')
    .description("Calculate Swarm's own ROI across all pipeline history")
    .option('--hourly-rate <rate>', 'Developer hourly rate for value estimation', String(DEFAULT_HOURLY_RATE))
    .option('--format <format>', 'Output format: table or json', 'table')
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
      const history = state.listHistory();
      const hourlyRate = parseFloat(opts.hourlyRate) || DEFAULT_HOURLY_RATE;
      const analyzer = new ImpactAnalyzer(swarmDir);

      if (history.length === 0) {
        console.log(chalk.dim('No pipeline history found. Run a pipeline to calculate ROI.'));
        return;
      }

      const roi = analyzer.calculateRoi(history, hourlyRate);

      if (opts.format === 'json') {
        console.log(JSON.stringify(roi, null, 2));
        return;
      }

      console.log(chalk.bold('\n  Swarm ROI Report\n'));
      console.log(chalk.bold('  Overview'));
      console.log(`    Total Swarm cost:       ${chalk.yellow('$' + roi.totalSwarmCost.toFixed(2))}`);
      console.log(`    Total hours saved:      ${chalk.cyan(roi.totalHoursSaved + 'h')}`);
      console.log(`    Total value generated:  ${chalk.green('$' + roi.totalValueGenerated.toFixed(2))}`);
      console.log(`    ROI multiple:           ${roiColor(roi.roiMultiple)(roi.roiMultiple + 'x')}`);
      console.log(`    Cost per run:           ${chalk.yellow('$' + roi.costPerRun.toFixed(2))}`);
      console.log(`    Value per run:          ${chalk.green('$' + roi.valuePerRun.toFixed(2))}`);

      if (roi.breakEvenRuns > 0) {
        console.log(`    Break-even at:          ${chalk.dim(roi.breakEvenRuns + ' runs')}`);
      }

      if (roi.monthlyTrend.length > 1) {
        console.log(chalk.bold('\n  Monthly Trend'));
        const maxValue = Math.max(...roi.monthlyTrend.map(m => m.value), 1);
        for (const m of roi.monthlyTrend) {
          const bar = chalk.green('█'.repeat(Math.round((m.value / maxValue) * 20) || 1));
          const roiStr = m.roi > 0 ? `${m.roi}x` : 'n/a';
          console.log(`    ${m.month}  cost ${chalk.yellow('$' + m.cost.toFixed(2).padStart(7))}  value ${chalk.green('$' + m.value.toFixed(2).padStart(7))}  ROI ${roiColor(m.roi)(roiStr.padStart(5))}  ${bar}`);
        }
      }

      console.log(chalk.dim(`\n  Calculated at $${hourlyRate}/hr developer rate. Adjust with --hourly-rate.\n`));
    });
}

// ── Display helpers ───────────────────────────────────────────────────────────

function roiColor(multiple: number): (text: string) => string {
  if (multiple >= 3) return chalk.green;
  if (multiple >= 1) return chalk.yellow;
  return chalk.red;
}

function printReport(report: ImpactReport, format: string): void {
  if (format === 'json') {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(chalk.bold(`\n  Business Impact Report — ${report.period}\n`));

  // Highlights
  if (report.highlights.length > 0) {
    console.log(chalk.bold('  Highlights'));
    for (const h of report.highlights) {
      console.log(`    ${chalk.yellow('-')} ${h}`);
    }
    console.log('');
  }

  // ROI summary
  console.log(chalk.bold('  ROI Summary'));
  console.log(`    Swarm cost:        ${chalk.yellow('$' + report.roi.swarmCost.toFixed(2))}`);
  console.log(`    Estimated value:   ${chalk.green('$' + report.roi.estimatedValue.toFixed(2))}`);
  console.log(`    ROI multiple:      ${roiColor(report.roi.multiple)(report.roi.multiple + 'x')}`);
  console.log('');

  // Per-feature breakdown
  if (report.features.length > 0) {
    console.log(chalk.bold('  Feature Breakdown'));
    for (const feature of report.features) {
      const roi = feature.cost > 0 ? (feature.totalValue / feature.cost) : 0;
      const roiStr = roi > 0 ? `${roi.toFixed(1)}x` : 'n/a';
      console.log(`    ${chalk.cyan(feature.name)}`);
      console.log(`      Cost: ${chalk.yellow('$' + feature.cost.toFixed(2))}  Value: ${chalk.green('$' + feature.totalValue.toFixed(2))}  ROI: ${roiColor(roi)(roiStr)}`);

      for (const metric of feature.metrics) {
        const arrow = metric.changePercent > 0 ? chalk.green('↑') : metric.changePercent < 0 ? chalk.red('↓') : chalk.dim('→');
        const valueStr = metric.monetaryValue ? `  ${chalk.green('$' + metric.monetaryValue.toFixed(2))}` : '';
        console.log(`        ${arrow} ${metric.name}: ${metric.before} → ${metric.after} (${metric.changePercent > 0 ? '+' : ''}${metric.changePercent}%)${valueStr}`);
      }
      console.log('');
    }
  }

  console.log(chalk.dim(`  Report generated ${new Date(report.timestamp).toLocaleString()}`));
  console.log(chalk.dim('  Saved to .swarm/impact-reports.json\n'));
}
