import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, extname, basename } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';
import { loadConventions } from './learn.js';

interface TestGenOptions {
  model: string;
  framework?: string;
  coverage: boolean;
  verify: boolean;
  budget: string;
  dryRun: boolean;
  parallel: string;
  stack?: string;
}

interface FileCandidate {
  path: string;
  reason: string;
  priority: number;
}

/** Map stack to common source file extensions */
const STACK_EXTENSIONS: Record<string, string[]> = {
  react: ['.ts', '.tsx', '.js', '.jsx'],
  node: ['.ts', '.js', '.mts', '.mjs'],
  go: ['.go'],
  python: ['.py'],
  rust: ['.rs'],
  swift: ['.swift'],
  custom: ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'],
};

/** Map stack to default test framework */
const STACK_FRAMEWORK: Record<string, string> = {
  react: 'vitest',
  node: 'vitest',
  go: 'go-test',
  python: 'pytest',
  rust: 'cargo-test',
  swift: 'swift-test',
  custom: 'vitest',
};

/** Map framework to test file patterns */
const FRAMEWORK_TEST_PATTERNS: Record<string, string[]> = {
  vitest: ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx', '.test.js', '.spec.js'],
  jest: ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx', '.test.js', '.spec.js'],
  pytest: ['test_', '_test.py'],
  'go-test': ['_test.go'],
  'cargo-test': [], // Rust tests are inline or in tests/ dir
  'swift-test': ['Tests.swift', 'Test.swift'],
};

/** Map framework to test run command */
const FRAMEWORK_RUN_CMD: Record<string, string> = {
  vitest: 'npx vitest run',
  jest: 'npx jest',
  pytest: 'python -m pytest',
  'go-test': 'go test ./...',
  'cargo-test': 'cargo test',
  'swift-test': 'swift test',
};

