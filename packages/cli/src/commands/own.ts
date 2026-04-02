import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import type { SurfaceDefinition, SurfaceStatus, SurfacesState } from '../types.js';

// ── File helpers ────────────────────────────────────────────────────────

function surfacesYamlPath(swarmDir: string): string {
  return join(swarmDir, 'surfaces.yaml');
}

function surfacesStatusPath(swarmDir: string): string {
  return join(swarmDir, 'surfaces-status.json');
}

function loadSurfaces(swarmDir: string): SurfaceDefinition[] {
  const p = surfacesYamlPath(swarmDir);
  if (!existsSync(p)) return [];
  const raw = readFileSync(p, 'utf-8');
  const parsed = parseYaml(raw);
  return Array.isArray(parsed?.surfaces) ? parsed.surfaces : [];
}

function saveSurfaces(swarmDir: string, surfaces: SurfaceDefinition[]): void {
  const p = surfacesYamlPath(swarmDir);
  writeFileSync(p, toYaml({ surfaces }, { lineWidth: 120 }), 'utf-8');
}

function loadStatus(swarmDir: string): SurfacesState {
  const p = surfacesStatusPath(swarmDir);
  if (!existsSync(p)) {
    return { surfaces: [], totalBudget: 0, totalSpent: 0 };
  }
  return JSON.parse(readFileSync(p, 'utf-8'));
}

function saveStatus(swarmDir: string, state: SurfacesState): void {
  const p = surfacesStatusPath(swarmDir);
  writeFileSync(p, JSON.stringify(state, null, 2), 'utf-8');
}

// ── SLO checking logic ─────────────────────────────────────────────────

function countFilesMatchingGlob(basePath: string, glob: string): number {
  // Simple glob matching: supports trailing /* and **/*
  // For a practical check we just count files under the directory
  const dir = glob.replace(/\/\*\*?\/?\*?$/, '').replace(/\/\*$/, '');
  const target = join(basePath, dir);
  if (!existsSync(target)) return 0;
  return countFilesRecursive(target);
}

function countFilesRecursive(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        count += countFilesRecursive(full);
      } else {
        count++;
      }
    }
  } catch {
    // Permission errors, etc.
  }
  return count;
}

function countTestFiles(basePath: string, paths: string[]): { testFiles: number; sourceFiles: number } {
  let testFiles = 0;
  let sourceFiles = 0;
  const testPatterns = [/\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /_test\.go$/, /_test\.py$/, /test_.*\.py$/];

  for (const globPath of paths) {
    const dir = globPath.replace(/\/\*\*?\/?\*?$/, '').replace(/\/\*$/, '');
    const target = join(basePath, dir);
    if (!existsSync(target)) continue;
    walkFiles(target, (filePath) => {
      const isTest = testPatterns.some((p) => p.test(filePath));
      if (isTest) testFiles++;
      else sourceFiles++;
    });
  }
  return { testFiles, sourceFiles };
}

function walkFiles(dir: string, cb: (path: string) => void): void {
  if (!existsSync(dir)) return;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkFiles(full, cb);
      } else {
        cb(full);
      }
    }
  } catch {
    // Ignore permission errors
  }
}

function checkPackageAge(basePath: string): { outdated: number; total: number } {
  const pkgPath = join(basePath, 'package.json');
  if (!existsSync(pkgPath)) return { outdated: 0, total: 0 };
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const total = Object.keys(deps).length;
    // Simple heuristic: deps pinned with ^ or ~ that are >0.x are likely maintained
    const outdated = Object.values(deps).filter((v) => {
      const ver = String(v);
      return ver.startsWith('0.') || ver.includes('alpha') || ver.includes('beta');
    }).length;
    return { outdated, total };
  } catch {
    return { outdated: 0, total: 0 };
  }
}

