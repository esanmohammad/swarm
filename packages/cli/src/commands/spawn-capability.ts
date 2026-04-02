import { Command } from 'commander';
import chalk from 'chalk';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import { CapabilitySpawner } from '../core/capability-spawner.js';

function getSpawner(): CapabilitySpawner {
  const swarmDir = requireSwarmDir();
  return new CapabilitySpawner(swarmDir);
}

function statusColor(status: string): string {
  switch (status) {
    case 'active': return chalk.green(status);
    case 'testing': return chalk.yellow(status);
    case 'disabled': return chalk.gray(status);
    case 'discarded': return chalk.red(status);
    default: return status;
  }
}

function verdictColor(verdict: string): string {
  switch (verdict) {
    case 'promote': return chalk.green(verdict);
    case 'continue-testing': return chalk.yellow(verdict);
    case 'discard': return chalk.red(verdict);
    default: return verdict;
  }
}

export function registerSpawnCapability(program: Command): void {
  const cmd = program
    .command('spawn-capability')
    .argument('[domain]', 'Domain to acquire capability for (e.g., "kubernetes deployment")')
    .description('Capability spawning — detect gaps, acquire tools/personas, evaluate effectiveness')
    .action((domain?: string) => {
      const spawner = getSpawner();

      if (domain) {
        // Acquire capability for the given domain
        try {
          console.log(chalk.dim(`\nAcquiring capability for: ${domain}...`));
          const capability = spawner.acquireCapability(domain);

          if (capability.status === 'active') {
            console.log(chalk.cyan(`\nCapability "${domain}" already active`));
          } else {
            console.log(chalk.green(`\nCapability acquired: ${capability.name}`));
          }

          console.log(chalk.dim(`  ID:     ${capability.id}`));
          console.log(chalk.dim(`  Type:   ${capability.type}`));
          console.log(chalk.dim(`  Source: ${capability.source}`));
          console.log(`  Status: ${statusColor(capability.status)}`);
          console.log(chalk.dim(`\nEvaluate with: swarm spawn-capability evaluate`));
        } catch (err) {
          console.error(chalk.red(err instanceof Error ? err.message : String(err)));
          process.exit(1);
        }
        return;
      }

      // Default: overview
      const state = spawner.getState();

      if (state.capabilities.length === 0 && state.gaps.length === 0) {
        console.log(chalk.dim('No capabilities or gaps detected yet.'));
        console.log(chalk.dim('  Detect gaps:      swarm spawn-capability list'));
        console.log(chalk.dim('  Acquire:          swarm spawn-capability "kubernetes deployment"'));
        return;
      }

      console.log(chalk.bold('\nCapability Overview\n'));

      const active = state.capabilities.filter(c => c.status === 'active');
      const testing = state.capabilities.filter(c => c.status === 'testing');
      const discarded = state.capabilities.filter(c => c.status === 'discarded');

      console.log(chalk.dim(`  Active: ${chalk.green(String(active.length))}  Testing: ${chalk.yellow(String(testing.length))}  Discarded: ${chalk.red(String(discarded.length))}`));
      console.log(chalk.dim(`  Gaps detected: ${state.gaps.length}`));

      if (active.length > 0) {
        console.log(chalk.bold('\n  Active Capabilities:\n'));
        for (const cap of active) {
          console.log(`    ${chalk.cyan(cap.name)} ${chalk.dim(`(${cap.type})`)}`);
          console.log(chalk.dim(`      Effectiveness: ${cap.effectiveness}% | Tasks: ${cap.tasksUsed}`));
        }
      }

      if (testing.length > 0) {
        console.log(chalk.bold('\n  Testing:\n'));
        for (const cap of testing) {
          console.log(`    ${chalk.yellow(cap.name)} ${chalk.dim(`(${cap.type})`)}`);
          console.log(chalk.dim(`      Source: ${cap.source} | Tasks: ${cap.tasksUsed}`));
        }
      }
    });

  // ─── list ──────────────────────────────────────────────────

  cmd
    .command('list')
    .description('Show acquired capabilities and detected gaps')
    .action(() => {
      const spawner = getSpawner();
      const gaps = spawner.detectGaps();
      const capabilities = spawner.listCapabilities();

      if (capabilities.length > 0) {
        console.log(chalk.bold('\nAcquired Capabilities\n'));
        console.log(
          chalk.dim('Name'.padEnd(30)) +
          chalk.dim('Type'.padEnd(18)) +
          chalk.dim('Status'.padEnd(14)) +
          chalk.dim('Effect.'.padEnd(10)) +
          chalk.dim('Tasks'),
        );
        console.log(chalk.dim('─'.repeat(85)));

        for (const cap of capabilities) {
          console.log(
            cap.name.padEnd(30) +
            chalk.dim(cap.type).padEnd(18 + 10) +
            statusColor(cap.status).padEnd(14 + 10) +
            `${cap.effectiveness}%`.padEnd(10) +
            String(cap.tasksUsed),
          );
        }
        console.log();
      }

      if (gaps.length > 0) {
        console.log(chalk.bold('Detected Gaps\n'));
        console.log(
          chalk.dim('Domain'.padEnd(30)) +
          chalk.dim('Failures'.padEnd(12)) +
          chalk.dim('Attempts'),
        );
        console.log(chalk.dim('─'.repeat(55)));

        for (const gap of gaps) {
          console.log(
            chalk.yellow(gap.domain).padEnd(30 + 10) +
            String(gap.failureCount).padEnd(12) +
            String(gap.attemptedAcquisitions),
          );
        }
        console.log(chalk.dim(`\nAcquire with: swarm spawn-capability "<domain>"`));
      }
    });

  // ─── evaluate ──────────────────────────────────────────────

  cmd
    .command('evaluate')
    .description('Evaluate capability effectiveness — promote, continue, or discard')
    .action(() => {
      const spawner = getSpawner();
      const evaluations = spawner.evaluate();

      if (evaluations.length === 0) {
        console.log(chalk.dim('No capabilities to evaluate. Acquire one first.'));
        return;
      }

      console.log(chalk.bold('\nCapability Evaluations\n'));

      const capabilities = spawner.listCapabilities();

      for (const evaluation of evaluations) {
        const cap = capabilities.find(c => c.id === evaluation.capabilityId);
        const name = cap ? cap.name : evaluation.capabilityId.slice(0, 8);

        console.log(chalk.bold.cyan(`  ${name}`));
        console.log(`    Tasks run:    ${evaluation.tasksRun}`);
        console.log(`    Success rate: ${(evaluation.successRate * 100).toFixed(0)}%`);
        console.log(`    Verdict:      ${verdictColor(evaluation.verdict)}`);

        if (cap) {
          console.log(`    Status:       ${statusColor(cap.status)}`);
        }
        console.log();
      }

      const promoted = evaluations.filter(e => e.verdict === 'promote').length;
      const discarded = evaluations.filter(e => e.verdict === 'discard').length;
      console.log(chalk.dim(`Promoted: ${promoted} | Discarded: ${discarded} | Continuing: ${evaluations.length - promoted - discarded}`));
    });
}