export function registerTestGen(program: Command): void {
  program
    .command('test-gen [scope]')
    .description('Generate tests for source files — targets untested code by default')
    .option('-m, --model <model>', 'Model for test generation (e.g., sonnet, openai/gpt-4o)', 'sonnet')
    .option('-f, --framework <framework>', 'Test framework (vitest/jest/pytest/go-test/cargo-test/swift-test)')
    .option('--coverage', 'Analyze coverage first, target untested files')
    .option('--verify', 'Run generated tests and fix failures')
    .option('-b, --budget <amount>', 'Max budget per file in USD', '5')
    .option('--dry-run', 'Show what would be tested without generating')
    .option('-p, --parallel <n>', 'Max parallel agents', '3')
    .option('-s, --stack <stack>', 'Tech stack override')
    .action(async (scope: string | undefined, opts: TestGenOptions) => {
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
      config.model = opts.model || config.model;
      config.maxBudgetUsd = opts.budget === 'none' ? null : (parseFloat(opts.budget) || 5);

      const cwd = process.cwd();
      const stack = (opts.stack as TechStack) || config.stack;
      const framework = opts.framework || STACK_FRAMEWORK[stack] || 'vitest';
      const maxParallel = parseInt(opts.parallel) || 3;
      const dryRun = opts.dryRun ?? false;
      const verify = opts.verify ?? false;
      const coverage = opts.coverage ?? false;

      console.log(chalk.bold('\nSwarm Test Generator'));
      console.log(chalk.dim(`Stack: ${stack} | Framework: ${framework} | Model: ${config.model} | Budget: $${config.maxBudgetUsd ?? 'unlimited'}/file`));
      console.log(chalk.dim(`Parallel: ${maxParallel} | Verify: ${verify} | Coverage: ${coverage}\n`));

      // Step 1: Discover candidate files
      const spinner = ora('Discovering source files...').start();
      let candidates: FileCandidate[];

      try {
        if (coverage) {
          spinner.text = 'Analyzing coverage to find untested files...';
          candidates = discoverFromCoverage(cwd, stack, framework);
          if (candidates.length === 0) {
            spinner.info('Coverage analysis found no gaps — falling back to file scan.');
            candidates = scope
              ? discoverFromScope(cwd, scope, stack)
              : discoverFromScan(cwd, stack, framework);
          }
        } else if (scope) {
          candidates = discoverFromScope(cwd, scope, stack);
        } else {
          candidates = discoverFromScan(cwd, stack, framework);
        }
      } catch (err) {
        spinner.fail(`Discovery failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }

      // Sort by priority (higher = more important to test)
      candidates.sort((a, b) => b.priority - a.priority);

      if (candidates.length === 0) {
        spinner.warn('No source files found to generate tests for.');
        return;
      }

      spinner.succeed(`Found ${candidates.length} file(s) to generate tests for.`);

      // Show candidates
      console.log('');
      for (const c of candidates) {
        const relPath = relative(cwd, c.path);
        console.log(`  ${chalk.cyan(relPath)} — ${chalk.dim(c.reason)}`);
      }
      console.log('');

      if (dryRun) {
        console.log(chalk.yellow('Dry run — no tests generated.'));
        return;
      }

      // Step 2: Generate tests in parallel batches
      const { agentManager, cleanup } = createContext(swarmDir, config);
      const conventions = loadConventions(swarmDir);

      try {
        const results: Array<{ file: string; success: boolean; testFile?: string; error?: string }> = [];

        // Process in batches of maxParallel
        for (let i = 0; i < candidates.length; i += maxParallel) {
          const batch = candidates.slice(i, i + maxParallel);
          const batchNum = Math.floor(i / maxParallel) + 1;
          const totalBatches = Math.ceil(candidates.length / maxParallel);

          console.log(chalk.bold(`\nBatch ${batchNum}/${totalBatches} — ${batch.length} file(s):`));

          const promises = batch.map(async (candidate) => {
            const relPath = relative(cwd, candidate.path);
            const batchSpinner = ora(`  Generating tests for ${relPath}`).start();

            try {
              const result = await generateTestForFile(
                candidate.path,
                cwd,
                stack,
                framework,
                config.model,
                agentManager,
                conventions,
              );
              batchSpinner.succeed(`  ${relPath} — tests generated`);
              return { file: relPath, success: true, testFile: result.testFile };
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              batchSpinner.fail(`  ${relPath} — ${msg}`);
              return { file: relPath, success: false, error: msg };
            }
          });

          const batchResults = await Promise.all(promises);
          results.push(...batchResults);
        }

        // Step 3: Verify if requested
        if (verify) {
          const generated = results.filter(r => r.success && r.testFile);
          if (generated.length > 0) {
            console.log(chalk.bold('\nVerifying generated tests...'));
            await verifyAndFix(cwd, framework, generated, agentManager, config.model, stack, conventions, maxParallel);
          }
        }

        // Summary
        const succeeded = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        console.log(chalk.bold('\nSummary:'));
        console.log(`  ${chalk.green(`${succeeded} succeeded`)} | ${chalk.red(`${failed} failed`)} | ${results.length} total`);

      } catch (err) {
        console.error(chalk.red(`Test generation error: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      } finally {
        cleanup();
      }
    });
}

/**
 * Discover files from coverage analysis
 */
function discoverFromCoverage(cwd: string, stack: string, framework: string): FileCandidate[] {
  const candidates: FileCandidate[] = [];

  try {
    let coverageCmd: string;
    switch (framework) {
      case 'vitest':
        coverageCmd = 'npx vitest run --coverage --reporter=json 2>/dev/null';
        break;
      case 'jest':
        coverageCmd = 'npx jest --coverage --json 2>/dev/null';
        break;
      case 'pytest':
        coverageCmd = 'python -m pytest --cov --cov-report=json 2>/dev/null';
        break;
      case 'go-test':
        coverageCmd = 'go test -coverprofile=coverage.out ./... 2>/dev/null && go tool cover -func=coverage.out';
        break;
      default:
        return candidates;
    }

    const output = execSync(coverageCmd, { encoding: 'utf-8', cwd, timeout: 60000 }).trim();

    if (framework === 'go-test') {
      // Parse go coverage output — look for low-coverage files
      for (const line of output.split('\n')) {
        const match = line.match(/^(.+):\s+\w+\s+([\d.]+)%/);
        if (match) {
          const pct = parseFloat(match[2]);
          if (pct < 50) {
            const filePath = resolve(cwd, match[1]);
            if (existsSync(filePath)) {
              candidates.push({ path: filePath, reason: `${pct.toFixed(0)}% coverage`, priority: 100 - pct });
            }
          }
        }
      }
    } else {
      // Try to parse JSON coverage for JS/Python frameworks
      try {
        const coveragePath = framework === 'pytest'
          ? join(cwd, 'coverage.json')
          : join(cwd, 'coverage', 'coverage-final.json');

        if (existsSync(coveragePath)) {
          const coverageData = JSON.parse(readFileSync(coveragePath, 'utf-8'));
          for (const [file, data] of Object.entries(coverageData)) {
            const fileData = data as Record<string, unknown>;
            const stmts = fileData.s as Record<string, number> | undefined;
            if (stmts) {
              const total = Object.keys(stmts).length;
              const covered = Object.values(stmts).filter(v => v > 0).length;
              const pct = total > 0 ? (covered / total) * 100 : 100;
              if (pct < 50) {
                const filePath = resolve(cwd, file);
                if (existsSync(filePath)) {
                  candidates.push({ path: filePath, reason: `${pct.toFixed(0)}% coverage`, priority: 100 - pct });
                }
              }
            }
          }
        }
      } catch { /* coverage parsing failed — return empty */ }
    }
  } catch {
    // Coverage command failed — return empty
  }

  return candidates;
}

/**
 * Discover files from a specific scope (path, directory, or glob pattern)
 */
function discoverFromScope(cwd: string, scope: string, stack: string): FileCandidate[] {
  const candidates: FileCandidate[] = [];
  const extensions = STACK_EXTENSIONS[stack] || STACK_EXTENSIONS.custom;
  const fullPath = resolve(cwd, scope);

  if (existsSync(fullPath)) {
    const stat = statSync(fullPath);
    if (stat.isFile()) {
      candidates.push({ path: fullPath, reason: 'specified file', priority: 100 });
    } else if (stat.isDirectory()) {
      collectSourceFiles(fullPath, extensions, candidates, cwd);
    }
  } else {
    // Treat as glob — use git ls-files for matching
    try {
      const files = execSync(`git ls-files "${scope}"`, { encoding: 'utf-8', cwd }).trim().split('\n').filter(Boolean);
      for (const f of files) {
        const filePath = resolve(cwd, f);
        if (extensions.some(ext => f.endsWith(ext)) && !isTestFile(f) && !isIgnoredPath(f)) {
          candidates.push({ path: filePath, reason: 'glob match', priority: 50 });
        }
      }
    } catch { /* glob failed */ }
  }

  return candidates;
}

/**
 * Discover files by scanning the project — rank by: no test, high import count, recent changes
 */
function discoverFromScan(cwd: string, stack: string, framework: string): FileCandidate[] {
  const candidates: FileCandidate[] = [];
  const extensions = STACK_EXTENSIONS[stack] || STACK_EXTENSIONS.custom;
  const testPatterns = FRAMEWORK_TEST_PATTERNS[framework] || [];

  // Get all tracked source files
  let files: string[];
  try {
    files = execSync('git ls-files', { encoding: 'utf-8', cwd }).trim().split('\n').filter(Boolean);
  } catch {
    // Not a git repo — walk directory
    const collected: FileCandidate[] = [];
    collectSourceFiles(cwd, extensions, collected, cwd);
    return collected;
  }

  // Filter to source files only
  const sourceFiles = files.filter(f =>
    extensions.some(ext => f.endsWith(ext)) && !isTestFile(f) && !isIgnoredPath(f)
  );

  // Find recently changed files (higher priority)
  let recentFiles: Set<string> = new Set();
  try {
    const recent = execSync('git log --diff-filter=AM --name-only --pretty="" -20', { encoding: 'utf-8', cwd }).trim().split('\n').filter(Boolean);
    recentFiles = new Set(recent);
  } catch { /* ignore */ }

  // Check which files have existing tests
  const testFileSet = new Set(files.filter(f => isTestFile(f)));

  for (const file of sourceFiles) {
    const hasTest = hasExistingTest(file, testFileSet, testPatterns, stack);
    let priority = 0;
    const reasons: string[] = [];

    if (!hasTest) {
      priority += 60;
      reasons.push('no existing test');
    } else {
      priority += 10;
      reasons.push('has test (may need more coverage)');
    }

    if (recentFiles.has(file)) {
      priority += 30;
      reasons.push('recently changed');
    }

    // Boost files with more imports (likely more complex)
    try {
      const content = readFileSync(resolve(cwd, file), 'utf-8');
      const importCount = (content.match(/^import\s/gm) || content.match(/^from\s/gm) || content.match(/require\(/gm) || []).length;
      if (importCount > 5) {
        priority += 10;
        reasons.push(`${importCount} imports`);
      }
    } catch { /* can't read file */ }

    candidates.push({
      path: resolve(cwd, file),
      reason: reasons.join(', '),
      priority,
    });
  }

  // Return top candidates (limit to reasonable count)
  return candidates.filter(c => c.priority >= 30).slice(0, 20);
}

/**
 * Recursively collect source files from a directory
 */
function collectSourceFiles(dir: string, extensions: string[], candidates: FileCandidate[], cwd: string): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isIgnoredPath(entry.name)) {
          collectSourceFiles(full, extensions, candidates, cwd);
        }
      } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext)) && !isTestFile(entry.name)) {
        candidates.push({ path: full, reason: 'directory scan', priority: 50 });
      }
    }
  } catch { /* permission error or similar */ }
}

