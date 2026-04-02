import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';

type UpdateLevel = 'patch' | 'minor' | 'major';

interface OutdatedDep {
  name: string;
  current: string;
  wanted: string;
  latest: string;
  type: 'prod' | 'dev';
  level: UpdateLevel;
}

interface AuditVulnerability {
  name: string;
  severity: string;
  title: string;
  url: string;
  fixAvailable: boolean | string;
  range: string;
}

function detectPackageManager(cwd: string): 'npm' | 'pip' | 'go' {
  if (existsSync(join(cwd, 'package.json'))) return 'npm';
  if (existsSync(join(cwd, 'requirements.txt')) || existsSync(join(cwd, 'pyproject.toml'))) return 'pip';
  if (existsSync(join(cwd, 'go.mod'))) return 'go';
  return 'npm';
}

function classifyLevel(current: string, wanted: string, latest: string): UpdateLevel {
  const target = latest;
  const curParts = current.replace(/^[^0-9]*/, '').split('.').map(Number);
  const tgtParts = target.replace(/^[^0-9]*/, '').split('.').map(Number);

  if ((tgtParts[0] ?? 0) > (curParts[0] ?? 0)) return 'major';
  if ((tgtParts[1] ?? 0) > (curParts[1] ?? 0)) return 'minor';
  return 'patch';
}

function riskColor(level: UpdateLevel): (s: string) => string {
  if (level === 'patch') return chalk.green;
  if (level === 'minor') return chalk.yellow;
  return chalk.red;
}

function runNpmOutdated(cwd: string): OutdatedDep[] {
  let raw: string;
  try {
    // npm outdated returns exit code 1 when there are outdated deps
    raw = execSync('npm outdated --json 2>/dev/null', { encoding: 'utf-8', cwd });
  } catch (err: unknown) {
    // npm outdated exits with code 1 when outdated deps exist — capture stdout
    const execErr = err as { stdout?: string; status?: number };
    if (execErr.stdout) {
      raw = execErr.stdout;
    } else {
      return [];
    }
  }

  if (!raw || raw.trim() === '{}') return [];

  let parsed: Record<string, { current: string; wanted: string; latest: string; type?: string }>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  // Determine which packages are devDependencies
  let devDeps = new Set<string>();
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
    devDeps = new Set(Object.keys(pkg.devDependencies || {}));
  } catch {
    // ignore
  }

  return Object.entries(parsed).map(([name, info]) => ({
    name,
    current: info.current || '?',
    wanted: info.wanted || '?',
    latest: info.latest || '?',
    type: devDeps.has(name) ? 'dev' as const : 'prod' as const,
    level: classifyLevel(info.current || '0.0.0', info.wanted || '0.0.0', info.latest || '0.0.0'),
  }));
}

function runPipOutdated(cwd: string): OutdatedDep[] {
  let raw: string;
  try {
    raw = execSync('pip list --outdated --format json 2>/dev/null', { encoding: 'utf-8', cwd });
  } catch {
    return [];
  }

  let parsed: Array<{ name: string; version: string; latest_version: string }>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  return parsed.map((pkg) => ({
    name: pkg.name,
    current: pkg.version,
    wanted: pkg.latest_version,
    latest: pkg.latest_version,
    type: 'prod' as const,
    level: classifyLevel(pkg.version, pkg.latest_version, pkg.latest_version),
  }));
}

