import chalk from 'chalk';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { requireSwarmDir } from '../core/config.js';
import { generateStandupReport } from '../core/activity-tracker.js';

export function registerStandup(program: Command): void {
  program
    .command('standup')
    .description('Generate async standup status reports from Swarm activity')
    .option('--weekly', 'Generate weekly summary instead of daily')
    .option('--since <date>', 'Custom start date (YYYY-MM-DD)')
    .option('--format <format>', 'Output format: markdown, slack, json', 'markdown')
    .option('--post', 'Save report to .swarm/standups/ for posting')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const format = opts.format as 'markdown' | 'slack' | 'json';
      if (!['markdown', 'slack', 'json'].includes(format)) {
        console.error(chalk.red(`Invalid format "${opts.format}". Use: markdown, slack, json`));
        process.exit(1);
      }

      const report = generateStandupReport(swarmDir, {
        weekly: opts.weekly ?? false,
        since: opts.since,
        format,
      });

      if (opts.post) {
        const standupsDir = join(swarmDir, 'standups');
        if (!existsSync(standupsDir)) mkdirSync(standupsDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const ext = format === 'json' ? 'json' : 'md';
        const outFile = join(standupsDir, `standup-${timestamp}.${ext}`);
        writeFileSync(outFile, report, 'utf-8');
        console.log(chalk.green(`Standup report saved to ${outFile}`));
        return;
      }

      // Pretty-print to terminal
      if (format === 'json') {
        console.log(report);
        return;
      }

      // For markdown and slack, add some color
      const lines = report.split('\n');
      for (const line of lines) {
        if (line.startsWith('# ') || line.startsWith(':clipboard:')) {
          console.log(chalk.bold.cyan(line));
        } else if (line.startsWith('## ') || line.startsWith(':white_check_mark:') || line.startsWith(':chart_with_upwards_trend:') || line.startsWith(':moneybag:') || line.startsWith(':rotating_light:') || line.startsWith(':soon:') || line.startsWith(':runner:')) {
          console.log(chalk.bold.yellow(line));
        } else if (line.includes('$') && line.startsWith('- **Total')) {
          console.log(chalk.green(line));
        } else if (line.includes('failure') || line.includes('Blocker')) {
          console.log(chalk.red(line));
        } else if (line.startsWith('- _No')) {
          console.log(chalk.dim(line));
        } else if (line.startsWith('- ') || line.startsWith('  - ')) {
          console.log(chalk.white(line));
        } else {
          console.log(chalk.dim(line));
        }
      }
    });
}