function evaluateSlo(
  sloName: string,
  sloTarget: string,
  paths: string[],
  basePath: string,
): { current: string; status: 'ok' | 'warning' | 'breach' } {
  const lower = sloName.toLowerCase();

  // Test coverage SLO: e.g. "test-coverage: >50%"
  if (lower.includes('test') && lower.includes('coverage')) {
    const { testFiles, sourceFiles } = countTestFiles(basePath, paths);
    const total = testFiles + sourceFiles;
    const ratio = total > 0 ? Math.round((testFiles / total) * 100) : 0;
    const targetNum = parseInt(sloTarget.replace(/[^0-9]/g, ''), 10) || 50;
    const current = `${ratio}%`;
    if (ratio >= targetNum) return { current, status: 'ok' };
    if (ratio >= targetNum * 0.8) return { current, status: 'warning' };
    return { current, status: 'breach' };
  }

  // File count SLO: e.g. "max-files: <200"
  if (lower.includes('file') && (lower.includes('max') || lower.includes('count'))) {
    let total = 0;
    for (const p of paths) {
      total += countFilesMatchingGlob(basePath, p);
    }
    const targetNum = parseInt(sloTarget.replace(/[^0-9]/g, ''), 10) || 200;
    const current = `${total} files`;
    if (sloTarget.startsWith('<') || sloTarget.startsWith('<=')) {
      if (total <= targetNum) return { current, status: 'ok' };
      if (total <= targetNum * 1.2) return { current, status: 'warning' };
      return { current, status: 'breach' };
    }
    // default: treat as max
    if (total <= targetNum) return { current, status: 'ok' };
    return { current, status: 'breach' };
  }

  // Dependency age SLO: e.g. "dep-health: <10% outdated"
  if (lower.includes('dep') && (lower.includes('health') || lower.includes('age') || lower.includes('outdated'))) {
    const { outdated, total } = checkPackageAge(basePath);
    const ratio = total > 0 ? Math.round((outdated / total) * 100) : 0;
    const targetNum = parseInt(sloTarget.replace(/[^0-9]/g, ''), 10) || 10;
    const current = `${ratio}% outdated (${outdated}/${total})`;
    if (ratio <= targetNum) return { current, status: 'ok' };
    if (ratio <= targetNum * 1.5) return { current, status: 'warning' };
    return { current, status: 'breach' };
  }

  // Fallback: unknown SLO type
  return { current: 'unknown', status: 'warning' };
}

// ── Command registration ────────────────────────────────────────────────