/** Check if a filename looks like a test file */
function isTestFile(filePath: string): boolean {
  const name = basename(filePath);
  return /\.(test|spec)\.[^.]+$/.test(name)
    || name.startsWith('test_')
    || name.endsWith('_test.go')
    || name.endsWith('_test.py')
    || name.endsWith('Tests.swift')
    || /tests?\//.test(filePath);
}

/** Check if path should be ignored */
function isIgnoredPath(filePath: string): boolean {
  const ignored = ['node_modules', 'dist', 'build', '.git', '.swarm', 'vendor', '__pycache__', 'target', '.next', 'coverage'];
  return ignored.some(dir => filePath.includes(dir));
}

/** Check if a source file already has a corresponding test file */
function hasExistingTest(sourceFile: string, testFiles: Set<string>, testPatterns: string[], stack: string): boolean {
  const ext = extname(sourceFile);
  const base = basename(sourceFile, ext);
  const dir = sourceFile.replace(/\/[^/]+$/, '');

  for (const tf of testFiles) {
    // Check common test file naming patterns
    if (tf.includes(base) && isTestFile(tf)) {
      return true;
    }
  }

  // Check for test patterns relative to file
  for (const pattern of testPatterns) {
    if (stack === 'python') {
      if (testFiles.has(`test_${base}.py`) || testFiles.has(`${dir}/test_${base}.py`)) return true;
    } else if (stack === 'go') {
      if (testFiles.has(sourceFile.replace('.go', '_test.go'))) return true;
    } else {
      // JS/TS patterns
      const testName = `${base}${pattern}`;
      if (testFiles.has(`${dir}/${testName}`) || testFiles.has(`${dir}/__tests__/${testName}`)) return true;
    }
  }

  return false;
}

