import { Command } from 'commander';
import chalk from 'chalk';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import { FederationManager } from '../core/federation.js';

function getManager(): FederationManager {
  const swarmDir = requireSwarmDir();
  return new FederationManager(swarmDir);
}

function percentileColor(percentile: number): string {
  if (percentile >= 75) return chalk.green(`P${percentile}`);
  if (percentile >= 50) return chalk.cyan(`P${percentile}`);
  if (percentile >= 25) return chalk.yellow(`P${percentile}`);
  return chalk.red(`P${percentile}`);
}

export function registerFederate(program: Command): void {
  const cmd = program
    .command('federate')
    .description('Cross-org pattern sharing — opt-in anonymized learning from community')
    .action(() => {
      const manager = getManager();
      const state = manager.getState();

      console.log(chalk.bold('\nFederation Overview\n'));
      console.log(`  Status: ${state.optedIn ? chalk.green('opted in') : chalk.dim('opted out')}`);
      console.log(chalk.dim(`  Shared patterns:   ${state.sharedPatterns.length}`));
      console.log(chalk.dim(`  Received patterns: ${state.receivedPatterns.length}`));
      console.log(chalk.dim(`  Benchmarks:        ${state.benchmarks.length} metrics`));

      if (state.lastSync > 0) {
        console.log(chalk.dim(`  Last sync:         ${new Date(state.lastSync).toLocaleString()}`));
      }

      if (!state.optedIn) {
        console.log(chalk.dim('\nEnable with: swarm federate opt-in'));
        console.log(chalk.dim('Privacy: only anonymized strategies, guardrails, prompt variants,'));
        console.log(chalk.dim('and pipeline configs are shared. Never code, business data, or secrets.'));
      }

      if (state.benchmarks.length > 0) {
        console.log(chalk.bold('\n  Your Benchmarks:\n'));
        for (const b of state.benchmarks.slice(0, 3)) {
          const comparison = b.myValue < b.communityAvg
            ? chalk.green('better')
            : b.myValue > b.communityAvg
              ? chalk.yellow('above avg')
              : chalk.dim('at avg');
          console.log(`    ${b.metric}: ${percentileColor(b.percentile)} ${comparison}`);
        }
        if (state.benchmarks.length > 3) {
          console.log(chalk.dim(`    ... and ${state.benchmarks.length - 3} more metrics`));
        }
      }
    });

  // ─── opt-in ────────────────────────────────────────────────

  cmd
    .command('opt-in')
    .description('Enable cross-org pattern sharing')
    .action(() => {
      const manager = getManager();
      manager.optIn();

      console.log(chalk.green('\nFederation enabled'));
      console.log(chalk.dim('  Your anonymized patterns can now be shared with the community.'));
      console.log(chalk.dim('  Privacy guarantees:'));
      console.log(chalk.dim('    - No source code is ever shared'));
      console.log(chalk.dim('    - No business data or secrets'));
      console.log(chalk.dim('    - Only strategies, guardrails, prompt variants, pipeline configs'));
      console.log(chalk.dim('\nShare patterns with: swarm federate share'));
    });

  // ─── opt-out ───────────────────────────────────────────────

  cmd
    .command('opt-out')
    .description('Disable cross-org pattern sharing')
    .action(() => {
      const manager = getManager();
      manager.optOut();

      console.log(chalk.yellow('\nFederation disabled'));
      console.log(chalk.dim('  No patterns will be shared. Previously shared patterns remain in the community pool.'));
      console.log(chalk.dim('  You can re-enable anytime with: swarm federate opt-in'));
    });

  // ─── share ─────────────────────────────────────────────────

  cmd
    .command('share')
    .description('Share effective patterns with the community')
    .action(() => {
      try {
        const manager = getManager();
        const patterns = manager.sharePatterns();

        if (patterns.length === 0) {
          console.log(chalk.dim('No patterns to share. Run more pipelines to generate shareable patterns.'));
          return;
        }

        console.log(chalk.bold('\nShared Patterns\n'));
        console.log(
          chalk.dim('Type'.padEnd(20)) +
          chalk.dim('Stack'.padEnd(12)) +
          chalk.dim('Effect.'.padEnd(10)) +
          chalk.dim('Description'),
        );
        console.log(chalk.dim('─'.repeat(80)));

        for (const pattern of patterns) {
          console.log(
            chalk.cyan(pattern.type).padEnd(20 + 10) +
            chalk.dim(pattern.stack).padEnd(12) +
            `${pattern.effectiveness}%`.padEnd(10) +
            pattern.description,
          );
        }

        console.log(chalk.dim(`\nTotal: ${patterns.length} patterns shared`));
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  // ─── benchmarks ────────────────────────────────────────────

  cmd
    .command('benchmarks')
    .description('Compare your metrics against community averages')
    .action(() => {
      try {
        const manager = getManager();
        const benchmarks = manager.receiveBenchmarks();

        if (benchmarks.length === 0) {
          console.log(chalk.dim('No benchmark data available.'));
          return;
        }

        console.log(chalk.bold('\nCommunity Benchmarks\n'));
        console.log(
          chalk.dim('Metric'.padEnd(35)) +
          chalk.dim('You'.padEnd(12)) +
          chalk.dim('Community'.padEnd(14)) +
          chalk.dim('Percentile'),
        );
        console.log(chalk.dim('─'.repeat(75)));

        for (const b of benchmarks) {
          const myStr = typeof b.myValue === 'number' && b.myValue < 1
            ? `${(b.myValue * 100).toFixed(0)}%`
            : String(b.myValue);
          const avgStr = typeof b.communityAvg === 'number' && b.communityAvg < 1
            ? `${(b.communityAvg * 100).toFixed(0)}%`
            : String(b.communityAvg);

          console.log(
            b.metric.padEnd(35) +
            chalk.cyan(myStr).padEnd(12 + 10) +
            chalk.dim(avgStr).padEnd(14) +
            percentileColor(b.percentile),
          );
        }

        const avgPercentile = Math.round(benchmarks.reduce((s, b) => s + b.percentile, 0) / benchmarks.length);
        console.log(chalk.dim(`\nOverall: ${percentileColor(avgPercentile)} average across ${benchmarks.length} metrics`));
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });
}
