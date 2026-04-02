import { execSync } from 'node:child_process';
import chalk from 'chalk';
import type { Command } from 'commander';
import { RiskScorer } from '../core/risk-scorer.js';
import type { RiskScore } from '../core/risk-scorer.js';

const LEVEL_COLORS: Record<string, (s: string) => string> = {
  low: chalk.green,
  medium: chalk.yellow,
  high: chalk.red,
  critical: chalk.bgRed.white,
};

export function registerRisk(program: Command): void {
  program
    .command('risk')
    .description('Score regression risk of changed files')
    .argument('[files...]', 'Files to score (default: git diff vs main)')
    .option('--json', 'Output as JSON')
    .option('--threshold <n>', 'Only show files above this risk score', '0')
    .option('--fail-above <n>', 'Exit with error if any file exceeds this score')
    .action(async (files: string[], opts) => {
      const cwd = process.cwd();
      const threshold = parseInt(opts.threshold, 10) || 0;
      const failAbove = opts.failAbove ? parseInt(opts.failAbove, 10) : null;

      // Auto-detect changed files if none provided
      let targetFiles = files;
      if (targetFiles.length === 0) {
        try {
          const diff = execSync('git diff --name-only main...HEAD 2>/dev/null', {
            cwd,
            encoding: 'utf-8',
            timeout: 10000,
          }).trim();

          if (diff) {
            targetFiles = diff.split('\n').filter(f => f.trim().length > 0);
          }
        } catch {
          // Fall back to unstaged changes
          try {
            const diff = execSync('git diff --name-only HEAD 2>/dev/null', {
              cwd,
              encoding: 'utf-8',
              timeout: 10000,
            }).trim();
            if (diff) {
              targetFiles = diff.split('\n').filter(f => f.trim().length > 0);
            }
          } catch {
            // ignore
          }
        }
      }

      if (targetFiles.length === 0) {
        console.log(chalk.dim('No changed files detected. Pass files explicitly or make changes vs main.'));
        return;
      }

      const scorer = new RiskScorer(cwd);
      const scores = scorer.scoreFiles(targetFiles);

      // Apply threshold filter
      const filtered = scores.filter(s => s.overall >= threshold);

      if (opts.json) {
        console.log(JSON.stringify(filtered, null, 2));
      } else {
        console.log(chalk.bold(`\nRegression Risk Analysis — ${filtered.length} file(s)\n`));

        for (const score of filtered) {
          const colorFn = LEVEL_COLORS[score.level] ?? chalk.white;
          console.log(`  ${colorFn(`[${score.level.toUpperCase()}]`)} ${chalk.bold(String(score.overall).padStart(3))} ${score.file}`);

          for (const dim of score.dimensions) {
            const bar = renderBar(dim.score);
            console.log(chalk.dim(`        ${dim.name.padEnd(16)} ${bar} ${dim.score}`));
          }
          console.log();
        }

        // Summary
        const critical = filtered.filter(s => s.level === 'critical').length;
        const high = filtered.filter(s => s.level === 'high').length;
        const medium = filtered.filter(s => s.level === 'medium').length;
        const low = filtered.filter(s => s.level === 'low').length;

        console.log(chalk.dim('  Summary: ') +
          (critical > 0 ? chalk.bgRed.white(` ${critical} critical `) + ' ' : '') +
          (high > 0 ? chalk.red(`${high} high`) + ' ' : '') +
          (medium > 0 ? chalk.yellow(`${medium} medium`) + ' ' : '') +
          (low > 0 ? chalk.green(`${low} low`) : ''));
        console.log();
      }

      // Fail-above check
      if (failAbove !== null) {
        const exceeding = scores.filter(s => s.overall > failAbove);
        if (exceeding.length > 0) {
          console.error(chalk.red(`\n${exceeding.length} file(s) exceed risk threshold of ${failAbove}:`));
          for (const s of exceeding) {
            console.error(chalk.red(`  ${s.overall} ${s.file}`));
          }
          process.exit(1);
        }
      }
    });
}

function renderBar(score: number): string {
  const filled = Math.round(score / 5);
  const empty = 20 - filled;
  return chalk.dim('[') +
    (score > 75 ? chalk.red('█'.repeat(filled)) :
      score > 50 ? chalk.yellow('█'.repeat(filled)) :
        score > 25 ? chalk.cyan('█'.repeat(filled)) :
          chalk.green('█'.repeat(filled))) +
    chalk.dim('░'.repeat(empty)) +
    chalk.dim(']');
}
