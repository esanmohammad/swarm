import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import type { SystemGraphData } from '../types.js';

// ── Internal types ──────────────────────────────────────────────────────────

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

interface RepoInfo {
  label: string;
  path: string;
  packageJson: PackageJson | null;
  hasDockerfile: boolean;
  apiSpecs: string[];
  sharedTypes: string[];
}

interface ServiceNode {
  name: string;
  repo: string;
  type: string;
  apis: Array<{ path: string; method: string; description: string }>;
  dependencies: string[];
  healthStatus: 'healthy' | 'degraded' | 'unknown';
}

interface Contract {
  provider: string;
  consumer: string;
  type: string;
  version: string;
  status: 'compatible' | 'breaking' | 'unknown';
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function resolveRepos(swarmDir: string, reposOpt?: string): Record<string, string> {
  const config = loadConfig();
  let repos: Record<string, string> = config.repos ?? {};

  if (reposOpt) {
    const paths = reposOpt.split(',').map(p => p.trim());
    repos = {};
    for (const p of paths) {
      repos[basename(p)] = p;
    }
  }

  if (Object.keys(repos).length === 0) {
    console.error(chalk.red('No repos configured.'));
    console.log(chalk.dim('Add repos to .swarm/config.yaml:'));
    console.log(chalk.dim(`
repos:
  api: /path/to/api-repo
  web: /path/to/web-repo
  shared: /path/to/shared-lib
`));
    process.exit(1);
  }

  return repos;
}

function scanRepo(label: string, repoPath: string): RepoInfo {
  const info: RepoInfo = {
    label,
    path: repoPath,
    packageJson: null,
    hasDockerfile: false,
    apiSpecs: [],
    sharedTypes: [],
  };

  // Read package.json
  const pkgPath = join(repoPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      info.packageJson = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch { /* skip malformed */ }
  }

  // Check for Dockerfile
  info.hasDockerfile = existsSync(join(repoPath, 'Dockerfile')) || existsSync(join(repoPath, 'docker-compose.yml'));

  // Scan for API specs
  const apiFiles = ['openapi.yaml', 'openapi.yml', 'openapi.json', 'swagger.yaml', 'swagger.json', 'api.yaml'];
  for (const f of apiFiles) {
    if (existsSync(join(repoPath, f))) {
      info.apiSpecs.push(f);
    }
    // Also check docs/ and api/ subdirs
    for (const dir of ['docs', 'api', 'spec']) {
      if (existsSync(join(repoPath, dir, f))) {
        info.apiSpecs.push(join(dir, f));
      }
    }
  }

  // Look for shared type packages (e.g., @org/types, *-types, *-shared)
  const allDeps = {
    ...info.packageJson?.dependencies,
    ...info.packageJson?.devDependencies,
    ...info.packageJson?.peerDependencies,
  };
  for (const dep of Object.keys(allDeps)) {
    if (dep.includes('types') || dep.includes('shared') || dep.includes('contracts') || dep.includes('common')) {
      info.sharedTypes.push(dep);
    }
  }

  return info;
}

function detectServiceType(info: RepoInfo): string {
  const pkg = info.packageJson;
  if (!pkg) return 'unknown';

  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts = pkg.scripts ?? {};
  const hasScript = (key: string) => key in scripts;

  if (allDeps['next'] || allDeps['nuxt'] || allDeps['@angular/core']) return 'frontend-app';
  if (allDeps['react'] && !allDeps['next']) return 'frontend-lib';
  if (allDeps['express'] || allDeps['fastify'] || allDeps['koa'] || allDeps['hapi']) return 'api-service';
  if (allDeps['@grpc/grpc-js'] || allDeps['grpc']) return 'grpc-service';
  if (allDeps['graphql'] || allDeps['apollo-server']) return 'graphql-service';
  if (allDeps['aws-cdk'] || allDeps['pulumi'] || allDeps['terraform']) return 'infrastructure';
  if (info.hasDockerfile && hasScript('start')) return 'microservice';
  if (hasScript('build') && !hasScript('start')) return 'library';

  return 'service';
}

function buildGraph(repos: Record<string, string>): { services: ServiceNode[]; contracts: Contract[] } {
  const repoInfos: RepoInfo[] = [];
  for (const [label, path] of Object.entries(repos)) {
    if (!existsSync(path)) {
      console.warn(chalk.yellow(`  Skipping ${label}: path not found (${path})`));
      continue;
    }
    repoInfos.push(scanRepo(label, path));
  }

  // Map package names to repo labels
  const pkgNameToLabel = new Map<string, string>();
  for (const info of repoInfos) {
    if (info.packageJson?.name) {
      pkgNameToLabel.set(info.packageJson.name, info.label);
    }
  }

  const services: ServiceNode[] = [];
  const contracts: Contract[] = [];

  for (const info of repoInfos) {
    const allDeps = {
      ...info.packageJson?.dependencies,
      ...info.packageJson?.devDependencies,
    };

    // Find cross-repo dependencies
    const crossRepoDeps: string[] = [];
    for (const dep of Object.keys(allDeps)) {
      const targetLabel = pkgNameToLabel.get(dep);
      if (targetLabel && targetLabel !== info.label) {
        crossRepoDeps.push(targetLabel);
      }
    }

    // Parse API specs for routes (simple heuristic)
    const apis: Array<{ path: string; method: string; description: string }> = [];
    for (const specFile of info.apiSpecs) {
      const specPath = join(info.path, specFile);
      try {
        const content = readFileSync(specPath, 'utf-8');
        // Simple extraction for YAML/JSON openapi specs
        const pathMatches = content.matchAll(/^\s+(\/[^:\s]+):/gm);
        for (const m of pathMatches) {
          const routePath = m[1];
          const methodMatch = content.substring(content.indexOf(routePath)).match(/^\s+(get|post|put|patch|delete):/m);
          apis.push({
            path: routePath,
            method: methodMatch?.[1]?.toUpperCase() ?? 'GET',
            description: `Defined in ${specFile}`,
          });
        }
      } catch { /* skip unreadable */ }
    }

    services.push({
      name: info.packageJson?.name ?? info.label,
      repo: info.label,
      type: detectServiceType(info),
      apis,
      dependencies: crossRepoDeps,
      healthStatus: 'unknown',
    });

    // Build contracts from shared types
    for (const sharedPkg of info.sharedTypes) {
      const providerLabel = pkgNameToLabel.get(sharedPkg);
      if (providerLabel) {
        contracts.push({
          provider: providerLabel,
          consumer: info.label,
          type: 'shared-types',
          version: allDeps[sharedPkg] ?? 'unknown',
          status: 'unknown',
        });
      }
    }
  }

  return { services, contracts };
}

function persistGraph(swarmDir: string, data: SystemGraphData): void {
  const systemDir = join(swarmDir, 'system');
  if (!existsSync(systemDir)) {
    mkdirSync(systemDir, { recursive: true });
  }
  writeFileSync(join(systemDir, 'graph.json'), JSON.stringify(data, null, 2));
}

function loadGraph(swarmDir: string): SystemGraphData | null {
  const graphPath = join(swarmDir, 'system', 'graph.json');
  if (!existsSync(graphPath)) return null;
  try {
    return JSON.parse(readFileSync(graphPath, 'utf-8'));
  } catch {
    return null;
  }
}

function topologicalSort(services: ServiceNode[]): ServiceNode[] {
  const visited = new Set<string>();
  const sorted: ServiceNode[] = [];
  const nameToService = new Map(services.map(s => [s.repo, s]));

  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const svc = nameToService.get(name);
    if (!svc) return;
    for (const dep of svc.dependencies) {
      visit(dep);
    }
    sorted.push(svc);
  }

