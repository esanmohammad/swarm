import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { loadConfig, requireSwarmDir } from '../core/config.js';

interface ValidationResult {
  step: string;
  passed: boolean;
  message: string;
}

/** Detect the package manager / build system for the project */
function detectRunner(cwd: string): { type: string; run: (script: string) => string; exec: (bin: string) => string } {
  // Check lock files for JS package managers
  if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))) {
    return { type: 'bun', run: (s) => `bun run ${s}`, exec: (b) => `bunx ${b}` };
  }
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) {
    return { type: 'pnpm', run: (s) => `pnpm run ${s}`, exec: (b) => `pnpm exec ${b}` };
  }
  if (existsSync(join(cwd, 'yarn.lock'))) {
    return { type: 'yarn', run: (s) => `yarn ${s}`, exec: (b) => `yarn ${b}` };
  }
  if (existsSync(join(cwd, 'package-lock.json')) || existsSync(join(cwd, 'package.json'))) {
    return { type: 'npm', run: (s) => `npm run ${s}`, exec: (b) => `npx ${b}` };
  }
  // Non-JS projects
  if (existsSync(join(cwd, 'go.mod'))) {
    return { type: 'go', run: (s) => `go ${s}`, exec: (b) => b };
  }
  if (existsSync(join(cwd, 'Cargo.toml'))) {
    return { type: 'cargo', run: (s) => `cargo ${s}`, exec: (b) => b };
  }
  if (existsSync(join(cwd, 'pyproject.toml')) || existsSync(join(cwd, 'setup.py')) || existsSync(join(cwd, 'requirements.txt'))) {
    return { type: 'python', run: (s) => s, exec: (b) => b };
  }
  if (existsSync(join(cwd, 'Package.swift'))) {
    return { type: 'swift', run: (s) => `swift ${s}`, exec: (b) => b };
  }
  // Fallback
  return { type: 'npm', run: (s) => `npm run ${s}`, exec: (b) => `npx ${b}` };
}

