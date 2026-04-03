import { watch, existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, relative, extname, basename, dirname } from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.go', '.py', '.rs', '.swift']);
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.swarm', '.next',
  '__pycache__', '.venv', 'venv', 'target', '.build', 'coverage', '.cache', '.turbo',
]);

interface TestRun {
  changedFiles: string[];
  testCmd: string;
  passed: boolean;
  output: string;
  timestamp: number;
  fixApplied: boolean;
}

export function registerWatch(program: Command): void {
  const cmd = program
    .command('watch')
    .description('Watch for file changes, run tests automatically, optionally auto-fix failures');

  cmd
    .command('start')
    .description('Start watching for changes')
    .option('-s, --stack <stack>', 'Tech stack override')
    .option('-m, --model <model>', 'Model for auto-fix agents (e.g., sonnet, openai/gpt-4o)', 'sonnet')
    .option('--test-only', 'Run tests but do not auto-fix failures')
    .option('--commit', 'Auto-commit when tests pass after a fix')
    .option('--scope <path>', 'Watch only a specific directory')
    .option('-d, --debounce <ms>', 'Debounce delay in milliseconds', '2000')
    .option('-b, --budget <amount>', 'Max budget per auto-fix in USD', '3')
    .action(async (opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        const cwd = process.cwd();
        const stack = (opts.stack as TechStack) || autoDetectStack(cwd);
        const projectName = cwd.split('/').pop() || 'my-project';
        console.log(chalk.yellow(`No .swarm/ found — auto-initializing (stack: ${stack})...`));
        swarmDir = autoInit(projectName, stack, cwd);
      }

      const config = loadConfig();
      const cwd = process.cwd();
      const stack = (opts.stack as TechStack) || config.stack;
      const model = opts.model || config.model;
      const testOnly = opts.testOnly ?? false;
      const autoCommit = opts.commit ?? false;
      const debounceMs = parseInt(opts.debounce) || 2000;
      const scope = opts.scope ? join(cwd, opts.scope) : cwd;
      config.model = model;
      config.maxBudgetUsd = opts.budget === 'none' ? null : (parseFloat(opts.budget) || 3);

      const testCmd = resolveTestCommand(stack);

      console.log(chalk.bold(`\nSwarm Watch — continuous local CI`));
      console.log(chalk.dim(`Scope: ${relative(cwd, scope) || '.'}`));
      console.log(chalk.dim(`Stack: ${stack} | Test: ${testCmd}`));
      console.log(chalk.dim(`Auto-fix: ${testOnly ? 'off' : 'on'} | Auto-commit: ${autoCommit} | Model: ${model}`));
      console.log(chalk.dim(`Debounce: ${debounceMs}ms\n`));
      console.log(chalk.cyan('Watching for changes... (Ctrl+C to stop)\n'));

      // State
      const runs: TestRun[] = [];
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      let pendingFiles = new Set<string>();
      let isRunning = false;

      const processChanges = async () => {
        if (isRunning || pendingFiles.size === 0) return;
        isRunning = true;

        const changedFiles = [...pendingFiles];
        pendingFiles.clear();

        const relFiles = changedFiles.map(f => relative(cwd, f));
        console.log(chalk.cyan(`\n[${time()}] Changes detected: ${relFiles.join(', ')}`));

        // Determine which test command to run
        const affectedTestCmd = findAffectedTestCmd(cwd, stack, changedFiles) || testCmd;
        console.log(chalk.dim(`  Running: ${affectedTestCmd}`));

        // Run tests
        let passed = false;
        let output = '';
        try {
          output = execSync(affectedTestCmd, {
            encoding: 'utf-8',
            cwd,
            timeout: 120000,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          passed = true;
        } catch (err: unknown) {
          const execErr = err as { stdout?: string; stderr?: string };
          output = (execErr.stdout || '') + (execErr.stderr || '');
          passed = false;
        }

        const run: TestRun = {
          changedFiles: relFiles,
          testCmd: affectedTestCmd,
          passed,
          output: output.slice(-5000),
          timestamp: Date.now(),
          fixApplied: false,
        };

        if (passed) {
          console.log(chalk.green(`  [${time()}] Tests passed`));
          runs.push(run);
          isRunning = false;
          return;
        }

        console.log(chalk.red(`  [${time()}] Tests failed`));

        if (testOnly) {
          console.log(chalk.dim('  (test-only mode — skipping auto-fix)'));
          runs.push(run);
          isRunning = false;
          return;
        }

        // Auto-fix: spawn engineer agent
        console.log(chalk.yellow(`  [${time()}] Spawning fix agent...`));
        const { agentManager, cleanup } = createContext(swarmDir, config);

        try {
          const failOutput = output.slice(-8000);
          const prompt = [
            'You are fixing test failures detected by the file watcher.',
            '',
            `Changed files: ${relFiles.join(', ')}`,
            `Test command: ${affectedTestCmd}`,
            '',
            'Test output (last 8KB):',
            '```',
            failOutput,
            '```',
            '',
            'Instructions:',
            '1. Read the failing test output carefully.',
            '2. Fix the source code to make tests pass.',
            '3. Make MINIMAL changes — only fix what is broken.',
            `4. Run \`${affectedTestCmd}\` to verify your fix.`,
            '5. If tests pass, stop. If not, try once more.',
          ].join('\n');

          const agent = await agentManager.spawn({
            name: `watch-fixer-${stack}`,
            persona: 'engineer',
            stack,
            prompt,
            model,
            cwd,
            interactive: false,
            permissionMode: 'auto',
          });

          await agentManager.waitForAgent(agent.id);
          const cost = agent.cost.totalUsd;

          // Re-run tests to verify fix
          let fixPassed = false;
          try {
            execSync(affectedTestCmd, { encoding: 'utf-8', cwd, timeout: 120000, stdio: 'pipe' });
            fixPassed = true;
          } catch { /* still failing */ }

          run.fixApplied = true;

          if (fixPassed) {
            console.log(chalk.green(`  [${time()}] Fix applied — tests pass! ($${cost.toFixed(2)})`));

            if (autoCommit) {
              try {
                execSync('git add -A && git commit -m "fix: auto-fix by swarm watch"', { cwd, stdio: 'pipe' });
                console.log(chalk.green(`  [${time()}] Auto-committed`));
              } catch {
                console.log(chalk.yellow(`  [${time()}] Could not auto-commit`));
              }
            }
          } else {
            console.log(chalk.red(`  [${time()}] Fix attempted but tests still fail ($${cost.toFixed(2)})`));
          }
        } catch (err) {
          console.error(chalk.red(`  Fix agent error: ${err instanceof Error ? err.message : err}`));
        } finally {
          cleanup();
        }

        runs.push(run);
        isRunning = false;
      };

      // Set up recursive watcher
      const watchDir = (dir: string) => {
        try {
          const watcher = watch(dir, { recursive: true }, (_event, filename) => {
            if (!filename) return;
            const fullPath = join(dir, filename);

            // Skip non-source files and ignored dirs
            const parts = filename.split('/');
            if (parts.some(p => IGNORE_DIRS.has(p) || p.startsWith('.'))) return;
            if (!SOURCE_EXTS.has(extname(filename))) return;

            pendingFiles.add(fullPath);

            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(processChanges, debounceMs);
          });

          process.on('SIGINT', () => {
            watcher.close();
            console.log(chalk.yellow(`\nWatch stopped. ${runs.length} test run(s) in this session.`));
            const passed = runs.filter(r => r.passed).length;
            const fixed = runs.filter(r => r.fixApplied).length;
            if (runs.length > 0) {
              console.log(chalk.dim(`  Passed: ${passed} | Failed: ${runs.length - passed} | Auto-fixed: ${fixed}`));
            }
            process.exit(0);
          });
        } catch (err) {
          console.error(chalk.red(`Could not watch ${dir}: ${err instanceof Error ? err.message : err}`));
          process.exit(1);
        }
      };

      watchDir(scope);
    });

  cmd
    .command('stop')
    .description('Stop the watcher (Ctrl+C in the running terminal)')
    .action(() => {
      console.log(chalk.yellow('To stop the watcher, press Ctrl+C in the terminal where it is running.'));
    });
}

function time(): string {
  return new Date().toLocaleTimeString();
}

function resolveTestCommand(stack: TechStack): string {
  switch (stack) {
    case 'react':
    case 'node':
    case 'custom':
      return detectJsTestRunner();
    case 'go': return 'go test ./...';
    case 'python': return 'pytest -v';
    case 'rust': return 'cargo test';
    case 'swift': return 'swift test';
    default: return detectJsTestRunner();
  }
}

/** Detect which JS test runner is installed: vitest, jest, or fallback */
function detectJsTestRunner(): string {
  const cwd = process.cwd();
  // Check package.json scripts
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
    const testScript = pkg.scripts?.test || '';
    if (testScript.includes('vitest')) return 'npx vitest run';
    if (testScript.includes('jest')) return 'npx jest';
    if (testScript.includes('react-scripts test')) return 'npx react-scripts test --watchAll=false';
    if (testScript.includes('mocha')) return 'npx mocha';
    // If there's a test script, use it
    if (testScript && testScript !== 'echo "Error: no test specified" && exit 1') return 'npm test';
  } catch { /* no package.json */ }
  // Check for config files
  if (existsSync(join(cwd, 'vitest.config.ts')) || existsSync(join(cwd, 'vitest.config.js'))) return 'npx vitest run';
  if (existsSync(join(cwd, 'jest.config.ts')) || existsSync(join(cwd, 'jest.config.js')) || existsSync(join(cwd, 'jest.config.mjs'))) return 'npx jest';
  // Check node_modules
  if (existsSync(join(cwd, 'node_modules', '.bin', 'vitest'))) return 'npx vitest run';
  if (existsSync(join(cwd, 'node_modules', '.bin', 'jest'))) return 'npx jest';
  return 'npx vitest run';
}

