import chalk from 'chalk';
import type { Command } from 'commander';
import { requireSwarmDir } from '../core/config.js';
import { GuardrailsEngine } from '../core/guardrails.js';

export function registerEvaluate(program: Command): void {
  program
    .command('evaluate')
    .alias('eval')
    .description('Validate artifacts against guardrail rules')
    .action(async () => {
      const swarmDir = requireSwarmDir();
      const engine = new GuardrailsEngine(swarmDir);
      const violations = engine.evaluate(process.cwd());

      if (violations.length === 0) {
        console.log(chalk.green('All guardrail checks passed.'));
        return;
      }

      const errors = violations.filter((v) => v.severity === 'error');
      const warnings = violations.filter((v) => v.severity === 'warning');

      console.log(chalk.bold(`\nGuardrail Results: ${errors.length} errors, ${warnings.length} warnings\n`));

      for (const v of violations) {
        const icon = v.severity === 'error' ? chalk.red('FAIL') : chalk.yellow('WARN');
        const file = chalk.dim(v.file.replace(process.cwd() + '/', ''));
        console.log(`  ${icon}  ${v.message}`);
        console.log(`       ${file} [${v.rule}]`);
      }

      console.log('');

      if (errors.length > 0) {
        console.log(chalk.red(`${errors.length} error(s) found. Fix these before proceeding.`));
        process.exit(1);
      }
    });
}
