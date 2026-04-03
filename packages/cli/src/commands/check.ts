import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { GuardrailsEngine } from '../core/guardrails.js';
import type { GuardrailPreset } from '../types.js';

const VALID_PRESETS: GuardrailPreset[] = ['strict', 'standard', 'lenient', 'off'];

export function registerCheck(program: Command): void {
  program
    .command('check')
    .description('Validate pipeline artifacts against guardrail rules')
    .argument('[artifact]', 'Specific artifact to check (e.g., SPEC.md)')
    .option('--fix', 'Auto-fix structural issues')
    .option('--preset <preset>', 'Override guardrail preset (strict|standard|lenient|off)')
    .option('--json', 'Output as JSON')
    .action(async (artifact: string | undefined, opts: { fix?: boolean; preset?: string; json?: boolean }) => {
      const cwd = process.cwd();
      const swarmDir = join(cwd, '.swarm');

      // Validate preset if provided
      const preset: GuardrailPreset = opts.preset
        ? (VALID_PRESETS.includes(opts.preset as GuardrailPreset) ? opts.preset as GuardrailPreset : 'standard')
        : 'standard';

      if (opts.preset && !VALID_PRESETS.includes(opts.preset as GuardrailPreset)) {
        console.error(chalk.red(`Invalid preset: "${opts.preset}". Valid presets: ${VALID_PRESETS.join(', ')}`));
        process.exit(1);
      }

      // Initialize guardrails engine (use .swarm dir if it exists)
      const engine = new GuardrailsEngine(
        existsSync(swarmDir) ? swarmDir : undefined,
        preset,
      );

      if (preset === 'off') {
        if (opts.json) {
          console.log(JSON.stringify({ violations: [], preset: 'off', message: 'Guardrails disabled' }));
        } else {
          console.log(chalk.dim('\n  Guardrails preset is "off" — all checks skipped.\n'));
        }
        return;
      }

      // Run evaluation
      const violations = artifact
        ? engine.evaluateArtifact(cwd, artifact)
        : engine.evaluate(cwd);

      // Apply fixes if requested
      let fixResult: { fixed: number; skipped: number } | undefined;
      if (opts.fix && violations.length > 0) {
        fixResult = engine.applyFixes(cwd, violations);
      }

      // Output results
      if (opts.json) {
        const output: Record<string, unknown> = {
          preset,
          artifact: artifact ?? null,
          violations: violations.map(v => ({
            rule: v.rule,
            check: v.check,
            file: v.file,
            message: v.message,
            severity: v.severity,
            fixable: !!v.fix,
            fixDescription: v.fix?.description ?? null,
          })),
          summary: {
            total: violations.length,
            errors: violations.filter(v => v.severity === 'error').length,
            warnings: violations.filter(v => v.severity === 'warning').length,
            fixable: violations.filter(v => v.fix).length,
          },
        };

        if (fixResult) {
          output.fixResult = fixResult;
        }

        console.log(JSON.stringify(output, null, 2));
      } else {
        if (artifact) {
          console.log(chalk.bold(`\nGuardrail check: ${artifact}`));
        } else {
          console.log(chalk.bold('\nGuardrail check: all artifacts'));
        }
        console.log(chalk.dim(`  Preset: ${preset}`));

        console.log(engine.formatReport(violations, cwd));

        if (fixResult) {
          console.log(chalk.bold('  Auto-fix results:'));
          console.log(chalk.green(`    Fixed: ${fixResult.fixed}`));
          if (fixResult.skipped > 0) {
            console.log(chalk.yellow(`    Skipped (no auto-fix available): ${fixResult.skipped}`));
          }
          console.log('');
        } else if (violations.length > 0) {
          const fixable = violations.filter(v => v.fix).length;
          if (fixable > 0) {
            console.log(chalk.dim(`  Run ${chalk.bold('hivemind check --fix')} to auto-fix ${fixable} issue${fixable !== 1 ? 's' : ''}.\n`));
          }
        }
      }

      // Exit with code 1 if any errors found
      const hasErrors = violations.some(v => v.severity === 'error');
      if (hasErrors) {
        process.exit(1);
      }
    });
}
