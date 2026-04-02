import chalk from 'chalk';
import type { Command } from 'commander';
import { SecretDetector } from '../core/secret-detector.js';
import type { SecretFinding } from '../core/secret-detector.js';

const SEVERITY_COLORS: Record<string, (s: string) => string> = {
  critical: chalk.bgRed.white,
  high: chalk.red,
  medium: chalk.yellow,
};

const SEVERITY_ICONS: Record<string, string> = {
  critical: '!!!',
  high: '!!',
  medium: '!',
};

function printFindings(findings: SecretFinding[]): void {
  if (findings.length === 0) {
    console.log(chalk.green('No secrets detected.'));
    return;
  }

  // Group by file
  const byFile = new Map<string, SecretFinding[]>();
  for (const f of findings) {
    const arr = byFile.get(f.file) || [];
    arr.push(f);
    byFile.set(f.file, arr);
  }

  const criticalCount = findings.filter(f => f.severity === 'critical').length;
  const highCount = findings.filter(f => f.severity === 'high').length;
  const mediumCount = findings.filter(f => f.severity === 'medium').length;

  console.log(chalk.bold.red(`\nFound ${findings.length} potential secret(s) in ${byFile.size} file(s):\n`));

  for (const [file, fileFindings] of byFile) {
    console.log(chalk.bold(`  ${file}`));
    for (const finding of fileFindings) {
      const color = SEVERITY_COLORS[finding.severity] || chalk.white;
      const icon = SEVERITY_ICONS[finding.severity] || '?';
      console.log(`    ${color(`[${icon}]`)} Line ${finding.line}: ${finding.message}`);
      console.log(chalk.dim(`        Type: ${finding.type}  Match: ${finding.match}`));
    }
    console.log();
  }

  console.log(chalk.bold('Summary:'));
  if (criticalCount > 0) console.log(chalk.bgRed.white(` ${criticalCount} critical `));
  if (highCount > 0) console.log(chalk.red(` ${highCount} high `));
  if (mediumCount > 0) console.log(chalk.yellow(` ${mediumCount} medium `));
}

export function registerSecrets(program: Command): void {
  const secrets = program
    .command('secrets')
    .description('Secret detection & prevention');

  secrets
    .command('scan')
    .description('Scan for hardcoded secrets in the codebase')
    .option('--json', 'Output as JSON')
    .option('--scope <path>', 'Limit scan to a specific path')
    .option('--include-tests', 'Also scan test files')
    .action(async (opts) => {
      const cwd = opts.scope ? (opts.scope.startsWith('/') ? opts.scope : `${process.cwd()}/${opts.scope}`) : process.cwd();
      const detector = new SecretDetector(cwd);
      const findings = detector.scan({ includeTests: opts.includeTests ?? false });

      if (opts.json) {
        console.log(JSON.stringify(findings, null, 2));
      } else {
        printFindings(findings);
      }

      // Exit with error if critical findings
      if (findings.some(f => f.severity === 'critical')) {
        process.exitCode = 1;
      }
    });

  secrets
    .command('gitignore')
    .description('Check .gitignore coverage for common secret files')
    .action(async () => {
      const cwd = process.cwd();
      const detector = new SecretDetector(cwd);
      const { covered, missing } = detector.checkGitignore();

      console.log(chalk.bold('\n.gitignore Secret Coverage Check\n'));

      if (covered.length > 0) {
        console.log(chalk.green('Covered:'));
        for (const item of covered) {
          console.log(chalk.green(`  + ${item}`));
        }
      }

      if (missing.length > 0) {
        console.log(chalk.red('\nMissing (recommended to add):'));
        for (const item of missing) {
          console.log(chalk.red(`  - ${item}`));
        }
        console.log(chalk.dim('\nAdd these patterns to your .gitignore to prevent accidental commits.'));
        process.exitCode = 1;
      } else {
        console.log(chalk.green('\nAll recommended patterns are covered.'));
      }
    });
}
