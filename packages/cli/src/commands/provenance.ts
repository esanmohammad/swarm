import { writeFileSync } from 'node:fs';
import chalk from 'chalk';
import type { Command } from 'commander';
import { requireSwarmDir } from '../core/config.js';
import { ProvenanceTracker } from '../core/provenance.js';

export function registerProvenance(program: Command): void {
  const cmd = program
    .command('provenance')
    .description('Code provenance & audit trail');

  cmd
    .command('trail')
    .description('Show provenance trail')
    .option('--file <path>', 'Filter by file path')
    .option('--run <runId>', 'Filter by run ID')
    .option('--limit <n>', 'Limit number of records', '20')
    .option('--json', 'Output as JSON')
    .action(async (opts: { file?: string; run?: string; limit: string; json?: boolean }) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }

      const tracker = new ProvenanceTracker(swarmDir);
      const limit = parseInt(opts.limit, 10) || 20;

      let records;
      if (opts.run) {
        const record = tracker.getRunProvenance(opts.run);
        records = record ? [record] : [];
      } else if (opts.file) {
        records = tracker.getFileProvenance(opts.file).slice(0, limit);
      } else {
        records = tracker.list(limit);
      }

      if (records.length === 0) {
        console.log(chalk.yellow('No provenance records found.'));
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(records, null, 2));
        return;
      }

      // Pretty-print
      for (const r of records) {
        console.log(chalk.bold.cyan(`\nRun: ${r.runId}`));
        console.log(`  ${chalk.dim('Time:')}     ${new Date(r.timestamp).toLocaleString()}`);
        console.log(`  ${chalk.dim('Model:')}    ${r.model}`);
        console.log(`  ${chalk.dim('Requestor:')} ${r.requestor}`);
        console.log(`  ${chalk.dim('Cost:')}     $${r.cost.toFixed(4)}`);
        if (r.gitSha) {
          console.log(`  ${chalk.dim('Git SHA:')}  ${r.gitSha}`);
        }
        console.log(`  ${chalk.dim('Conventions:')} ${r.conventions ? chalk.green('yes') : chalk.yellow('no')}`);
        if (r.securityChecks.length > 0) {
          console.log(`  ${chalk.dim('Security:')}  ${r.securityChecks.join(', ')}`);
        }
        if (r.files.length > 0) {
          console.log(`  ${chalk.dim('Files:')}`);
          for (const f of r.files) {
            const actionColor = f.action === 'created' ? chalk.green : f.action === 'deleted' ? chalk.red : chalk.yellow;
            console.log(`    ${actionColor(f.action.padEnd(8))} ${f.path} (${f.linesChanged} lines)`);
          }
        }
      }
      console.log('');
    });

  cmd
    .command('export')
    .description('Export compliance report')
    .option('--format <format>', 'Output format: json or csv', 'json')
    .option('--output <path>', 'Output file path')
    .action(async (opts: { format: string; output?: string }) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }

      const tracker = new ProvenanceTracker(swarmDir);
      const format = (opts.format === 'csv' ? 'csv' : 'json') as 'json' | 'csv';
      const report = tracker.exportReport(format);

      if (opts.output) {
        writeFileSync(opts.output, report);
        console.log(chalk.green(`Report exported to ${opts.output}`));
      } else {
        console.log(report);
      }
    });
}
