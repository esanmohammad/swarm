import chalk from 'chalk';
import type { Command } from 'commander';
import { Telemetry } from '../core/telemetry.js';

export function registerTelemetry(program: Command): void {
  const cmd = program
    .command('telemetry')
    .description('View and manage anonymous local usage statistics')
    .argument('[action]', 'on | off | reset — toggle or clear telemetry data')
    .action(async (action: string | undefined) => {
      const telemetry = new Telemetry();

      // Handle subcommands: on / off / reset
      if (action === 'on') {
        telemetry.setEnabled(true);
        console.log(chalk.green('Telemetry enabled.') + chalk.dim(' All data stays local at ~/.swarm/telemetry.json'));
        return;
      }

      if (action === 'off') {
        telemetry.setEnabled(false);
        console.log(chalk.yellow('Telemetry disabled.') + chalk.dim(' Existing data preserved — use "hivemind telemetry reset" to clear.'));
        return;
      }

      if (action === 'reset') {
        // Confirmation via a simple prompt
        const readline = await import('node:readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

        const answer = await new Promise<string>((resolve) => {
          rl.question(chalk.yellow('Clear all telemetry data? This cannot be undone. [y/N] '), (ans) => {
            rl.close();
            resolve(ans.trim().toLowerCase());
          });
        });

        if (answer === 'y' || answer === 'yes') {
          telemetry.reset();
          console.log(chalk.green('Telemetry data cleared.'));
        } else {
          console.log(chalk.dim('Cancelled.'));
        }
        return;
      }

      if (action) {
        console.log(chalk.red(`Unknown action: ${action}`));
        console.log(chalk.dim('Usage: swarm telemetry [on | off | reset]'));
        return;
      }

      // Default: show summary dashboard
      const enabled = telemetry.isEnabled();
      const statusBadge = enabled
        ? chalk.bgGreen.black(' ON ')
        : chalk.bgRed.white(' OFF ');

      console.log('');
      console.log(`  Telemetry status: ${statusBadge}`);

      if (!enabled) {
        console.log('');
        console.log(chalk.dim('  Telemetry is disabled. Enable with: ') + chalk.cyan('hivemind telemetry on'));
        console.log(chalk.dim('  All data is stored locally at ~/.swarm/telemetry.json — nothing is sent remotely.'));
        console.log('');
      }

      // Always show summary if there's data (even when disabled — data may exist from before)
      const data = telemetry.getData();
      if (data.firstRecordedAt) {
        const summary = telemetry.getSummary();
        // Apply chalk formatting to the plain-text summary
        const formatted = summary
          .replace(/SWARM TELEMETRY — Local Usage Statistics/g, chalk.bold.cyan('SWARM TELEMETRY — Local Usage Statistics'))
          .replace(/={40}/g, chalk.dim('═'.repeat(40)))
          .replace(/(PIPELINE RUNS|STAGE BREAKDOWN|USAGE PATTERNS|FIX LOOP STATS)/g, (match) => chalk.bold.white(match))
          .replace(/[─]{2,}/g, (match) => chalk.dim(match))
          .replace(/(\$[\d.]+)/g, (match) => chalk.green(match))
          .replace(/(\d+\.\d+%)/g, (match) => {
            const pct = parseFloat(match);
            if (pct >= 80) return chalk.green(match);
            if (pct >= 50) return chalk.yellow(match);
            return chalk.red(match);
          });

        console.log(formatted);
      } else if (enabled) {
        console.log('');
        console.log(chalk.dim('  No data recorded yet. Run some pipelines to see stats!'));
        console.log('');
      }
    });

  return;
}