export function registerOwn(program: Command): void {
  const own = program
    .command('own')
    .description('Surface ownership manager — register, monitor, and maintain owned surfaces');

  // ── swarm own <name> ──────────────────────────────────────────────
  own
    .command('register <name>')
    .alias('add')
    .description('Register ownership of a surface area')
    .option('--slo <target>', 'SLO target (repeatable, format: "name:target")', collectOption, [])
    .option('--paths <glob>', 'File paths/globs for this surface (repeatable)', collectOption, [])
    .option('--budget <amount>', 'Monthly budget in USD')
    .option('--description <desc>', 'Description of the surface')
    .action(async (name: string, opts) => {
      const swarmDir = requireSwarmDir();
      const surfaces = loadSurfaces(swarmDir);

      const existing = surfaces.findIndex((s) => s.name === name);

      const slos: Record<string, string> = {};
      for (const entry of opts.slo as string[]) {
        const [key, ...rest] = entry.split(':');
        if (key && rest.length > 0) {
          slos[key.trim()] = rest.join(':').trim();
        }
      }

      const definition: SurfaceDefinition = {
        name,
        description: opts.description || `Surface: ${name}`,
        paths: (opts.paths as string[]).length > 0 ? opts.paths : ['src/**/*'],
        slos: Object.keys(slos).length > 0 ? slos : { 'test-coverage': '>50%' },
        owners: { human: [], swarm: true },
        ...(opts.budget ? { budget: { monthly: parseFloat(opts.budget) } } : {}),
      };

      if (existing >= 0) {
        surfaces[existing] = definition;
        console.log(chalk.yellow(`Updated surface: ${chalk.bold(name)}`));
      } else {
        surfaces.push(definition);
        console.log(chalk.green(`Registered surface: ${chalk.bold(name)}`));
      }

      saveSurfaces(swarmDir, surfaces);

      console.log(chalk.dim('  Paths: ') + definition.paths.join(', '));
      console.log(chalk.dim('  SLOs:'));
      for (const [k, v] of Object.entries(definition.slos)) {
        console.log(chalk.dim(`    ${k}: ${v}`));
      }
      if (definition.budget) {
        console.log(chalk.dim(`  Budget: $${definition.budget.monthly}/month`));
      }
      console.log();
      console.log(chalk.dim(`Saved to ${surfacesYamlPath(swarmDir)}`));
    });

  // ── swarm own list ────────────────────────────────────────────────
  own
    .command('list')
    .alias('ls')
    .description('List all owned surfaces with status')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const surfaces = loadSurfaces(swarmDir);

      if (surfaces.length === 0) {
        console.log(chalk.dim('No surfaces registered. Use `swarm own register <name>` to add one.'));
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(surfaces, null, 2));
        return;
      }

      const statusState = loadStatus(swarmDir);

      console.log();
      console.log(chalk.bold('Owned Surfaces'));
      console.log(chalk.dim('─'.repeat(70)));
      console.log();

      // Header
      console.log(
        chalk.dim('  ') +
        chalk.bold('Name'.padEnd(20)) +
        chalk.bold('Paths'.padEnd(20)) +
        chalk.bold('SLOs'.padEnd(10)) +
        chalk.bold('Health'.padEnd(10)) +
        chalk.bold('Budget'),
      );
      console.log(chalk.dim('  ' + '─'.repeat(66)));

      for (const surface of surfaces) {
        const status = statusState.surfaces.find((s) => s.name === surface.name);
        const pathsStr = surface.paths.length > 2
          ? `${surface.paths[0]} +${surface.paths.length - 1}`
          : surface.paths.join(', ');
        const sloCount = Object.keys(surface.slos).length;
        const health = status ? `${status.healthScore}%` : chalk.dim('--');
        const healthColor = status
          ? status.healthScore >= 80 ? chalk.green : status.healthScore >= 50 ? chalk.yellow : chalk.red
          : chalk.dim;
        const budget = surface.budget ? `$${surface.budget.monthly}` : chalk.dim('--');

        console.log(
          '  ' +
          chalk.white(surface.name.padEnd(20)) +
          chalk.dim(pathsStr.slice(0, 18).padEnd(20)) +
          chalk.cyan(String(sloCount).padEnd(10)) +
          healthColor(String(health).padEnd(10)) +
          chalk.dim(budget),
        );
      }

      console.log();
      console.log(chalk.dim(`  ${surfaces.length} surface(s) registered`));
    });

  // ── swarm own release <name> ──────────────────────────────────────
  own
    .command('release <name>')
    .alias('rm')
    .description('Remove ownership of a surface')
    .action(async (name: string) => {
      const swarmDir = requireSwarmDir();
      const surfaces = loadSurfaces(swarmDir);

      const idx = surfaces.findIndex((s) => s.name === name);
      if (idx < 0) {
        console.log(chalk.red(`Surface not found: ${name}`));
        console.log(chalk.dim('Use `swarm own list` to see registered surfaces.'));
        process.exitCode = 1;
        return;
      }

      surfaces.splice(idx, 1);
      saveSurfaces(swarmDir, surfaces);

      // Also remove from status
      const statusState = loadStatus(swarmDir);
      statusState.surfaces = statusState.surfaces.filter((s) => s.name !== name);
      saveStatus(swarmDir, statusState);

      console.log(chalk.green(`Released surface: ${chalk.bold(name)}`));
    });

  // ── swarm own check ───────────────────────────────────────────────
  own
    .command('check')
    .description('Check all surface SLOs against current state')
    .option('--surface <name>', 'Check a specific surface only')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const surfaces = loadSurfaces(swarmDir);
      const basePath = process.cwd();

      if (surfaces.length === 0) {
        console.log(chalk.dim('No surfaces registered.'));
        return;
      }

      const toCheck = opts.surface
        ? surfaces.filter((s) => s.name === opts.surface)
        : surfaces;

      if (toCheck.length === 0) {
        console.log(chalk.red(`Surface not found: ${opts.surface}`));
        process.exitCode = 1;
        return;
      }

      const statusState = loadStatus(swarmDir);
      const results: SurfaceStatus[] = [];
      let totalBreaches = 0;
      let totalWarnings = 0;

      for (const surface of toCheck) {
        const sloResults: SurfaceStatus['slos'] = [];

        for (const [sloName, sloTarget] of Object.entries(surface.slos)) {
          const result = evaluateSlo(sloName, sloTarget, surface.paths, basePath);
          sloResults.push({ name: sloName, target: sloTarget, current: result.current, status: result.status });
          if (result.status === 'breach') totalBreaches++;
          if (result.status === 'warning') totalWarnings++;
        }

        const okCount = sloResults.filter((s) => s.status === 'ok').length;
        const healthScore = sloResults.length > 0 ? Math.round((okCount / sloResults.length) * 100) : 100;

        // Find or create status entry
        const existingIdx = statusState.surfaces.findIndex((s) => s.name === surface.name);
        const status: SurfaceStatus = {
          name: surface.name,
          description: surface.description,
          paths: surface.paths,
          slos: sloResults,
          healthScore,
          lastChecked: Date.now(),
          maintenanceHistory: existingIdx >= 0 ? statusState.surfaces[existingIdx].maintenanceHistory : [],
          budgetUsed: existingIdx >= 0 ? statusState.surfaces[existingIdx].budgetUsed : 0,
          budgetTotal: surface.budget?.monthly || 0,
        };

        if (existingIdx >= 0) {
          statusState.surfaces[existingIdx] = status;
        } else {
          statusState.surfaces.push(status);
        }

        results.push(status);
      }

      saveStatus(swarmDir, statusState);

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      console.log();
      console.log(chalk.bold('SLO Check Results'));
      console.log(chalk.dim('─'.repeat(70)));

      for (const result of results) {
        console.log();
        const healthColor = result.healthScore >= 80 ? chalk.green : result.healthScore >= 50 ? chalk.yellow : chalk.red;
        console.log(`  ${chalk.bold(result.name)}  ${healthColor(`health: ${result.healthScore}%`)}`);
        console.log(chalk.dim(`  ${result.paths.join(', ')}`));
        console.log();

        for (const slo of result.slos) {
          const icon = slo.status === 'ok' ? chalk.green('PASS') : slo.status === 'warning' ? chalk.yellow('WARN') : chalk.red('FAIL');
          console.log(`    ${icon}  ${chalk.white(slo.name.padEnd(20))} target: ${chalk.dim(slo.target.padEnd(12))} current: ${chalk.white(slo.current)}`);
        }
      }

      console.log();
      console.log(chalk.dim('─'.repeat(70)));
      if (totalBreaches > 0) {
        console.log(chalk.red(`  ${totalBreaches} SLO breach(es)`));
      }
      if (totalWarnings > 0) {
        console.log(chalk.yellow(`  ${totalWarnings} SLO warning(s)`));
      }
      if (totalBreaches === 0 && totalWarnings === 0) {
        console.log(chalk.green('  All SLOs passing'));
      }
      console.log();
    });

  // ── swarm own status ──────────────────────────────────────────────
  own
    .command('status')
    .description('Detailed status of all owned surfaces')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const statusState = loadStatus(swarmDir);
      const surfaces = loadSurfaces(swarmDir);

      if (surfaces.length === 0) {
        console.log(chalk.dim('No surfaces registered. Use `swarm own register <name>` to add one.'));
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(statusState, null, 2));
        return;
      }

      console.log();
      console.log(chalk.bold('Surface Ownership Status'));
      console.log(chalk.dim('═'.repeat(70)));

      for (const surface of surfaces) {
        const status = statusState.surfaces.find((s) => s.name === surface.name);
        console.log();

        const healthColor = status && status.healthScore >= 80
          ? chalk.green
          : status && status.healthScore >= 50
            ? chalk.yellow
            : chalk.red;

        console.log(`  ${chalk.bold.white(surface.name)}  ${status ? healthColor(`[${status.healthScore}% healthy]`) : chalk.dim('[not checked]')}`);
        console.log(chalk.dim(`  ${surface.description}`));
        console.log();

        // Paths
        console.log(chalk.dim('  Paths:'));
        for (const p of surface.paths) {
          console.log(chalk.dim(`    - ${p}`));
        }

        // SLOs
        console.log(chalk.dim('  SLOs:'));
        if (status) {
          for (const slo of status.slos) {
            const statusIcon = slo.status === 'ok' ? chalk.green('OK')
              : slo.status === 'warning' ? chalk.yellow('WARN')
              : chalk.red('BREACH');
            console.log(`    ${statusIcon}  ${slo.name}: ${chalk.white(slo.current)} (target: ${slo.target})`);
          }
        } else {
          for (const [k, v] of Object.entries(surface.slos)) {
            console.log(chalk.dim(`    ${k}: ${v} (not yet checked)`));
          }
        }

        // Budget
        if (surface.budget || (status && status.budgetTotal > 0)) {
          const total = surface.budget?.monthly || status?.budgetTotal || 0;
          const used = status?.budgetUsed || 0;
          const pct = total > 0 ? Math.round((used / total) * 100) : 0;
          const budgetColor = pct > 90 ? chalk.red : pct > 70 ? chalk.yellow : chalk.green;
          console.log();
          console.log(`  ${chalk.dim('Budget:')} ${budgetColor(`$${used.toFixed(2)} / $${total.toFixed(2)}`)} ${chalk.dim(`(${pct}% used)`)}`);
        }

        // Owners
        if (surface.owners) {
          console.log();
          console.log(chalk.dim('  Owners:'));
          if (surface.owners.human.length > 0) {
            console.log(chalk.dim(`    Human: ${surface.owners.human.join(', ')}`));
          }
          console.log(chalk.dim(`    Swarm: ${surface.owners.swarm ? 'enabled' : 'disabled'}`));
        }

        // Maintenance history
        if (status && status.maintenanceHistory.length > 0) {
          console.log();
          console.log(chalk.dim('  Recent maintenance:'));
          const recent = status.maintenanceHistory.slice(-5);
          for (const entry of recent) {
            const time = new Date(entry.timestamp).toLocaleString();
            console.log(chalk.dim(`    ${time}  ${entry.action}  $${entry.cost.toFixed(4)}`));
          }
        }

        // Last checked
        if (status?.lastChecked) {
          console.log();
          console.log(chalk.dim(`  Last checked: ${new Date(status.lastChecked).toLocaleString()}`));
        }

        console.log(chalk.dim('  ' + '─'.repeat(66)));
      }

      // Summary
      console.log();
      const totalHealth = statusState.surfaces.length > 0
        ? Math.round(statusState.surfaces.reduce((sum, s) => sum + s.healthScore, 0) / statusState.surfaces.length)
        : 0;
      const overallColor = totalHealth >= 80 ? chalk.green : totalHealth >= 50 ? chalk.yellow : chalk.red;

      console.log(`  ${chalk.bold('Summary:')} ${surfaces.length} surface(s), ${overallColor(`avg health: ${totalHealth}%`)}`);
      if (statusState.totalBudget > 0) {
        console.log(`  ${chalk.dim('Total budget:')} $${statusState.totalSpent.toFixed(2)} / $${statusState.totalBudget.toFixed(2)}`);
      }
      console.log();
    });
}

// ── Utility ─────────────────────────────────────────────────────────────

function collectOption(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}