/** Try to narrow the test scope to affected files only */
function findAffectedTestCmd(cwd: string, stack: TechStack, changedFiles: string[]): string | null {
  // For vitest/jest: we can pass specific test file paths
  if (stack === 'react' || stack === 'node' || stack === 'custom') {
    const testFiles: string[] = [];

    for (const file of changedFiles) {
      const rel = relative(cwd, file);
      const base = basename(rel, extname(rel));
      const dir = dirname(file);

      // Check for co-located test file
      const testVariants = [
        join(dir, `${base}.test${extname(rel)}`),
        join(dir, `${base}.spec${extname(rel)}`),
        join(dir, '__tests__', `${base}.test${extname(rel)}`),
      ];

      for (const tv of testVariants) {
        if (existsSync(tv)) {
          testFiles.push(relative(cwd, tv));
        }
      }

      // If the changed file IS a test file, include it
      if (rel.includes('.test.') || rel.includes('.spec.')) {
        testFiles.push(rel);
      }
    }

    if (testFiles.length > 0) {
      const unique = [...new Set(testFiles)];
      const runner = detectJsTestRunner();
      // Both vitest and jest accept file paths as positional args
      if (runner.includes('vitest')) return `npx vitest run ${unique.join(' ')}`;
      if (runner.includes('jest')) return `npx jest ${unique.join(' ')}`;
      return `${runner} -- ${unique.join(' ')}`;
    }
  }

  // For Go: narrow to package
  if (stack === 'go') {
    const packages = new Set<string>();
    for (const file of changedFiles) {
      const rel = relative(cwd, dirname(file));
      packages.add(`./${rel || '.'}`);
    }
    if (packages.size > 0 && packages.size <= 5) {
      return `go test ${[...packages].join(' ')}`;
    }
  }

  return null; // fallback to full suite
}

/** Exported for dashboard: returns recent watch runs from the current session */
export interface WatchStatus {
  running: boolean;
  totalRuns: number;
  passed: number;
  failed: number;
  autoFixed: number;
}