  for (const svc of services) {
    visit(svc.repo);
  }

  return sorted;
}

// ── Subcommand handlers ─────────────────────────────────────────────────────

async function handleMap(swarmDir: string, repos: Record<string, string>): Promise<void> {
  console.log(chalk.bold('\nScanning repos for system dependency graph...\n'));

  const { services, contracts } = buildGraph(repos);
  const graphData: SystemGraphData = { services, contracts, crossRepoPrs: [] };
  persistGraph(swarmDir, graphData);

  // Display service graph
  console.log(chalk.bold.cyan('Services:'));
  for (const svc of services) {
    const typeTag = chalk.dim(`[${svc.type}]`);
    console.log(`  ${chalk.green(svc.repo)} ${typeTag} ${chalk.dim(svc.name)}`);
    if (svc.apis.length > 0) {
      console.log(`    ${chalk.dim('APIs:')} ${svc.apis.map(a => `${a.method} ${a.path}`).join(', ')}`);
    }
  }

  // Display dependency arrows
  console.log(chalk.bold.cyan('\nDependencies:'));
  let hasDeps = false;
  for (const svc of services) {
    for (const dep of svc.dependencies) {
      console.log(`  ${chalk.white(svc.repo)} ${chalk.yellow('->')} ${chalk.white(dep)}`);
      hasDeps = true;
    }
  }
  if (!hasDeps) {
    console.log(chalk.dim('  No cross-repo dependencies detected.'));
  }

  // Display contracts
  if (contracts.length > 0) {
    console.log(chalk.bold.cyan('\nContracts:'));
    for (const c of contracts) {
      const statusColor = c.status === 'compatible' ? chalk.green : c.status === 'breaking' ? chalk.red : chalk.yellow;
      console.log(`  ${chalk.white(c.consumer)} ${chalk.dim('<-')} ${chalk.white(c.provider)} ${chalk.dim(`(${c.type})`)} ${statusColor(c.status)}`);
    }
  }

  console.log(chalk.dim(`\nGraph saved to .swarm/system/graph.json (${services.length} services, ${contracts.length} contracts)`));
}

