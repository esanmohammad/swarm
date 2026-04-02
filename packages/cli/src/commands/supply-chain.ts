import chalk from 'chalk';
import type { Command } from 'commander';
import { SupplyChainGuard } from '../core/supply-chain.js';
import type { PackageVerification } from '../core/supply-chain.js';

function statusIcon(status: PackageVerification['status']): string {
  switch (status) {
    case 'safe': return chalk.green('SAFE');
    case 'warning': return chalk.yellow('WARN');
    case 'blocked': return chalk.red('BLOCKED');
  }
}

function printVerification(v: PackageVerification): void {
  console.log(`\n  ${statusIcon(v.status)}  ${chalk.bold(v.name)}@${v.version}`);
  for (const check of v.checks) {
    const icon = check.passed ? chalk.green('  pass') : chalk.red('  FAIL');
    console.log(`    ${icon}  ${chalk.dim(check.name)}: ${check.detail}`);
  }
}

function printSummary(results: PackageVerification[]): void {
  const safe = results.filter(r => r.status === 'safe').length;
  const warnings = results.filter(r => r.status === 'warning').length;
  const blocked = results.filter(r => r.status === 'blocked').length;

  console.log(chalk.dim(`\n  ${results.length} packages checked: ${chalk.green(safe + ' safe')}, ${chalk.yellow(warnings + ' warnings')}, ${chalk.red(blocked + ' blocked')}\n`));
}

export function registerSupplyChain(program: Command): void {
  const cmd = program
    .command('supply-chain')
    .description('Supply chain attack prevention — verify packages and lockfile integrity');

  // --- supply-chain check ---
  cmd
    .command('check')
    .description('Verify a package or all dependencies against supply chain checks')
    .argument('[package]', 'Package name to verify (omit to check all dependencies)')
    .option('--json', 'Output as JSON')
    .action(async (pkg: string | undefined, opts: { json?: boolean }) => {
      const cwd = process.cwd();
      const guard = new SupplyChainGuard(cwd);

      if (pkg) {
        // Single package check
        const parts = pkg.split('@');
        const name = parts[0] || pkg;
        const version = parts.length > 1 ? parts[parts.length - 1] : undefined;

        console.log(chalk.bold(`\nSupply Chain Check`));
        console.log(chalk.dim(`Verifying: ${name}${version ? '@' + version : ''}\n`));

        const result = guard.verifyPackage(name, version);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        printVerification(result);
        console.log('');

        if (result.status === 'blocked') {
          process.exit(1);
        }
      } else {
        // All dependencies
        console.log(chalk.bold(`\nSupply Chain Check — All Dependencies`));
        console.log(chalk.dim(`Scanning package.json...\n`));

        const results = guard.verifyAll();

        if (results.length === 0) {
          console.log(chalk.dim('  No dependencies found in package.json.\n'));
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        // Only show non-safe packages in detail, summarize safe ones
        const problems = results.filter(r => r.status !== 'safe');
        const safeCount = results.length - problems.length;

        if (safeCount > 0) {
          console.log(chalk.green(`  ${safeCount} package(s) passed all checks.`));
        }

        for (const v of problems) {
          printVerification(v);
        }

        printSummary(results);

        const blocked = results.filter(r => r.status === 'blocked');
        if (blocked.length > 0) {
          process.exit(1);
        }
      }
    });

  // --- supply-chain lockfile ---
  cmd
    .command('lockfile')
    .description('Verify lockfile integrity and consistency')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const cwd = process.cwd();
      const guard = new SupplyChainGuard(cwd);

      console.log(chalk.bold(`\nLockfile Integrity Check\n`));

      const result = guard.checkLockfile();

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.valid) {
        console.log(chalk.green('  Lockfile is valid and consistent.\n'));
      } else {
        console.log(chalk.yellow(`  Found ${result.issues.length} issue(s):\n`));
        for (const issue of result.issues) {
          console.log(chalk.red(`    - ${issue}`));
        }
        console.log('');
        process.exit(1);
      }
    });
}
