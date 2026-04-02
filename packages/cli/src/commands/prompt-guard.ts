import type { Command } from 'commander';
import chalk from 'chalk';
import { PromptGuard, runSelfTest } from '../core/prompt-guard.js';

export function registerPromptGuard(program: Command): void {
  const cmd = program
    .command('prompt-guard')
    .description('Prompt injection defense — scan inputs and run self-tests');

  // --- scan subcommand ---
  cmd
    .command('scan <text>')
    .description('Scan text for prompt injection attempts')
    .action((text: string) => {
      const guard = new PromptGuard();
      const findings = guard.scanInput(text, 'cli-scan');

      if (findings.length === 0) {
        console.log(chalk.green('No injection patterns detected.'));
        return;
      }

      console.log(chalk.red.bold(`Found ${findings.length} potential injection(s):\n`));
      for (const f of findings) {
        const sev =
          f.severity === 'critical'
            ? chalk.bgRed.white(` ${f.severity.toUpperCase()} `)
            : f.severity === 'high'
              ? chalk.red(f.severity.toUpperCase())
              : chalk.yellow(f.severity.toUpperCase());

        console.log(`  ${sev}  [${f.type}]`);
        console.log(`    ${chalk.dim('Message:')} ${f.message}`);
        console.log(`    ${chalk.dim('Text:')}    ${chalk.italic(f.text)}`);
        console.log();
      }
    });

  // --- test subcommand ---
  cmd
    .command('test')
    .description('Run injection defense self-test suite')
    .action(() => {
      const results = runSelfTest();
      const passed = results.filter((r) => r.passed).length;
      const failed = results.filter((r) => !r.passed).length;

      console.log(chalk.bold('Prompt Guard Self-Test\n'));

      for (const r of results) {
        const icon = r.passed ? chalk.green('PASS') : chalk.red('FAIL');
        console.log(`  ${icon}  ${r.name}`);
        if (!r.passed) {
          console.log(`         ${chalk.dim(r.detail)}`);
        }
      }

      console.log();
      console.log(
        `${chalk.bold('Results:')} ${chalk.green(`${passed} passed`)}${failed > 0 ? `, ${chalk.red(`${failed} failed`)}` : ''} / ${results.length} total`,
      );

      if (failed > 0) {
        process.exitCode = 1;
      }
    });
}