async function handleCheck(swarmDir: string, repos: Record<string, string>): Promise<void> {
  console.log(chalk.bold('\nValidating cross-repo contract compatibility...\n'));

  const { services, contracts } = buildGraph(repos);
  let issues = 0;

  // Check 1: Shared type version consistency
  console.log(chalk.bold.cyan('1. Shared Type Versions'));
  const typeVersions = new Map<string, Array<{ consumer: string; version: string }>>();
  for (const c of contracts) {
    if (c.type === 'shared-types') {
      const key = c.provider;
      if (!typeVersions.has(key)) typeVersions.set(key, []);
      typeVersions.get(key)!.push({ consumer: c.consumer, version: c.version });
    }
  }

  for (const [provider, consumers] of typeVersions) {
    const versions = new Set(consumers.map(c => c.version));
    if (versions.size > 1) {
      console.log(chalk.red(`  MISMATCH: ${provider} has different versions across consumers:`));
      for (const c of consumers) {
        console.log(chalk.red(`    ${c.consumer}: ${c.version}`));
      }
      issues++;
    } else {
      console.log(chalk.green(`  OK: ${provider} (${[...versions][0]}) — consistent across ${consumers.length} consumer(s)`));
    }
  }
  if (typeVersions.size === 0) {
    console.log(chalk.dim('  No shared type packages detected.'));
  }

  // Check 2: API spec presence
  console.log(chalk.bold.cyan('\n2. API Spec Coverage'));
  for (const svc of services) {
    if (['api-service', 'grpc-service', 'graphql-service', 'microservice'].includes(svc.type)) {
      if (svc.apis.length === 0) {
        console.log(chalk.yellow(`  WARN: ${svc.repo} is type "${svc.type}" but has no API spec file`));
        issues++;
      } else {
        console.log(chalk.green(`  OK: ${svc.repo} — ${svc.apis.length} endpoint(s) documented`));
      }
    }
  }

  // Check 3: Circular dependencies
  console.log(chalk.bold.cyan('\n3. Circular Dependency Check'));
  const depMap = new Map(services.map(s => [s.repo, new Set(s.dependencies)]));
  let cycles = 0;
  for (const svc of services) {
    for (const dep of svc.dependencies) {
      const depDeps = depMap.get(dep);
      if (depDeps && depDeps.has(svc.repo)) {
        console.log(chalk.red(`  CYCLE: ${svc.repo} <-> ${dep}`));
        cycles++;
        issues++;
      }
    }
  }
  if (cycles === 0) {
    console.log(chalk.green('  OK: No circular dependencies.'));
  }

  // Check 4: Missing dependency repos
  console.log(chalk.bold.cyan('\n4. Missing Dependencies'));
  const allLabels = new Set(services.map(s => s.repo));
  for (const svc of services) {
    for (const dep of svc.dependencies) {
      if (!allLabels.has(dep)) {
        console.log(chalk.yellow(`  WARN: ${svc.repo} depends on "${dep}" which is not in configured repos`));
        issues++;
      }
    }
  }
  if (issues === 0) {
    console.log(chalk.green('  OK: All dependencies accounted for.'));
  }

  // Summary
  console.log('');
  if (issues === 0) {
    console.log(chalk.green.bold('All checks passed.'));
  } else {
    console.log(chalk.yellow.bold(`Found ${issues} issue(s) across repos.`));
  }

  // Persist updated graph
  const graphData: SystemGraphData = { services, contracts, crossRepoPrs: [] };
  persistGraph(swarmDir, graphData);
}

