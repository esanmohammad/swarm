import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import type { SwarmConfig, TechStack } from '../types.js';
import { DEFAULT_CONFIG, createEmptyPipeline } from '../types.js';

export function findSwarmDir(cwd: string = process.cwd()): string {
  return join(cwd, '.swarm');
}

export function loadConfig(cwd: string = process.cwd()): SwarmConfig {
  const configPath = join(findSwarmDir(cwd), 'config.yaml');

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = parseYaml(raw) as Partial<SwarmConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function requireSwarmDir(cwd: string = process.cwd()): string {
  const dir = findSwarmDir(cwd);
  if (!existsSync(dir)) {
    throw new Error('No .swarm/ directory found. Run `swarm init` first.');
  }
  return dir;
}

/** Derive a deterministic port from a project name so different projects don't collide. */
function derivePort(projectName: string, offset: number): number {
  const hash = createHash('md5').update(projectName).digest();
  const raw = hash.readUInt16BE(offset % (hash.length - 1));
  return 10000 + (raw % 50000);
}

/** Auto-detect tech stack from files in the current working directory. */
export function autoDetectStack(cwd: string = process.cwd()): TechStack {
  // Check for Go
  if (existsSync(join(cwd, 'go.mod'))) {
    return 'go';
  }

  // Check for package.json with react/next deps
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps['react'] || allDeps['next'] || allDeps['react-dom']) {
        return 'react';
      }
    } catch {
      // Ignore parse errors, fall through
    }
    return 'node';
  }

  // Default
  return 'react';
}

/** Create .swarm/ directory and config.yaml automatically. Returns the swarm dir path. */
export function autoInit(projectName: string, stack: TechStack, cwd: string = process.cwd()): string {
  const swarmDir = join(cwd, '.swarm');

  const wsPort = derivePort(projectName, 0);
  let dashboardPort = derivePort(projectName, 2);
  if (dashboardPort === wsPort) dashboardPort = wsPort + 1;

  const config: SwarmConfig = {
    ...DEFAULT_CONFIG,
    projectName,
    stack,
    model: 'sonnet',
    maxBudgetUsd: 5,
    wsPort,
    dashboardPort,
  };

  // Create directories
  mkdirSync(swarmDir, { recursive: true });
  mkdirSync(join(swarmDir, 'logs'), { recursive: true });

  // Write config
  writeFileSync(join(swarmDir, 'config.yaml'), toYaml(config));

  // Write default guardrails
  const defaultGuardrails = {
    rules: [
      {
        name: 'Custom: example rule',
        target: 'REQUIREMENTS.md',
        checks: [
          {
            type: 'section-exists',
            value: 'Summary',
            message: 'REQUIREMENTS.md should have a Summary section',
            severity: 'warning',
          },
        ],
      },
    ],
  };
  writeFileSync(join(swarmDir, 'guardrails.yaml'), toYaml(defaultGuardrails));

  // Write initial state
  const state = createEmptyPipeline(projectName, stack);
  writeFileSync(join(swarmDir, 'state.json'), JSON.stringify(state, null, 2));

  // Write .gitignore for state
  writeFileSync(join(swarmDir, '.gitignore'), 'state.json\nlogs/\n');

  return swarmDir;
}