function runGoOutdated(cwd: string): OutdatedDep[] {
  let raw: string;
  try {
    raw = execSync('go list -u -m -json all 2>/dev/null', { encoding: 'utf-8', cwd });
  } catch {
    return [];
  }

  const deps: OutdatedDep[] = [];
  // go list -u -m -json outputs concatenated JSON objects
  const objects = raw.split(/\n(?=\{)/);
  for (const obj of objects) {
    try {
      const mod = JSON.parse(obj.trim());
      if (mod.Update && mod.Version) {
        deps.push({
          name: mod.Path,
          current: mod.Version,
          wanted: mod.Update.Version,
          latest: mod.Update.Version,
          type: mod.Indirect ? 'dev' : 'prod',
          level: classifyLevel(mod.Version, mod.Update.Version, mod.Update.Version),
        });
      }
    } catch {
      // skip malformed
    }
  }
  return deps;
}

function getOutdated(cwd: string): { manager: string; deps: OutdatedDep[] } {
  const mgr = detectPackageManager(cwd);
  switch (mgr) {
    case 'npm': return { manager: 'npm', deps: runNpmOutdated(cwd) };
    case 'pip': return { manager: 'pip', deps: runPipOutdated(cwd) };
    case 'go': return { manager: 'go', deps: runGoOutdated(cwd) };
  }
}

function printDepsTable(deps: OutdatedDep[]): void {
  if (deps.length === 0) {
    console.log(chalk.green('\n  All dependencies are up to date.\n'));
    return;
  }

  // Column widths
  const nameW = Math.max(7, ...deps.map(d => d.name.length)) + 2;
  const curW = 10;
  const wantW = 10;
  const latW = 10;
  const typeW = 6;

  const header = `  ${'Package'.padEnd(nameW)}${'Current'.padEnd(curW)}${'Wanted'.padEnd(wantW)}${'Latest'.padEnd(latW)}${'Type'.padEnd(typeW)}Risk`;
  console.log(chalk.bold(header));
  console.log(chalk.dim('  ' + '─'.repeat(header.length - 2)));

  // Sort: patches first, then minors, then majors
  const order: Record<UpdateLevel, number> = { patch: 0, minor: 1, major: 2 };
  const sorted = [...deps].sort((a, b) => order[a.level] - order[b.level]);

  for (const dep of sorted) {
    const color = riskColor(dep.level);
    const line = `  ${dep.name.padEnd(nameW)}${dep.current.padEnd(curW)}${dep.wanted.padEnd(wantW)}${dep.latest.padEnd(latW)}${dep.type.padEnd(typeW)}${color(dep.level)}`;
    console.log(line);
  }

  const patches = deps.filter(d => d.level === 'patch').length;
  const minors = deps.filter(d => d.level === 'minor').length;
  const majors = deps.filter(d => d.level === 'major').length;
  console.log(chalk.dim(`\n  ${deps.length} outdated: ${chalk.green(patches + ' patch')}, ${chalk.yellow(minors + ' minor')}, ${chalk.red(majors + ' major')}\n`));
}

function runNpmAudit(cwd: string): AuditVulnerability[] {
  let raw: string;
  try {
    raw = execSync('npm audit --json 2>/dev/null', { encoding: 'utf-8', cwd });
  } catch (err: unknown) {
    const execErr = err as { stdout?: string };
    if (execErr.stdout) {
      raw = execErr.stdout;
    } else {
      return [];
    }
  }

  let parsed: { vulnerabilities?: Record<string, { severity: string; name: string; via: Array<{ title?: string; url?: string } | string>; range: string; fixAvailable: boolean | { name: string; version: string } }> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!parsed.vulnerabilities) return [];

  return Object.values(parsed.vulnerabilities).map((v) => {
    const viaObj = v.via.find((x): x is { title?: string; url?: string } => typeof x !== 'string');
    return {
      name: v.name,
      severity: v.severity,
      title: viaObj?.title || 'Unknown',
      url: viaObj?.url || '',
      fixAvailable: typeof v.fixAvailable === 'object' ? `${v.fixAvailable.name}@${v.fixAvailable.version}` : v.fixAvailable,
      range: v.range,
    };
  });
}

function runPipAudit(cwd: string): AuditVulnerability[] {
  let raw: string;
  try {
    raw = execSync('pip-audit --format json 2>/dev/null', { encoding: 'utf-8', cwd });
  } catch (err: unknown) {
    const execErr = err as { stdout?: string };
    if (execErr.stdout) {
      raw = execErr.stdout;
    } else {
      // Try pip audit (without hyphen)
      try {
        raw = execSync('pip audit --format json 2>/dev/null', { encoding: 'utf-8', cwd });
      } catch {
        return [];
      }
    }
  }

  let parsed: Array<{ name: string; version: string; vulns: Array<{ id: string; description: string; fix_versions: string[] }> }>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const results: AuditVulnerability[] = [];
  for (const pkg of parsed) {
    for (const v of pkg.vulns) {
      results.push({
        name: pkg.name,
        severity: 'high',
        title: v.description.slice(0, 100),
        url: `https://osv.dev/vulnerability/${v.id}`,
        fixAvailable: v.fix_versions.length > 0 ? v.fix_versions[0] : false,
        range: pkg.version,
      });
    }
  }
  return results;
}

function runGoAudit(cwd: string): AuditVulnerability[] {
  let raw: string;
  try {
    raw = execSync('govulncheck -json ./... 2>/dev/null', { encoding: 'utf-8', cwd });
  } catch (err: unknown) {
    const execErr = err as { stdout?: string };
    if (execErr.stdout) {
      raw = execErr.stdout;
    } else {
      return [];
    }
  }

  // govulncheck JSON output contains Finding objects
  const results: AuditVulnerability[] = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    try {
      const obj = JSON.parse(line.trim());
      if (obj.finding) {
        results.push({
          name: obj.finding.osv || 'unknown',
          severity: 'high',
          title: obj.finding.osv || 'Go vulnerability',
          url: `https://pkg.go.dev/vuln/${obj.finding.osv}`,
          fixAvailable: obj.finding.fixed_version || false,
          range: obj.finding.module_version || '',
        });
      }
    } catch {
      // skip
    }
  }
  return results;
}

