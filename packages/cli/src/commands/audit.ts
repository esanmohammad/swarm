import chalk from 'chalk';
import type { Command } from 'commander';
import { requireSwarmDir } from '../core/config.js';
import { AuditLog } from '../core/audit.js';

export function registerAudit(program: Command): void {
  program
    .command('audit')
    .description('View the audit trail of pipeline actions')
    .option('-n, --limit <count>', 'Number of entries to show', '50')
    .option('-a, --action <action>', 'Filter by action (agent-spawned, agent-done, stage-complete, etc.)')
    .option('-s, --stage <stage>', 'Filter by pipeline stage')
    .option('--since <hours>', 'Show entries from the last N hours')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const audit = new AuditLog(swarmDir);

      const limit = parseInt(opts.limit, 10) || 50;
      const since = opts.since ? Date.now() - (parseFloat(opts.since) * 3600000) : undefined;

      const entries = audit.query({
        action: opts.action,
        stage: opts.stage,
        since,
        limit,
      });

      if (entries.length === 0) {
        console.log(chalk.dim('No audit entries found.'));
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }

      // Table format
      console.log(chalk.dim(`Showing ${entries.length} entries (newest first)\n`));

      for (const e of entries) {
        const time = new Date(e.timestamp).toLocaleString();
        const actionColor = e.action.includes('error') ? chalk.red
          : e.action.includes('complete') || e.action.includes('done') ? chalk.green
          : chalk.cyan;

        const parts = [
          chalk.dim(time),
          actionColor(e.action.padEnd(18)),
        ];

        if (e.agentName) parts.push(chalk.yellow(e.agentName));
        if (e.stage) parts.push(chalk.blue(`[${e.stage}]`));
        if (e.cost != null) parts.push(chalk.dim(`$${e.cost.toFixed(4)}`));
        if (e.detail) parts.push(chalk.dim(e.detail.slice(0, 60)));

        console.log(parts.join('  '));
      }
    });
}
