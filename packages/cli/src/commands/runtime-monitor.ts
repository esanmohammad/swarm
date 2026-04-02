import { Command } from 'commander';
import chalk from 'chalk';
import { join } from 'node:path';
import { RuntimeMonitor } from '../core/runtime-monitor.js';

function requireSwarmDir(): string {
  const cwd = process.cwd();
  const swarmDir = join(cwd, '.swarm');
  return swarmDir;
}

export function registerRuntimeMonitor(program: Command): void {
  const monitor = program
    .command('monitor')
    .description('Runtime security monitoring — track and audit agent activity');

  // swarm monitor events
  monitor
    .command('events')
    .description('Show runtime events')
    .option('--since <minutes>', 'Only events in last N minutes', parseInt)
    .option('--severity <level>', 'Filter by severity (info, warning, critical)')
    .option('--json', 'Output as JSON')
    .action(async (opts: { since?: number; severity?: string; json?: boolean }) => {
      const swarmDir = requireSwarmDir();
      const rm = new RuntimeMonitor(swarmDir);

      const since = opts.since ? Date.now() - opts.since * 60 * 1000 : undefined;
      let events = rm.getEvents(since);

      if (opts.severity) {
        events = events.filter((e) => e.severity === opts.severity);
      }

      if (opts.json) {
        console.log(JSON.stringify(events, null, 2));
        return;
      }

      if (events.length === 0) {
        console.log(chalk.dim('No runtime events found.'));
        return;
      }

      console.log(chalk.bold(`Runtime Events (${events.length}):\n`));

      for (const event of events) {
        const time = new Date(event.timestamp).toLocaleTimeString();
        const severityColor =
          event.severity === 'critical'
            ? chalk.red
            : event.severity === 'warning'
              ? chalk.yellow
              : chalk.dim;
        const severityLabel = severityColor(`[${event.severity.toUpperCase()}]`);
        const typeLabel = chalk.cyan(`[${event.type}]`);

        console.log(`  ${chalk.dim(time)} ${severityLabel} ${typeLabel} ${event.detail}`);
        if (event.source) {
          console.log(`    ${chalk.dim(`source: ${event.source}`)}`);
        }
      }
    });

  // swarm monitor baseline
  monitor
    .command('baseline')
    .description('Save current events as baseline for anomaly detection')
    .action(async () => {
      const swarmDir = requireSwarmDir();
      const rm = new RuntimeMonitor(swarmDir);

      const events = rm.getEvents();
      if (events.length === 0) {
        console.log(chalk.yellow('No events to save as baseline. Run some agents first.'));
        return;
      }

      rm.saveBaseline();
      const summary = rm.getSummary();

      console.log(chalk.green('Baseline saved successfully.'));
      console.log(chalk.dim(`  Events captured: ${summary.totalEvents}`));
      console.log(chalk.dim(`  Types: ${Object.entries(summary.byType).map(([k, v]) => `${k}(${v})`).join(', ')}`));
      console.log(chalk.dim(`  File: .swarm/runtime-baseline.json`));
    });

  // swarm monitor anomalies
  monitor
    .command('anomalies')
    .description('Show events that deviate from baseline')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const swarmDir = requireSwarmDir();
      const rm = new RuntimeMonitor(swarmDir);

      const anomalies = rm.getAnomalies();

      if (opts.json) {
        console.log(JSON.stringify(anomalies, null, 2));
        return;
      }

      if (anomalies.length === 0) {
        console.log(chalk.green('No anomalies detected.'));
        const summary = rm.getSummary();
        if (summary.totalEvents === 0) {
          console.log(chalk.dim('  (No events recorded yet)'));
        } else if (summary.anomalies === 0) {
          console.log(chalk.dim(`  All ${summary.totalEvents} events match the baseline.`));
        }
        return;
      }

      console.log(chalk.bold.red(`Anomalies Detected (${anomalies.length}):\n`));

      for (const event of anomalies) {
        const time = new Date(event.timestamp).toLocaleTimeString();
        const severityColor =
          event.severity === 'critical'
            ? chalk.red
            : event.severity === 'warning'
              ? chalk.yellow
              : chalk.dim;
        const severityLabel = severityColor(`[${event.severity.toUpperCase()}]`);
        const typeLabel = chalk.cyan(`[${event.type}]`);

        console.log(`  ${chalk.dim(time)} ${severityLabel} ${typeLabel} ${event.detail}`);
        if (event.source) {
          console.log(`    ${chalk.dim(`source: ${event.source}`)}`);
        }
      }
    });

  // swarm monitor clear
  monitor
    .command('clear')
    .description('Clear event log')
    .action(async () => {
      const swarmDir = requireSwarmDir();
      const rm = new RuntimeMonitor(swarmDir);

      const count = rm.getEvents().length;
      rm.clearEvents();

      console.log(chalk.green(`Cleared ${count} runtime events.`));
    });

  // swarm monitor summary (bonus)
  monitor
    .command('summary')
    .description('Show summary of runtime events')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const swarmDir = requireSwarmDir();
      const rm = new RuntimeMonitor(swarmDir);
      const summary = rm.getSummary();

      if (opts.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }

      console.log(chalk.bold('Runtime Monitor Summary:\n'));
      console.log(`  Total events:  ${summary.totalEvents}`);
      console.log(`  Anomalies:     ${summary.anomalies > 0 ? chalk.red(summary.anomalies) : chalk.green(summary.anomalies)}`);
      console.log();

      if (Object.keys(summary.byType).length > 0) {
        console.log(chalk.bold('  By Type:'));
        for (const [type, count] of Object.entries(summary.byType)) {
          console.log(`    ${type}: ${count}`);
        }
      }

      if (Object.keys(summary.bySeverity).length > 0) {
        console.log(chalk.bold('  By Severity:'));
        for (const [sev, count] of Object.entries(summary.bySeverity)) {
          const color = sev === 'critical' ? chalk.red : sev === 'warning' ? chalk.yellow : chalk.dim;
          console.log(`    ${color(sev)}: ${count}`);
        }
      }
    });
}