async function handleFeature(swarmDir: string, repos: Record<string, string>, feature: string): Promise<void> {
  console.log(chalk.bold(`\nAnalyzing cross-repo impact for: "${feature}"\n`));

  const { services, contracts } = buildGraph(repos);
  const featureLower = feature.toLowerCase();
  const featureWords = featureLower.split(/\s+/);

  // Heuristic: match feature description against repo names, types, dependencies, and API paths
  const impactScores = new Map<string, { score: number; reasons: string[] }>();

  for (const svc of services) {
    const reasons: string[] = [];
    let score = 0;

    // Check if repo name / service name matches feature keywords
    for (const word of featureWords) {
      if (word.length < 3) continue;
      if (svc.repo.toLowerCase().includes(word) || svc.name.toLowerCase().includes(word)) {
        score += 3;
        reasons.push(`Name matches keyword "${word}"`);
      }
    }

    // Check if service type aligns with feature keywords
    const typeKeywords: Record<string, string[]> = {
      'frontend-app': ['ui', 'page', 'screen', 'button', 'form', 'display', 'view', 'dashboard', 'widget'],
      'frontend-lib': ['component', 'ui', 'style', 'theme'],
      'api-service': ['api', 'endpoint', 'route', 'auth', 'data', 'crud', 'rest'],
      'graphql-service': ['query', 'mutation', 'schema', 'graphql'],
      'grpc-service': ['rpc', 'proto', 'grpc', 'service'],
      'library': ['util', 'helper', 'shared', 'common', 'types'],
      'infrastructure': ['deploy', 'infra', 'cloud', 'scale', 'monitor'],
    };

    for (const word of featureWords) {
      const keywords = typeKeywords[svc.type] ?? [];
      if (keywords.includes(word)) {
        score += 2;
        reasons.push(`Service type "${svc.type}" matches keyword "${word}"`);
      }
    }

    // API endpoints that match
    for (const api of svc.apis) {
      for (const word of featureWords) {
        if (word.length < 3) continue;
        if (api.path.toLowerCase().includes(word)) {
          score += 2;
          reasons.push(`API ${api.method} ${api.path} matches "${word}"`);
        }
      }
    }

    // Services with many dependents are likely impacted by cross-cutting features
    const dependents = services.filter(s => s.dependencies.includes(svc.repo));
    if (dependents.length > 0 && featureWords.some(w => ['shared', 'common', 'types', 'contract', 'schema'].includes(w))) {
      score += dependents.length;
      reasons.push(`${dependents.length} service(s) depend on this repo`);
    }

    if (score > 0) {
      impactScores.set(svc.repo, { score, reasons });
    }
  }

  // Sort by impact score descending
  const sorted = [...impactScores.entries()].sort((a, b) => b[1].score - a[1].score);

  if (sorted.length === 0) {
    // If no heuristic matches, show all repos as potentially affected
    console.log(chalk.yellow('Could not narrow down affected repos from feature description.'));
    console.log(chalk.dim('All configured repos may need changes:\n'));
    for (const svc of services) {
      console.log(`  ${chalk.white(svc.repo)} ${chalk.dim(`[${svc.type}]`)} — ${svc.name}`);
    }
  } else {
    console.log(chalk.bold.cyan('Affected repos (by estimated impact):'));
    for (const [repo, { score, reasons }] of sorted) {
      const bar = chalk.green('|'.repeat(Math.min(score, 10)));
      console.log(`\n  ${bar} ${chalk.bold.white(repo)} ${chalk.dim(`(score: ${score})`)}`);
      for (const reason of reasons) {
        console.log(`    ${chalk.dim('-')} ${reason}`);
      }
    }
  }

  // Suggest dependency order
  console.log(chalk.bold.cyan('\nRecommended implementation order:'));
  const topoSorted = topologicalSort(services);
  const affectedSet = new Set(sorted.map(([repo]) => repo));
  const orderedAffected = topoSorted.filter(s => affectedSet.size === 0 || affectedSet.has(s.repo));

  orderedAffected.forEach((svc, i) => {
    const marker = affectedSet.has(svc.repo) ? chalk.green('*') : chalk.dim('-');
    console.log(`  ${i + 1}. ${marker} ${chalk.white(svc.repo)} ${chalk.dim(`[${svc.type}]`)}`);
  });

  console.log(chalk.dim('\n* = directly affected by feature'));
}

