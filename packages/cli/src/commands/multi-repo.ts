import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';

export interface MultiRepoRun {
  id: string;
  feature: string;
  repos: Array<{
    label: string;
    path: string;
    status: 'pending' | 'running' | 'done' | 'failed';
    prUrl?: string;
    cost: number;
    error?: string;
  }>;
  startedAt: number;
  completedAt?: number;
  totalCost: number;
}

function loadMultiRepoRuns(swarmDir: string): MultiRepoRun[] {
  const filePath = join(swarmDir, 'multi-repo-runs.json');
  if (!existsSync(filePath)) return [];
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
}

function saveMultiRepoRuns(swarmDir: string, runs: MultiRepoRun[]): void {
  const filePath = join(swarmDir, 'multi-repo-runs.json');
  writeFileSync(filePath, JSON.stringify(runs, null, 2));
}

function resolveRepoPaths(
  reposFlag: string | undefined,
  configRepos: Record<string, string> | undefined,
): Array<{ label: string; path: string }> {
  const resolved: Array<{ label: string; path: string }> = [];

  if (reposFlag) {
    const entries = reposFlag.split(',').map(s => s.trim()).filter(Boolean);
    for (const entry of entries) {
      // Check if it's a label from config
      if (configRepos && configRepos[entry]) {
        resolved.push({ label: entry, path: resolve(configRepos[entry]) });
      } else {
        // Treat as a path
        const absPath = resolve(entry);
        resolved.push({ label: basename(absPath), path: absPath });
      }
    }
  } else if (configRepos) {
    for (const [label, repoPath] of Object.entries(configRepos)) {
      resolved.push({ label, path: resolve(repoPath) });
    }
  }

  return resolved;
}