/**
 * Generate tests for a single file by spawning an engineer agent
 */
async function generateTestForFile(
  filePath: string,
  cwd: string,
  stack: string,
  framework: string,
  model: string,
  agentManager: import('../core/agent-manager.js').AgentManager,
  conventions: string | null,
): Promise<{ testFile: string }> {
  const relPath = relative(cwd, filePath);
  const fileContent = readFileSync(filePath, 'utf-8');
  const ext = extname(filePath);
  const base = basename(filePath, ext);

  // Determine expected test file location
  let testFilePath: string;
  if (framework === 'pytest') {
    testFilePath = `test_${base}.py`;
  } else if (framework === 'go-test') {
    testFilePath = relPath.replace('.go', '_test.go');
  } else {
    // JS/TS — place next to source file
    const testExt = ext.replace(/^\./, '.test.');
    testFilePath = relPath.replace(ext, testExt);
  }

  // Build context for the agent
  const promptParts = [
    `You are a test engineer generating tests for the file: ${relPath}`,
    `Test framework: ${framework}`,
    `Expected test file location: ${testFilePath}`,
    '',
    'Instructions:',
    `1. Read and understand the source file at ${relPath}`,
    '2. Generate comprehensive tests covering:',
    '   - Happy path scenarios',
    '   - Edge cases and error handling',
    '   - Boundary conditions',
    '   - Key function signatures and return values',
    `3. Write the test file to: ${testFilePath}`,
    `4. Follow ${framework} conventions and patterns`,
    '5. Use descriptive test names that explain behavior',
    '6. Mock external dependencies where appropriate',
    '7. DO NOT modify the source file — only create/update the test file',
    '',
    `Source file (${relPath}):`,
    '```',
    fileContent.slice(0, 30000), // Cap at 30KB
    '```',
  ];

  if (conventions) {
    promptParts.push('', 'Project conventions:', conventions);
  }

  const prompt = promptParts.join('\n');

  const agent = await agentManager.spawn({
    name: `test-gen-${base}`,
    persona: 'engineer',
    stack: stack as TechStack,
    prompt,
    model,
    cwd,
    interactive: false,
    permissionMode: 'auto',
    appendSystemPrompt: 'You are generating tests only. Do NOT modify source files. Only create or update test files.',
  });

  await agentManager.waitForAgent(agent.id);

  if (agent.status === 'error') {
    throw new Error(agent.error || 'Agent failed');
  }

  return { testFile: testFilePath };
}