function getAuditResults(cwd: string): { manager: string; vulns: AuditVulnerability[] } {
  const mgr = detectPackageManager(cwd);
  switch (mgr) {
    case 'npm': return { manager: 'npm', vulns: runNpmAudit(cwd) };
    case 'pip': return { manager: 'pip', vulns: runPipAudit(cwd) };
    case 'go': return { manager: 'go', vulns: runGoAudit(cwd) };
  }
}

function printAuditTable(vulns: AuditVulnerability[]): void {
  if (vulns.length === 0) {
    console.log(chalk.green('\n  No known vulnerabilities found.\n'));
    return;
  }

  const severityColor = (s: string) => {
    switch (s) {
      case 'critical': return chalk.bgRed.white;
      case 'high': return chalk.red;
      case 'moderate': return chalk.yellow;
      case 'low': return chalk.dim;
      default: return chalk.white;
    }
  };

  const nameW = Math.max(7, ...vulns.map(v => v.name.length)) + 2;
  const sevW = 12;
  const titleW = 40;

  const header = `  ${'Package'.padEnd(nameW)}${'Severity'.padEnd(sevW)}${'Title'.padEnd(titleW)}Fix`;
  console.log(chalk.bold(header));
  console.log(chalk.dim('  ' + '─'.repeat(header.length - 2)));

  // Sort by severity
  const sevOrder: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
  const sorted = [...vulns].sort((a, b) => (sevOrder[a.severity] ?? 5) - (sevOrder[b.severity] ?? 5));

  for (const v of sorted) {
    const color = severityColor(v.severity);
    const fix = typeof v.fixAvailable === 'string' ? v.fixAvailable : v.fixAvailable ? chalk.green('yes') : chalk.red('no');
    const title = v.title.length > titleW - 2 ? v.title.slice(0, titleW - 5) + '...' : v.title;
    console.log(`  ${v.name.padEnd(nameW)}${color(v.severity.padEnd(sevW))}${title.padEnd(titleW)}${fix}`);
  }

  const critical = vulns.filter(v => v.severity === 'critical').length;
  const high = vulns.filter(v => v.severity === 'high').length;
  const moderate = vulns.filter(v => v.severity === 'moderate').length;
  const low = vulns.filter(v => v.severity === 'low').length;
  console.log(chalk.dim(`\n  ${vulns.length} vulnerabilities: ${critical} critical, ${high} high, ${moderate} moderate, ${low} low\n`));
}