async function runFeatureOnRepo(
  repoPath: string,
  feature: string,
  model: string,
  budget: number,
  dryRun: boolean,
): Promise<{ cost: number; prUrl?: string; error?: string }> {
  const swarmDir = join(repoPath, '.swarm');
  const stack = autoDetectStack(repoPath);

  // Auto-init if needed
  if (!existsSync(swarmDir)) {
    const projectName = basename(repoPath);
    autoInit(projectName, stack, repoPath);
  }

  if (dryRun) {
    console.log(chalk.dim(`  [dry-run] Would run pipeline for: ${feature}`));
    console.log(chalk.dim(`  [dry-run] Stack: ${stack}, Model: ${model}, Budget: $${budget}`));
    return { cost: 0 };
  }

  const config = loadConfig(repoPath);
  config.model = model;
  config.maxBudgetUsd = budget;

  const { pipeline, cleanup } = createContext(swarmDir, config);

  try {
    await pipeline.runMayday(feature, {
      stack,
      maxIterations: 3,
      parallel: 2,
      maxFixBudgetUsd: budget,
    });

    // Read final state to get cost and PR URL
    const stateFile = join(swarmDir, 'state.json');
    let cost = 0;
    let prUrl: string | undefined;
    if (existsSync(stateFile)) {
      try {
        const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
        cost = state.totalCost?.totalUsd || 0;
        prUrl = state.mayday?.prUrl;
      } catch { /* ignore parse errors */ }
    }

    return { cost, prUrl };
  } catch (err) {
    return {
      cost: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    cleanup();
  }
}

export function registerMultiRepo(program: Command): void {
  const multiRepo = program
    .command('multi-repo')
    .description('Orchestrate features and sync across multiple repositories');

  // --- swarm multi-repo run <feature> ---
  multiRepo
    .command('run')
    .description('Run a feature across multiple repos')
    .argument('<feature>', 'Feature request to implement across repos')
    .option('--repos <repos>', 'Comma-separated repo labels (from config) or paths')
    .option('-m, --model <model>', 'Model to use (e.g., sonnet, openai/gpt-4o)', 'sonnet')
    .option('-b, --budget <amount>', 'Max budget per repo in USD', '20')
    .option('--parallel', 'Run repos in parallel (default: sequential)', false)
    .option('--dry-run', 'Plan only, don\'t execute', false)
    .action(async (feature: string, opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        const cwd = process.cwd();
        const stack = autoDetectStack(cwd);
        const projectName = basename(cwd);
        console.log(chalk.yellow(`No .swarm/ found — auto-initializing (stack: ${stack})...`));
        swarmDir = autoInit(projectName, stack, cwd);
      }

      const config = loadConfig();
      const repos = resolveRepoPaths(opts.repos, config.repos);

      if (repos.length === 0) {
        console.error(chalk.red('No repos specified. Use --repos flag or set repos in .swarm/config.yaml.'));
        process.exit(1);
      }

      // Validate repo paths
      for (const repo of repos) {
        if (!existsSync(repo.path)) {
          console.error(chalk.red(`Repo path not found: ${repo.path} (label: ${repo.label})`));
          process.exit(1);
        }
      }

      const budget = parseFloat(opts.budget) || 20;
      const model = opts.model || config.model;
      const parallel = opts.parallel || false;
      const dryRun = opts.dryRun || false;

      const runId = randomUUID().slice(0, 8);
      const run: MultiRepoRun = {
        id: runId,
        feature,
        repos: repos.map(r => ({
          label: r.label,
          path: r.path,
          status: 'pending',
          cost: 0,
        })),
        startedAt: Date.now(),
        totalCost: 0,
      };

      console.log(chalk.bold(`\nMulti-Repo Run: ${runId}`));
      console.log(chalk.dim(`Feature: ${feature.slice(0, 120)}${feature.length > 120 ? '...' : ''}`));
      console.log(chalk.dim(`Repos: ${repos.map(r => r.label).join(', ')}`));
      console.log(chalk.dim(`Model: ${model} | Budget/repo: $${budget} | Mode: ${parallel ? 'parallel' : 'sequential'}${dryRun ? ' | DRY RUN' : ''}\n`));

      if (parallel) {
        // Run all repos in parallel
        const promises = run.repos.map(async (repoEntry) => {
          const spinner = ora(`[${repoEntry.label}] Running...`).start();
          repoEntry.status = 'running';

          const contextualFeature = `[Multi-repo: ${repoEntry.label}] ${feature}\n\nThis is part of a multi-repo feature spanning: ${repos.map(r => r.label).join(', ')}. Focus on the changes relevant to THIS repository (${repoEntry.label} at ${repoEntry.path}).`;

          const result = await runFeatureOnRepo(repoEntry.path, contextualFeature, model, budget, dryRun);

          repoEntry.cost = result.cost;
          repoEntry.prUrl = result.prUrl;

          if (result.error) {
            repoEntry.status = 'failed';
            repoEntry.error = result.error;
            spinner.fail(`[${repoEntry.label}] Failed: ${result.error.slice(0, 80)}`);
          } else {
            repoEntry.status = 'done';
            spinner.succeed(`[${repoEntry.label}] Done — $${result.cost.toFixed(2)}${result.prUrl ? ` — PR: ${result.prUrl}` : ''}`);
          }
        });

        await Promise.all(promises);
      } else {
        // Run sequentially
        for (const repoEntry of run.repos) {
          const spinner = ora(`[${repoEntry.label}] Running...`).start();
          repoEntry.status = 'running';

          const contextualFeature = `[Multi-repo: ${repoEntry.label}] ${feature}\n\nThis is part of a multi-repo feature spanning: ${repos.map(r => r.label).join(', ')}. Focus on the changes relevant to THIS repository (${repoEntry.label} at ${repoEntry.path}).`;

          const result = await runFeatureOnRepo(repoEntry.path, contextualFeature, model, budget, dryRun);

          repoEntry.cost = result.cost;
          repoEntry.prUrl = result.prUrl;

          if (result.error) {
            repoEntry.status = 'failed';
            repoEntry.error = result.error;
            spinner.fail(`[${repoEntry.label}] Failed: ${result.error.slice(0, 80)}`);
          } else {
            repoEntry.status = 'done';
            spinner.succeed(`[${repoEntry.label}] Done — $${result.cost.toFixed(2)}${result.prUrl ? ` — PR: ${result.prUrl}` : ''}`);
          }
        }
      }

      // Calculate totals
      run.totalCost = run.repos.reduce((sum, r) => sum + r.cost, 0);
      run.completedAt = Date.now();

      // Save run record
      const runs = loadMultiRepoRuns(swarmDir);
      runs.push(run);
      saveMultiRepoRuns(swarmDir, runs);

      // Cross-repo PR linking summary
      const prUrls = run.repos.filter(r => r.prUrl).map(r => ({ label: r.label, prUrl: r.prUrl! }));

      console.log(chalk.bold('\n--- Cross-Repo Summary ---'));
      const doneCount = run.repos.filter(r => r.status === 'done').length;
      const failedCount = run.repos.filter(r => r.status === 'failed').length;
      console.log(`  Completed: ${chalk.green(String(doneCount))}  Failed: ${failedCount > 0 ? chalk.red(String(failedCount)) : chalk.dim('0')}`);
      console.log(`  Total cost: $${run.totalCost.toFixed(2)}`);
      console.log(`  Duration: ${Math.round((run.completedAt - run.startedAt) / 1000)}s`);

      if (prUrls.length > 0) {
        console.log(chalk.bold('\n  Linked PRs:'));
        for (const pr of prUrls) {
          console.log(`    ${chalk.cyan(pr.label)}: ${pr.prUrl}`);
        }
        if (prUrls.length > 1) {
          console.log(chalk.dim('\n  Tip: Add cross-references between these PRs for traceability.'));
        }
      }

      if (failedCount > 0) {
        console.log(chalk.yellow('\n  Failed repos:'));
        for (const r of run.repos.filter(r => r.status === 'failed')) {
          console.log(`    ${chalk.red(r.label)}: ${r.error?.slice(0, 120) || 'Unknown error'}`);
        }
      }

      console.log('');
    });

  // --- swarm multi-repo status ---
  multiRepo
    .command('status')
    .description('Show status across repos')
    .action(async () => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run hivemind init first.'));
        process.exit(1);
      }

      const config = loadConfig();
      const repos = resolveRepoPaths(undefined, config.repos);

      if (repos.length === 0) {
        console.log(chalk.dim('No repos configured in .swarm/config.yaml.'));
        return;
      }

      console.log(chalk.bold(`\nMulti-Repo Status (${repos.length} repos)\n`));

      for (const repo of repos) {
        const repoSwarmDir = join(repo.path, '.swarm');
        const stateFile = join(repoSwarmDir, 'state.json');

        if (!existsSync(repo.path)) {
          console.log(`  ${chalk.bold(repo.label)}  ${chalk.red('NOT FOUND')}  ${chalk.dim(repo.path)}`);
          continue;
        }

        if (!existsSync(stateFile)) {
          console.log(`  ${chalk.bold(repo.label)}  ${chalk.dim('not initialized')}  ${chalk.dim(repo.path)}`);
          continue;
        }

        try {
          const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
          const cost = state.totalCost?.totalUsd || 0;
          const maydayActive = state.mayday?.active || false;
          const currentStage = state.mayday?.currentStage || 'idle';
          const stack = state.stack || 'unknown';

          const statusColor = maydayActive
            ? chalk.yellow
            : currentStage === 'complete'
            ? chalk.green
            : chalk.dim;

          console.log(`  ${chalk.bold(repo.label.padEnd(20))}  ${statusColor(currentStage.padEnd(12))}  ${chalk.dim(stack.padEnd(8))}  $${cost.toFixed(2).padStart(7)}  ${chalk.dim(repo.path)}`);
        } catch {
          console.log(`  ${chalk.bold(repo.label)}  ${chalk.red('state error')}  ${chalk.dim(repo.path)}`);
        }
      }

      // Show recent multi-repo runs
      const runs = loadMultiRepoRuns(swarmDir);
      if (runs.length > 0) {
        const recent = runs.slice(-5).reverse();
        console.log(chalk.bold(`\nRecent Multi-Repo Runs (${runs.length} total)\n`));
        for (const run of recent) {
          const date = new Date(run.startedAt).toLocaleString();
          const done = run.repos.filter(r => r.status === 'done').length;
          const failed = run.repos.filter(r => r.status === 'failed').length;
          const total = run.repos.length;
          const statusStr = failed > 0
            ? chalk.yellow(`${done}/${total} done, ${failed} failed`)
            : chalk.green(`${done}/${total} done`);

          console.log(`  ${chalk.bold(run.id)}  ${statusStr}  $${run.totalCost.toFixed(2)}  ${chalk.dim(date)}`);
          console.log(`    ${run.feature.slice(0, 100)}${run.feature.length > 100 ? '...' : ''}`);
          console.log('');
        }
      }
    });

  // --- swarm multi-repo sync ---
  multiRepo
    .command('sync')
    .description('Sync API contracts across repos')
    .action(async () => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run hivemind init first.'));
        process.exit(1);
      }

      const config = loadConfig();
      const repos = resolveRepoPaths(undefined, config.repos);

      if (repos.length < 2) {
        console.log(chalk.dim('Need at least 2 repos configured for sync. Set repos in .swarm/config.yaml.'));
        return;
      }

      console.log(chalk.bold(`\nAPI Contract Sync — ${repos.length} repos\n`));

      // Common API contract file patterns
      const contractPatterns = [
        'openapi.yaml', 'openapi.yml', 'openapi.json',
        'swagger.yaml', 'swagger.yml', 'swagger.json',
        'api-schema.json', 'api-schema.yaml',
        'schema.graphql', 'schema.gql',
        'proto', // directory for protobuf
      ];

      const repoContracts: Array<{
        label: string;
        path: string;
        contracts: Array<{ file: string; content: string; size: number }>;
      }> = [];

      for (const repo of repos) {
        if (!existsSync(repo.path)) {
          console.log(chalk.yellow(`  Skipping ${repo.label} — path not found`));
          continue;
        }

        const contracts: Array<{ file: string; content: string; size: number }> = [];

        // Search for contract files
        for (const pattern of contractPatterns) {
          // Check root level
          const rootFile = join(repo.path, pattern);
          if (existsSync(rootFile)) {
            try {
              const content = readFileSync(rootFile, 'utf-8');
              contracts.push({ file: pattern, content, size: content.length });
            } catch { /* skip unreadable */ }
          }

          // Check common subdirectories
          for (const subdir of ['api', 'docs', 'spec', 'contracts', 'schemas']) {
            const subFile = join(repo.path, subdir, pattern);
            if (existsSync(subFile)) {
              try {
                const content = readFileSync(subFile, 'utf-8');
                contracts.push({ file: join(subdir, pattern), content, size: content.length });
              } catch { /* skip */ }
            }
          }
        }

        // Also check for shared types directories
        for (const typesDir of ['shared', 'types', 'shared-types', 'common']) {
          const dirPath = join(repo.path, typesDir);
          if (existsSync(dirPath)) {
            try {
              const files = readdirSync(dirPath).filter(f =>
                f.endsWith('.ts') || f.endsWith('.json') || f.endsWith('.yaml') || f.endsWith('.yml')
              );
              for (const file of files.slice(0, 20)) { // cap at 20 files
                try {
                  const content = readFileSync(join(dirPath, file), 'utf-8');
                  contracts.push({ file: join(typesDir, file), content, size: content.length });
                } catch { /* skip */ }
              }
            } catch { /* not a directory or unreadable */ }
          }
        }

        repoContracts.push({ label: repo.label, path: repo.path, contracts });
      }

      // Report findings
      for (const rc of repoContracts) {
        if (rc.contracts.length === 0) {
          console.log(`  ${chalk.bold(rc.label)}  ${chalk.dim('No API contracts found')}`);
        } else {
          console.log(`  ${chalk.bold(rc.label)}  ${chalk.cyan(`${rc.contracts.length} contract file(s)`)}`);
          for (const c of rc.contracts) {
            console.log(chalk.dim(`    ${c.file} (${c.size} bytes)`));
          }
        }
      }

      // Compare contracts across repos (pairwise)
      const mismatches: Array<{ file: string; repos: string[]; detail: string }> = [];

      for (let i = 0; i < repoContracts.length; i++) {
        for (let j = i + 1; j < repoContracts.length; j++) {
          const a = repoContracts[i];
          const b = repoContracts[j];

          // Find files with matching names
          for (const ac of a.contracts) {
            const bc = b.contracts.find(c => basename(c.file) === basename(ac.file));
            if (bc) {
              if (ac.content !== bc.content) {
                const sizeDiff = Math.abs(ac.size - bc.size);
                mismatches.push({
                  file: basename(ac.file),
                  repos: [a.label, b.label],
                  detail: `Size diff: ${sizeDiff} bytes (${a.label}: ${ac.size}B, ${b.label}: ${bc.size}B)`,
                });
              }
            }
          }
        }
      }

      if (mismatches.length > 0) {
        console.log(chalk.bold.yellow(`\n  Mismatches Found: ${mismatches.length}\n`));
        for (const m of mismatches) {
          console.log(`    ${chalk.yellow('!')} ${chalk.bold(m.file)} differs between ${m.repos.join(' and ')}`);
          console.log(chalk.dim(`      ${m.detail}`));
        }
        console.log(chalk.dim('\n  Run "hivemind multi-repo run <feature>" to align contracts across repos.'));
      } else if (repoContracts.some(rc => rc.contracts.length > 0)) {
        console.log(chalk.green('\n  All shared contracts are in sync.'));
      } else {
        console.log(chalk.dim('\n  No shared API contracts detected across repos.'));
        console.log(chalk.dim('  Supported formats: OpenAPI (yaml/json), GraphQL schema, Protobuf'));
      }

      console.log('');
    });
}
