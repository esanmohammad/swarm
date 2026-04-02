import chalk from 'chalk';
import type { Command } from 'commander';
import { CodeFingerprinter } from '../core/fingerprint.js';
import type { FileFingerprint } from '../core/fingerprint.js';
import { join } from 'node:path';

const ORIGIN_COLORS: Record<string, (s: string) => string> = {
  ai: chalk.magenta,
  human: chalk.green,
  mixed: chalk.yellow,
};

export function registerFingerprint(program: Command): void {
  program
    .command('fingerprint')
    .description('Analyze code origin — AI-generated vs human-written')
    .argument('[scope]', 'Directory or file scope to scan')
    .option('--json', 'Output as JSON')
    .option('--threshold <n>', 'Only show files with AI confidence above N', '50')
    .action(async (scope: string | undefined, opts) => {
      const cwd = process.cwd();
      const swarmDir = join(cwd, '.swarm');
      const threshold = parseInt(opts.threshold, 10) || 50;

      const fingerprinter = new CodeFingerprinter(cwd, swarmDir);

      const scanOpts: { files?: string[] } = {};
      if (scope) {
        scanOpts.files = [scope];
      }

      const report = fingerprinter.scan(scanOpts);

      // Apply threshold filter
      const filtered = report.files.filter(f => f.confidence >= threshold);

      if (opts.json) {
        console.log(JSON.stringify({ ...report, files: filtered }, null, 2));
        return;
      }

      const { summary } = report;
      const totalFiles = summary.totalFiles;
      const aiPct = totalFiles > 0 ? Math.round((summary.aiFiles / totalFiles) * 100) : 0;
      const humanPct = totalFiles > 0 ? Math.round((summary.humanFiles / totalFiles) * 100) : 0;
      const mixedPct = totalFiles > 0 ? Math.round((summary.mixedFiles / totalFiles) * 100) : 0;
      const linesPct = summary.totalLines > 0 ? Math.round((summary.aiLinesEstimate / summary.totalLines) * 100) : 0;

      console.log(chalk.bold('\nCode Origin Analysis\n'));
      console.log(`  ${chalk.magenta('AI-generated:')}  ${String(summary.aiFiles).padStart(4)} files (${aiPct}%)`);
      console.log(`  ${chalk.green('Human:')}         ${String(summary.humanFiles).padStart(4)} files (${humanPct}%)`);
      console.log(`  ${chalk.yellow('Mixed:')}         ${String(summary.mixedFiles).padStart(4)} files (${mixedPct}%)`);
      console.log('');
      console.log(`  Estimated AI lines: ${summary.aiLinesEstimate.toLocaleString()} / ${summary.totalLines.toLocaleString()} (${linesPct}%)`);

      if (filtered.length > 0) {
        console.log('');
        const fileHeader = 'File';
        const originHeader = 'Origin';
        const confHeader = 'Confidence';
        const modelHeader = 'Model';
        console.log(chalk.dim(`  ${fileHeader.padEnd(40)} ${originHeader.padEnd(10)} ${confHeader.padEnd(12)} ${modelHeader}`));
        console.log(chalk.dim('  ' + '-'.repeat(75)));

        for (const fp of filtered) {
          const colorFn = ORIGIN_COLORS[fp.origin] ?? chalk.white;
          const truncFile = fp.file.length > 38 ? '...' + fp.file.slice(-35) : fp.file;
          const modelStr = fp.model || '-';
          console.log(
            `  ${truncFile.padEnd(40)} ${colorFn(fp.origin.padEnd(10))} ${String(fp.confidence + '%').padEnd(12)} ${modelStr}`,
          );
        }
      } else {
        console.log(chalk.dim('\n  No files above confidence threshold.'));
      }

      console.log('');
    });
}
