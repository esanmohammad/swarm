import chalk from 'chalk';
import type { Command } from 'commander';
import { requireSwarmDir } from '../core/config.js';
import { GuardrailsEngine } from '../core/guardrails.js';
import { StateManager } from '../core/state.js';

export function registerEvaluate(program: Command): void {
  program
    .command('evaluate')
    .alias('eval')
    .description('Validate artifacts against guardrail rules')
    .action(async () => {
      const swarmDir = requireSwarmDir();
      const state = new StateManager(swarmDir);
      const engine = new GuardrailsEngine(swarmDir);

      // Update stage to running
      state.updateStage('evaluate', { status: 'running' });

      const violations = engine.evaluate(process.cwd());

      // Persist violations to state for dashboard
      state.getState().violations = violations;
      state.getState().updatedAt = Date.now();

      const errors = violations.filter((v) => v.severity === 'error');
      const warnings = violations.filter((v) => v.severity === 'warning');

      if (violations.length === 0) {
        state.updateStage('evaluate', { status: 'done' });
        state.flush();
        console.log(chalk.green('\n✓ All guardrail checks passed.\n'));
        return;
      }

      console.log(chalk.bold(`\nGuardrail Results: ${errors.length} error(s), ${warnings.length} warning(s)\n`));

      for (const v of violations) {
        const icon = v.severity === 'error' ? chalk.red('✗ FAIL') : chalk.yellow('⚠ WARN');
        const file = chalk.dim(v.file.replace(process.cwd() + '/', ''));
        console.log(`  ${icon}  ${v.message}`);
        console.log(`       ${file} [${v.rule}]`);
      }

      console.log('');

      if (errors.length > 0) {
        state.updateStage('evaluate', { status: 'error' });
        state.flush();
        console.log(chalk.red(`${errors.length} error(s) found. Fix these before proceeding.\n`));
        process.exit(1);
      } else {
        state.updateStage('evaluate', { status: 'done' });
        state.flush();
        console.log(chalk.yellow(`${warnings.length} warning(s) found but no errors — proceed with caution.\n`));
      }
    });
}