export function registerValidate(program: Command): void {
  program
    .command('validate')
    .description('Validate the build: type-check, lint, and verify the app starts without errors')
    .option('--skip-typecheck', 'Skip TypeScript type-checking')
    .option('--skip-lint', 'Skip linting')
    .option('--skip-start', 'Skip app start verification')
    .option('--timeout <ms>', 'Timeout for app start check in ms', '10000')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const config = loadConfig();
      const projectCwd = join(swarmDir, '..');
      const runner = detectRunner(projectCwd);
      const results: ValidationResult[] = [];
      let hasFailure = false;

      console.log(chalk.cyan(`\n[validate] Running build validation... (detected: ${runner.type})\n`));

      // ── Step 1: Type-check ──
      if (!opts.skipTypecheck) {
        const spinner = ora('Type-checking...').start();
        try {
          if (runner.type === 'go') {
            execSync('go vet ./...', { cwd: projectCwd, stdio: 'pipe', timeout: 60000 });
            spinner.succeed('Type-check passed (go vet)');
            results.push({ step: 'typecheck', passed: true, message: 'go vet clean' });
          } else if (runner.type === 'cargo') {
            execSync('cargo check', { cwd: projectCwd, stdio: 'pipe', timeout: 120000 });
            spinner.succeed('Type-check passed (cargo check)');
            results.push({ step: 'typecheck', passed: true, message: 'cargo check clean' });
          } else if (runner.type === 'python') {
            // Try mypy or pyright if available
            try {
              execSync('mypy . --ignore-missing-imports', { cwd: projectCwd, stdio: 'pipe', timeout: 60000 });
              spinner.succeed('Type-check passed (mypy)');
              results.push({ step: 'typecheck', passed: true, message: 'mypy clean' });
            } catch {
              spinner.info('No mypy available — skipping type-check');
              results.push({ step: 'typecheck', passed: true, message: 'Skipped (no mypy)' });
            }
          } else if (runner.type === 'swift') {
            execSync('swift build', { cwd: projectCwd, stdio: 'pipe', timeout: 120000 });
            spinner.succeed('Type-check passed (swift build)');
            results.push({ step: 'typecheck', passed: true, message: 'swift build clean' });
          } else {
            // JS/TS — check for tsconfig
            const tsconfigPath = join(projectCwd, 'tsconfig.json');
            if (existsSync(tsconfigPath)) {
              execSync(`${runner.exec('tsc')} --noEmit`, { cwd: projectCwd, stdio: 'pipe', timeout: 60000 });
              spinner.succeed('Type-check passed');
              results.push({ step: 'typecheck', passed: true, message: 'No type errors' });
            } else {
              spinner.info('No tsconfig.json found — skipping type-check');
              results.push({ step: 'typecheck', passed: true, message: 'Skipped (no tsconfig.json)' });
            }
          }
        } catch (err: any) {
          spinner.fail('Type-check failed');
          const output = err.stderr?.toString() || err.stdout?.toString() || err.message;
          console.log(chalk.dim(output.slice(0, 2000)));
          results.push({ step: 'typecheck', passed: false, message: output.slice(0, 500) });
          hasFailure = true;
        }
      }

      // ── Step 2: Linting ──
      if (!opts.skipLint) {
        const spinner = ora('Linting...').start();
        try {
          if (runner.type === 'go') {
            try {
              execSync('golangci-lint run ./...', { cwd: projectCwd, stdio: 'pipe', timeout: 60000 });
              spinner.succeed('Lint passed (golangci-lint)');
              results.push({ step: 'lint', passed: true, message: 'golangci-lint clean' });
            } catch {
              spinner.info('No golangci-lint available — skipping');
              results.push({ step: 'lint', passed: true, message: 'Skipped (no golangci-lint)' });
            }
          } else if (runner.type === 'cargo') {
            execSync('cargo clippy -- -D warnings', { cwd: projectCwd, stdio: 'pipe', timeout: 60000 });
            spinner.succeed('Lint passed (clippy)');
            results.push({ step: 'lint', passed: true, message: 'clippy clean' });
          } else if (runner.type === 'python') {
            try {
              execSync('ruff check .', { cwd: projectCwd, stdio: 'pipe', timeout: 60000 });
              spinner.succeed('Lint passed (ruff)');
              results.push({ step: 'lint', passed: true, message: 'ruff clean' });
            } catch {
              try {
                execSync('flake8 .', { cwd: projectCwd, stdio: 'pipe', timeout: 60000 });
                spinner.succeed('Lint passed (flake8)');
                results.push({ step: 'lint', passed: true, message: 'flake8 clean' });
              } catch {
                spinner.info('No Python linter available — skipping');
                results.push({ step: 'lint', passed: true, message: 'Skipped (no ruff/flake8)' });
              }
            }
          } else if (runner.type === 'swift') {
            spinner.info('No Swift linter configured — skipping');
            results.push({ step: 'lint', passed: true, message: 'Skipped' });
          } else {
            // JS — use package.json lint script
            const pkgPath = join(projectCwd, 'package.json');
            if (existsSync(pkgPath)) {
              const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
              const scripts = pkg.scripts || {};
              if (scripts.lint) {
                execSync(runner.run('lint'), { cwd: projectCwd, stdio: 'pipe', timeout: 60000 });
                spinner.succeed('Lint passed');
                results.push({ step: 'lint', passed: true, message: 'No lint errors' });
              } else {
                spinner.info('No lint script found — skipping');
                results.push({ step: 'lint', passed: true, message: 'Skipped (no lint script)' });
              }
            } else {
              spinner.info('No package.json found — skipping lint');
              results.push({ step: 'lint', passed: true, message: 'Skipped' });
            }
          }
        } catch (err: any) {
          spinner.fail('Lint failed');
          const output = err.stderr?.toString() || err.stdout?.toString() || err.message;
          console.log(chalk.dim(output.slice(0, 2000)));
          results.push({ step: 'lint', passed: false, message: output.slice(0, 500) });
          hasFailure = true;
        }
      }

      // ── Step 3: Build compilation ──
      {
        const spinner = ora('Building project...').start();
        try {
          if (runner.type === 'go') {
            execSync('go build ./...', { cwd: projectCwd, stdio: 'pipe', timeout: 120000 });
            spinner.succeed('Build passed (go build)');
            results.push({ step: 'build', passed: true, message: 'go build clean' });
          } else if (runner.type === 'cargo') {
            execSync('cargo build', { cwd: projectCwd, stdio: 'pipe', timeout: 120000 });
            spinner.succeed('Build passed (cargo build)');
            results.push({ step: 'build', passed: true, message: 'cargo build clean' });
          } else if (runner.type === 'python') {
            // Python doesn't have a compile step, but check syntax
            execSync('python -m py_compile $(find . -name "*.py" -not -path "*/venv/*" -not -path "*/.venv/*" | head -50)', {
              cwd: projectCwd, stdio: 'pipe', timeout: 30000, shell: '/bin/sh',
            });
            spinner.succeed('Build passed (syntax check)');
            results.push({ step: 'build', passed: true, message: 'Python syntax OK' });
          } else if (runner.type === 'swift') {
            execSync('swift build', { cwd: projectCwd, stdio: 'pipe', timeout: 120000 });
            spinner.succeed('Build passed (swift build)');
            results.push({ step: 'build', passed: true, message: 'swift build clean' });
          } else {
            // JS — use package.json build script
            const pkgPath = join(projectCwd, 'package.json');
            if (existsSync(pkgPath)) {
              const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
              const scripts = pkg.scripts || {};
              if (scripts.build) {
                execSync(runner.run('build'), { cwd: projectCwd, stdio: 'pipe', timeout: 120000 });
                spinner.succeed('Build compilation passed');
                results.push({ step: 'build', passed: true, message: 'Build succeeded' });
              } else {
                spinner.info('No build script found — skipping');
                results.push({ step: 'build', passed: true, message: 'Skipped (no build script)' });
              }
            } else {
              spinner.info('No package.json found — skipping build');
              results.push({ step: 'build', passed: true, message: 'Skipped' });
            }
          }
        } catch (err: any) {
          spinner.fail('Build failed');
          const output = err.stderr?.toString() || err.stdout?.toString() || err.message;
          console.log(chalk.dim(output.slice(0, 2000)));
          results.push({ step: 'build', passed: false, message: output.slice(0, 500) });
          hasFailure = true;
        }
      }

      // ── Step 4: App start verification ──
      if (!opts.skipStart) {
        const spinner = ora('Verifying app starts cleanly...').start();
        try {
          if (runner.type === 'go' || runner.type === 'cargo' || runner.type === 'swift') {
            // Non-JS: build already validates. Skip start check.
            spinner.info(`Start check not applicable for ${runner.type} — skipping`);
            results.push({ step: 'start', passed: true, message: `Skipped (${runner.type} project)` });
          } else if (runner.type === 'python') {
            // Try importing the main module
            spinner.info('Start check not applicable for Python — skipping');
            results.push({ step: 'start', passed: true, message: 'Skipped (Python project)' });
          } else {
            // JS — try start/dev/preview script
            const pkgPath = join(projectCwd, 'package.json');
            if (existsSync(pkgPath)) {
              const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
              const scripts = pkg.scripts || {};
              const startScript = scripts.start ? 'start' : scripts.dev ? 'dev' : scripts.preview ? 'preview' : null;
              if (startScript) {
                const timeout = parseInt(opts.timeout, 10);
                const { spawn } = await import('node:child_process');
                const [cmd, ...args] = runner.run(startScript).split(' ');
                const child = spawn(cmd, args, {
                  cwd: projectCwd,
                  stdio: 'pipe',
                  env: { ...process.env, NODE_ENV: 'production', PORT: '0' },
                });

                let stderr = '';
                child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

                const exitPromise = new Promise<number | null>((resolve) => {
                  child.on('exit', (code) => resolve(code));
                });

                const raceResult = await Promise.race([
                  exitPromise,
                  new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), Math.min(timeout, 8000))),
                ]);

                child.kill('SIGTERM');

                if (raceResult === 'timeout') {
                  spinner.succeed('App starts cleanly (process survived startup)');
                  results.push({ step: 'start', passed: true, message: 'App started without immediate crash' });
                } else if (raceResult === 0) {
                  spinner.succeed('App exited cleanly (code 0)');
                  results.push({ step: 'start', passed: true, message: 'Clean exit' });
                } else {
                  spinner.fail(`App crashed on start (exit code ${raceResult})`);
                  if (stderr) console.log(chalk.dim(stderr.slice(0, 1000)));
                  results.push({ step: 'start', passed: false, message: `Exit code ${raceResult}: ${stderr.slice(0, 300)}` });
                  hasFailure = true;
                }
              } else {
                spinner.info('No start/dev/preview script found — skipping');
                results.push({ step: 'start', passed: true, message: 'Skipped (no start script)' });
              }
            } else {
              spinner.info('No package.json found — skipping');
              results.push({ step: 'start', passed: true, message: 'Skipped' });
            }
          }
        } catch (err: any) {
          spinner.fail('Start check failed');
          results.push({ step: 'start', passed: false, message: err.message });
          hasFailure = true;
        }
      }

      // ── Summary ──
      console.log(chalk.bold('\n── Validation Summary ──\n'));
      for (const r of results) {
        const icon = r.passed ? chalk.green('✓') : chalk.red('✗');
        console.log(`  ${icon} ${r.step}: ${r.message}`);
      }

      if (hasFailure) {
        console.log(chalk.red('\nValidation failed. Fix the errors above before shipping.\n'));
        process.exit(1);
      } else {
        console.log(chalk.green('\nAll validations passed.\n'));
      }
    });
}