/**
 * Verify generated tests and respawn agents to fix failures
 */
async function verifyAndFix(
  cwd: string,
  framework: string,
  generated: Array<{ file: string; testFile?: string }>,
  agentManager: import('../core/agent-manager.js').AgentManager,
  model: string,
  stack: string,
  conventions: string | null,
  maxParallel: number,
): Promise<void> {
  const runCmd = FRAMEWORK_RUN_CMD[framework] || FRAMEWORK_RUN_CMD.vitest;

  // Run tests
  const testSpinner = ora('Running generated tests...').start();
  let testOutput: string;
  let testPassed: boolean;

  try {
    testOutput = execSync(runCmd, { encoding: 'utf-8', cwd, timeout: 120000 }).trim();
    testPassed = true;
    testSpinner.succeed('All generated tests pass.');
  } catch (err) {
    testPassed = false;
    testOutput = (err as { stdout?: string; stderr?: string }).stdout || (err as { stderr?: string }).stderr || String(err);
    testSpinner.warn('Some tests failed — spawning agents to fix...');
  }

  if (testPassed) return;

  // Respawn agents to fix failures (one attempt)
  console.log(chalk.dim('  Attempting to fix test failures...\n'));

  const fixPrompt = [
    'Some generated tests are failing. Fix the test files so all tests pass.',
    '',
    'Test command output:',
    '```',
    testOutput.slice(0, 20000),
    '```',
    '',
    'Rules:',
    '1. Fix the TEST files, not the source files',
    '2. If a test is wrong about expected behavior, correct the test assertion',
    '3. If a mock is missing or incorrect, fix the mock',
    '4. Ensure imports are correct',
    '5. Run the tests again to verify your fix',
    '',
    'Test files to check:',
    generated.filter(g => g.testFile).map(g => `  - ${g.testFile}`).join('\n'),
  ].join('\n');

  if (conventions) {
    fixPrompt.concat('\n\nProject conventions:\n' + conventions);
  }

  const fixAgent = await agentManager.spawn({
    name: 'test-gen-fixer',
    persona: 'engineer',
    stack: stack as TechStack,
    prompt: fixPrompt,
    model,
    cwd,
    interactive: false,
    permissionMode: 'auto',
    appendSystemPrompt: 'You are fixing test files only. Do NOT modify source files.',
  });

  await agentManager.waitForAgent(fixAgent.id);

  // Verify fix
  try {
    execSync(runCmd, { encoding: 'utf-8', cwd, timeout: 120000 });
    console.log(chalk.green('  Tests fixed and passing.'));
  } catch {
    console.log(chalk.yellow('  Some tests still failing after fix attempt. Manual intervention may be needed.'));
  }
}