export function registerDeps(program: Command): void {
  const cmd = program
    .command('deps')
    .description('Intelligent dependency management — check, update, and audit');

  // --- deps check ---
  cmd
    .command('check')
    .description('Scan and classify outdated dependencies')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const cwd = process.cwd();
      const { manager, deps } = getOutdated(cwd);

      console.log(chalk.bold(`\nDependency Check`));
      console.log(chalk.dim(`Package manager: ${manager}\n`));

      if (opts.json) {
        console.log(JSON.stringify(deps, null, 2));
        return;
      }

      printDepsTable(deps);
    });

  // --- deps update ---
  cmd
    .command('update')
    .description('Apply safe dependency updates (patches, then minors)')
    .option('-m, --model <model>', 'Model for major update agent', 'sonnet')
    .option('-l, --level <level>', 'Update level: patch, minor, or major', 'minor')
    .option('--dry-run', 'Show what would change without applying')
    .option('-b, --budget <amount>', 'Max budget for agent-assisted major updates in USD', '5')
    .option('--verify', 'Run tests after updates')
    .action(async (opts) => {
      const cwd = process.cwd();
      const level = (opts.level || 'minor') as UpdateLevel;
      const dryRun = opts.dryRun ?? false;
      const verify = opts.verify ?? false;
      const model = opts.model || 'sonnet';
      const budget = parseFloat(opts.budget) || 5;
      const manager = detectPackageManager(cwd);

      console.log(chalk.bold(`\nDependency Update`));
      console.log(chalk.dim(`Level: ${level} | Dry-run: ${dryRun} | Verify: ${verify} | Manager: ${manager}\n`));

      // Step 1: Check what's outdated
      const { deps } = getOutdated(cwd);
      if (deps.length === 0) {
        console.log(chalk.green('  All dependencies are up to date. Nothing to do.\n'));
        return;
      }

      // Filter by level
      const levelOrder: Record<UpdateLevel, number> = { patch: 0, minor: 1, major: 2 };
      const targetDeps = deps.filter(d => levelOrder[d.level] <= levelOrder[level]);

      if (targetDeps.length === 0) {
        console.log(chalk.dim(`  No updates at level "${level}" or below.\n`));
        return;
      }

      const patches = targetDeps.filter(d => d.level === 'patch');
      const minors = targetDeps.filter(d => d.level === 'minor');
      const majors = targetDeps.filter(d => d.level === 'major');

      // Step 2: Apply patches in batch
      if (patches.length > 0) {
        console.log(chalk.cyan(`  Applying ${patches.length} patch update(s)...`));
        if (dryRun) {
          for (const p of patches) {
            console.log(chalk.dim(`    ${p.name}: ${p.current} -> ${p.wanted}`));
          }
        } else if (manager === 'npm') {
          try {
            const pkgNames = patches.map(p => `${p.name}@${p.wanted}`).join(' ');
            execSync(`npm install ${pkgNames} --save-exact`, { cwd, stdio: 'pipe' });
            console.log(chalk.green(`    ${patches.length} patch(es) applied.`));
          } catch (err) {
            console.error(chalk.red(`    Failed to apply patches: ${err instanceof Error ? err.message : err}`));
          }
        } else if (manager === 'pip') {
          try {
            const pkgNames = patches.map(p => `${p.name}==${p.wanted}`).join(' ');
            execSync(`pip install ${pkgNames}`, { cwd, stdio: 'pipe' });
            console.log(chalk.green(`    ${patches.length} patch(es) applied.`));
          } catch (err) {
            console.error(chalk.red(`    Failed to apply patches: ${err instanceof Error ? err.message : err}`));
          }
        } else if (manager === 'go') {
          for (const p of patches) {
            try {
              execSync(`go get ${p.name}@${p.wanted}`, { cwd, stdio: 'pipe' });
            } catch {
              console.error(chalk.red(`    Failed to update ${p.name}`));
            }
          }
          console.log(chalk.green(`    ${patches.length} patch(es) applied.`));
        }
      }

      // Step 3: Apply minors one-by-one
      if (minors.length > 0 && levelOrder[level] >= 1) {
        console.log(chalk.cyan(`\n  Applying ${minors.length} minor update(s) one-by-one...`));
        for (const dep of minors) {
          if (dryRun) {
            console.log(chalk.dim(`    ${dep.name}: ${dep.current} -> ${dep.latest}`));
            continue;
          }
          console.log(chalk.dim(`    Updating ${dep.name}: ${dep.current} -> ${dep.latest}`));
          try {
            if (manager === 'npm') {
              execSync(`npm install ${dep.name}@${dep.latest}`, { cwd, stdio: 'pipe' });
            } else if (manager === 'pip') {
              execSync(`pip install ${dep.name}==${dep.latest}`, { cwd, stdio: 'pipe' });
            } else if (manager === 'go') {
              execSync(`go get ${dep.name}@${dep.latest}`, { cwd, stdio: 'pipe' });
            }

            // Run tests after each minor if --verify
            if (verify) {
              try {
                const testCmd = manager === 'npm' ? 'npm test' : manager === 'pip' ? 'pytest' : 'go test ./...';
                execSync(testCmd, { cwd, stdio: 'pipe', timeout: 120000 });
                console.log(chalk.green(`      Tests passed after ${dep.name} update.`));
              } catch {
                console.log(chalk.red(`      Tests FAILED after ${dep.name} update. Consider reverting.`));
              }
            }
          } catch (err) {
            console.error(chalk.red(`    Failed to update ${dep.name}: ${err instanceof Error ? err.message : err}`));
          }
        }
      }

      // Step 4: Major updates — spawn agent
      if (majors.length > 0 && level === 'major') {
        console.log(chalk.cyan(`\n  ${majors.length} major update(s) require agent-assisted migration.`));
        if (dryRun) {
          for (const m of majors) {
            console.log(chalk.dim(`    ${m.name}: ${m.current} -> ${m.latest} (major)`));
          }
        } else {
          let swarmDir: string;
          try {
            swarmDir = requireSwarmDir();
          } catch {
            const stack = autoDetectStack(cwd);
            const projectName = cwd.split('/').pop() || 'my-project';
            console.log(chalk.yellow(`  No .swarm/ found — auto-initializing (stack: ${stack})...`));
            swarmDir = autoInit(projectName, stack, cwd);
          }

          const config = loadConfig();
          config.model = model;
          config.maxBudgetUsd = budget;

          const { agentManager, cleanup } = createContext(swarmDir, config);
          try {
            for (const dep of majors) {
              console.log(chalk.cyan(`\n    Spawning engineer for ${dep.name} ${dep.current} -> ${dep.latest}...`));
              const prompt = [
                `You are upgrading the dependency "${dep.name}" from version ${dep.current} to ${dep.latest} (major version change).`,
                '',
                'Steps:',
                `1. Read the changelog/release notes for ${dep.name} between ${dep.current} and ${dep.latest}`,
                `2. Update ${dep.name} to ${dep.latest} in the project`,
                '3. Fix any breaking changes in the codebase',
                '4. Run tests to verify the update works',
                '',
                'Be thorough — check for breaking API changes, removed features, and renamed exports.',
              ].join('\n');

              const agent = await agentManager.spawn({
                name: `deps-upgrade-${dep.name}`,
                persona: 'engineer',
                stack: config.stack,
                prompt,
                model,
                cwd,
                interactive: false,
                permissionMode: 'auto',
              });

              await agentManager.waitForAgent(agent.id);
              const cost = agent.cost.totalUsd;
              const status = agent.status === 'done' ? chalk.green('done') : chalk.red('error');
              console.log(`    ${dep.name}: ${status} ($${cost.toFixed(2)})`);
            }
          } finally {
            cleanup();
          }
        }
      }

      // Step 5: Final verification
      if (verify && !dryRun) {
        console.log(chalk.cyan('\n  Running final test verification...'));
        try {
          const testCmd = manager === 'npm' ? 'npm test' : manager === 'pip' ? 'pytest' : 'go test ./...';
          execSync(testCmd, { cwd, stdio: 'inherit', timeout: 300000 });
          console.log(chalk.green('  All tests passed after updates.\n'));
        } catch {
          console.log(chalk.red('  Tests FAILED after updates. Review changes before committing.\n'));
        }
      }

      if (dryRun) {
        console.log(chalk.dim('\n  Dry run — no changes applied.\n'));
      } else {
        console.log(chalk.green('\n  Dependency update complete.\n'));
      }
    });

  // --- deps audit ---
  cmd
    .command('audit')
    .description('Check for known vulnerabilities in dependencies')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const cwd = process.cwd();
      const { manager, vulns } = getAuditResults(cwd);

      console.log(chalk.bold(`\nSecurity Audit`));
      console.log(chalk.dim(`Package manager: ${manager}\n`));

      if (opts.json) {
        console.log(JSON.stringify(vulns, null, 2));
        return;
      }

      printAuditTable(vulns);
    });
}
