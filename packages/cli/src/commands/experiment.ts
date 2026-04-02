import { Command } from 'commander';
import chalk from 'chalk';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import { ExperimentEngine } from '../core/experiment-engine.js';
import type { ExperimentDefinition } from '../types.js';

function getEngine(): ExperimentEngine {
  const swarmDir = requireSwarmDir();
  return new ExperimentEngine(swarmDir);
}

function formatDate(ts?: number): string {
  if (!ts) return chalk.dim('—');
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusColor(status: string): string {
  switch (status) {
    case 'draft': return chalk.gray(status);
    case 'running': return chalk.blue(status);
    case 'analyzing': return chalk.yellow(status);
    case 'shipped': return chalk.green(status);
    case 'killed': return chalk.red(status);
    default: return status;
  }
}

function guardrailColor(status: string): string {
  switch (status) {
    case 'ok': return chalk.green(status);
    case 'warning': return chalk.yellow(status);
    case 'breached': return chalk.red(status);
    default: return status;
  }
}

export function registerExperiment(program: Command): void {
  const cmd = program
    .command('experiment')
    .description('A/B testing & feature flag automation — create, run, and analyze experiments')
    .action(() => {
      // Default action: list all experiments
      const engine = getEngine();
      const state = engine.getState();

      if (state.experiments.length === 0) {
        console.log(chalk.dim('No experiments yet. Create one with: swarm experiment create <name>'));
        return;
      }

      console.log(chalk.bold('\nExperiments\n'));
      console.log(
        chalk.dim('Name'.padEnd(25)) +
        chalk.dim('Status'.padEnd(14)) +
        chalk.dim('Flag'.padEnd(20)) +
        chalk.dim('Rollout'.padEnd(10)) +
        chalk.dim('Guardrails'),
      );
      console.log(chalk.dim('─'.repeat(80)));

      for (const exp of state.experiments) {
        console.log(
          exp.name.padEnd(25) +
          statusColor(exp.status).padEnd(14 + 10) + // extra for ANSI codes
          chalk.cyan(exp.flag).padEnd(20 + 10) +
          `${exp.currentPercentage}%`.padEnd(10) +
          guardrailColor(exp.guardrailStatus),
        );
      }

      console.log(chalk.dim(`\nTotal: ${state.totalExperiments} | Active: ${state.activeCount}`));
    });

  // ─── create ─────────────────────────────────────────────────

  cmd
    .command('create <name>')
    .description('Define a new experiment')
    .requiredOption('--hypothesis <text>', 'What you expect to happen')
    .requiredOption('--flag <flag>', 'Feature flag name to toggle')
    .requiredOption('--metric <metric>', 'Primary metric to measure')
    .option('--secondary-metrics <metrics...>', 'Secondary metrics to track')
    .option('--guardrail-metrics <metrics...>', 'Guardrail metrics (must not regress)')
    .option('--duration <days>', 'Experiment duration in days', '14')
    .option('--sample-size <n>', 'Minimum sample size per variant', '1000')
    .option('--significance <level>', 'Statistical significance level', '0.05')
    .option('--ramp <percentages...>', 'Ramp schedule percentages', ['10', '25', '50', '100'])
    .action((name: string, opts) => {
      try {
        const engine = getEngine();

        const def: ExperimentDefinition = {
          name,
          hypothesis: opts.hypothesis,
          flag: opts.flag,
          metrics: {
            primary: opts.metric,
            secondary: opts.secondaryMetrics || [],
            guardrail: opts.guardrailMetrics || [],
          },
          targeting: {
            percentage: 0,
            rampSchedule: (opts.ramp as string[]).map(Number),
          },
          duration: parseInt(opts.duration, 10),
          minSampleSize: parseInt(opts.sampleSize, 10),
          significanceLevel: parseFloat(opts.significance),
        };

        const exp = engine.create(def);

        console.log(chalk.green(`\nExperiment "${name}" created`));
        console.log(chalk.dim(`  ID:         ${exp.id}`));
        console.log(chalk.dim(`  Flag:       ${exp.flag}`));
        console.log(chalk.dim(`  Hypothesis: ${exp.hypothesis}`));
        console.log(chalk.dim(`  Duration:   ${exp.duration} days`));
        console.log(chalk.dim(`  Ramp:       ${exp.rampSchedule.join('% → ')}%`));
        console.log(chalk.dim(`\nStart with: swarm experiment start ${name}`));
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  // ─── start ──────────────────────────────────────────────────

  cmd
    .command('start <name>')
    .description('Begin rollout of an experiment')
    .action((name: string) => {
      try {
        const engine = getEngine();
        const exp = engine.start(name);

        console.log(chalk.green(`\nExperiment "${name}" started`));
        console.log(chalk.dim(`  Flag:       ${exp.flag}`));
        console.log(chalk.dim(`  Rollout:    ${exp.currentPercentage}%`));
        console.log(chalk.dim(`  Started:    ${formatDate(exp.startedAt)}`));
        console.log(chalk.dim(`\nMonitor with: swarm experiment status`));
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  // ─── status ─────────────────────────────────────────────────

  cmd
    .command('status')
    .description('Show all active experiments with metrics')
    .action(() => {
      const engine = getEngine();
      const active = engine.getActive();

      if (active.length === 0) {
        console.log(chalk.dim('No active experiments.'));
        return;
      }

      console.log(chalk.bold('\nActive Experiments\n'));

      for (const exp of active) {
        const elapsed = exp.startedAt
          ? ((Date.now() - exp.startedAt) / (1000 * 60 * 60 * 24)).toFixed(1)
          : '0';

        console.log(chalk.bold.cyan(`  ${exp.name}`));
        console.log(`    Status:      ${statusColor(exp.status)}`);
        console.log(`    Flag:        ${chalk.cyan(exp.flag)}`);
        console.log(`    Hypothesis:  ${exp.hypothesis}`);
        console.log(`    Rollout:     ${exp.currentPercentage}%`);
        console.log(`    Elapsed:     ${elapsed} days / ${exp.duration} days`);
        console.log(`    Samples:     ${exp.sampleSize}`);
        console.log(`    Guardrails:  ${guardrailColor(exp.guardrailStatus)}`);

        if (exp.recommendation) {
          const recColor = exp.recommendation === 'ship' ? chalk.green
            : exp.recommendation === 'kill' ? chalk.red
            : chalk.yellow;
          console.log(`    Recommend:   ${recColor(exp.recommendation)}`);
        }

        if (exp.results.length > 0) {
          console.log(chalk.dim('    Results:'));
          for (const r of exp.results) {
            const sig = r.significant ? chalk.green('significant') : chalk.dim('not significant');
            const lift = r.liftPercent >= 0
              ? chalk.green(`+${r.liftPercent.toFixed(2)}%`)
              : chalk.red(`${r.liftPercent.toFixed(2)}%`);
            console.log(`      ${r.metric}: lift ${lift}, p=${r.pValue.toFixed(4)} (${sig})`);
          }
        }

        console.log();
      }
    });

  // ─── analyze ────────────────────────────────────────────────

  cmd
    .command('analyze <name>')
    .description('Run statistical analysis on an experiment')
    .action((name: string) => {
      try {
        const engine = getEngine();
        const results = engine.analyze(name);
        const exp = engine.getExperiment(name)!;

        console.log(chalk.bold(`\nAnalysis: ${name}\n`));

        for (const r of results) {
          const sig = r.significant ? chalk.green('SIGNIFICANT') : chalk.yellow('NOT SIGNIFICANT');
          const lift = r.liftPercent >= 0
            ? chalk.green(`+${r.liftPercent.toFixed(2)}%`)
            : chalk.red(`${r.liftPercent.toFixed(2)}%`);

          console.log(`  ${chalk.bold(r.metric)}`);
          console.log(`    Control:    mean=${r.control.mean.toFixed(2)}, stddev=${r.control.stddev.toFixed(2)}, n=${r.control.sampleSize}`);
          console.log(`    Treatment:  mean=${r.treatment.mean.toFixed(2)}, stddev=${r.treatment.stddev.toFixed(2)}, n=${r.treatment.sampleSize}`);
          console.log(`    Lift:       ${lift}`);
          console.log(`    p-value:    ${r.pValue.toFixed(6)} — ${sig}`);
          console.log();
        }

        // Check guardrails
        const guardrails = engine.checkGuardrails(name);
        console.log(`  Guardrails: ${guardrailColor(guardrails.status)}`);
        for (const detail of guardrails.details) {
          console.log(chalk.dim(`    • ${detail}`));
        }

        if (exp.recommendation) {
          const recColor = exp.recommendation === 'ship' ? chalk.green
            : exp.recommendation === 'kill' ? chalk.red
            : chalk.yellow;
          console.log(`\n  Recommendation: ${recColor(exp.recommendation.toUpperCase())}`);
        }
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  // ─── ship ───────────────────────────────────────────────────

  cmd
    .command('ship <name>')
    .description('Conclude experiment and ship to 100%')
    .action((name: string) => {
      try {
        const engine = getEngine();
        const exp = engine.ship(name);

        console.log(chalk.green(`\nExperiment "${name}" shipped`));
        console.log(chalk.dim(`  Flag "${exp.flag}" now at 100%.`));
        console.log(chalk.dim(`  Ended: ${formatDate(exp.endedAt)}`));

        if (exp.results.length > 0) {
          const primary = exp.results[0];
          const lift = primary.liftPercent >= 0
            ? chalk.green(`+${primary.liftPercent.toFixed(2)}%`)
            : chalk.red(`${primary.liftPercent.toFixed(2)}%`);
          console.log(chalk.dim(`  Final lift: ${lift}`));
        }
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  // ─── kill ───────────────────────────────────────────────────

  cmd
    .command('kill <name>')
    .description('Revert an experiment — disable flag, stop rollout')
    .action((name: string) => {
      try {
        const engine = getEngine();
        const exp = engine.kill(name);

        console.log(chalk.red(`\nExperiment "${name}" killed`));
        console.log(chalk.dim(`  Flag "${exp.flag}" reverted to 0%.`));
        console.log(chalk.dim(`  Ended: ${formatDate(exp.endedAt)}`));
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  // ─── history ────────────────────────────────────────────────

  cmd
    .command('history')
    .description('Show past experiments (shipped and killed)')
    .action(() => {
      const engine = getEngine();
      const past = engine.getHistory();

      if (past.length === 0) {
        console.log(chalk.dim('No completed experiments yet.'));
        return;
      }

      console.log(chalk.bold('\nExperiment History\n'));
      console.log(
        chalk.dim('Name'.padEnd(25)) +
        chalk.dim('Outcome'.padEnd(12)) +
        chalk.dim('Flag'.padEnd(20)) +
        chalk.dim('Duration'.padEnd(12)) +
        chalk.dim('Ended'),
      );
      console.log(chalk.dim('─'.repeat(85)));

      for (const exp of past) {
        const durationDays = exp.startedAt && exp.endedAt
          ? ((exp.endedAt - exp.startedAt) / (1000 * 60 * 60 * 24)).toFixed(1) + 'd'
          : '—';

        console.log(
          exp.name.padEnd(25) +
          statusColor(exp.status).padEnd(12 + 10) +
          chalk.cyan(exp.flag).padEnd(20 + 10) +
          durationDays.padEnd(12) +
          formatDate(exp.endedAt),
        );
      }
      console.log();
    });
}