async function handleMigrate(swarmDir: string, repos: Record<string, string>, description: string): Promise<void> {
  console.log(chalk.bold(`\nPlanning coordinated migration: "${description}"\n`));

  const { services } = buildGraph(repos);
  const topoSorted = topologicalSort(services);

  // Classify migration type from description
  const descLower = description.toLowerCase();
  let migrationType = 'general';
  if (descLower.includes('typescript') || descLower.includes('language')) migrationType = 'language';
  else if (descLower.includes('version') || descLower.includes('upgrade') || descLower.includes('update')) migrationType = 'dependency-upgrade';
  else if (descLower.includes('api') || descLower.includes('endpoint') || descLower.includes('contract')) migrationType = 'api-change';
  else if (descLower.includes('database') || descLower.includes('schema') || descLower.includes('migration')) migrationType = 'schema-change';
  else if (descLower.includes('rename') || descLower.includes('restructure') || descLower.includes('refactor')) migrationType = 'restructure';

  console.log(chalk.dim(`Migration type detected: ${migrationType}\n`));

  // Generate migration plan in dependency order
  console.log(chalk.bold.cyan('Migration Plan (dependency order):'));
  console.log(chalk.dim('Repos are ordered so that dependencies are migrated before dependents.\n'));

  for (let i = 0; i < topoSorted.length; i++) {
    const svc = topoSorted[i];
    const phase = i + 1;
    const dependents = services.filter(s => s.dependencies.includes(svc.repo));
    const depNames = svc.dependencies.length > 0 ? chalk.dim(` (depends on: ${svc.dependencies.join(', ')})`) : '';

    console.log(chalk.bold(`  Phase ${phase}: ${chalk.white(svc.repo)}`) + depNames);

    // Migration-type-specific guidance
    switch (migrationType) {
      case 'dependency-upgrade':
        console.log(chalk.dim('    - Update package versions'));
        console.log(chalk.dim('    - Run tests to verify compatibility'));
        if (dependents.length > 0) {
          console.log(chalk.dim(`    - Publish updated package before migrating: ${dependents.map(d => d.repo).join(', ')}`));
        }
        break;
      case 'api-change':
        if (svc.apis.length > 0) {
          console.log(chalk.dim(`    - Update ${svc.apis.length} API endpoint(s)`));
          console.log(chalk.dim('    - Deploy with backward compatibility (versioned endpoints)'));
        }
        if (dependents.length > 0) {
          console.log(chalk.dim(`    - Update API clients in: ${dependents.map(d => d.repo).join(', ')}`));
        }
        break;
      case 'schema-change':
        console.log(chalk.dim('    - Create migration scripts'));
        console.log(chalk.dim('    - Test with production data snapshot'));
        if (dependents.length > 0) {
          console.log(chalk.dim(`    - Coordinate downtime or rolling update with: ${dependents.map(d => d.repo).join(', ')}`));
        }
        break;
      case 'restructure':
        console.log(chalk.dim('    - Update import paths and references'));
        console.log(chalk.dim('    - Verify no broken references'));
        break;
      default:
        console.log(chalk.dim(`    - Apply migration: ${description}`));
        console.log(chalk.dim('    - Verify tests pass'));
        break;
    }

    if (svc.dependencies.length > 0) {
      console.log(chalk.dim(`    - Prerequisite: phases for ${svc.dependencies.join(', ')} must complete first`));
    }
    console.log('');
  }

  // Persist migration plan
  const planPath = join(swarmDir, 'system');
  if (!existsSync(planPath)) {
    mkdirSync(planPath, { recursive: true });
  }
  const plan = {
    description,
    migrationType,
    createdAt: Date.now(),
    phases: topoSorted.map((svc, i) => ({
      phase: i + 1,
      repo: svc.repo,
      type: svc.type,
      dependencies: svc.dependencies,
      status: 'pending',
    })),
  };
  writeFileSync(join(planPath, 'migration-plan.json'), JSON.stringify(plan, null, 2));

  console.log(chalk.dim(`Migration plan saved to .swarm/system/migration-plan.json`));
  console.log(chalk.bold.cyan(`\nTotal phases: ${topoSorted.length}`));
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerSystem(program: Command): void {
  const cmd = program
    .command('system')
    .description('Cross-repository system orchestration — map, check, plan, and migrate across repos');

  cmd
    .command('map')
    .description('Display system dependency graph across configured repos')
    .option('--repos <paths>', 'Comma-separated repo paths (overrides config.repos)')
    .action(async (opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }
      const repos = resolveRepos(swarmDir, opts.repos);
      await handleMap(swarmDir, repos);
    });

  cmd
    .command('check')
    .description('Validate cross-repo contract compatibility')
    .option('--repos <paths>', 'Comma-separated repo paths (overrides config.repos)')
    .action(async (opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }
      const repos = resolveRepos(swarmDir, opts.repos);
      await handleCheck(swarmDir, repos);
    });

  cmd
    .command('feature <description>')
    .description('Analyze which repos need changes for a cross-repo feature')
    .option('--repos <paths>', 'Comma-separated repo paths (overrides config.repos)')
    .action(async (description: string, opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }
      const repos = resolveRepos(swarmDir, opts.repos);
      await handleFeature(swarmDir, repos, description);
    });

  cmd
    .command('migrate <description>')
    .description('Plan coordinated migration across repos in dependency order')
    .option('--repos <paths>', 'Comma-separated repo paths (overrides config.repos)')
    .action(async (description: string, opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }
      const repos = resolveRepos(swarmDir, opts.repos);
      await handleMigrate(swarmDir, repos, description);
    });
}
