import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { SwarmConfig } from '../types.js';
import { DEFAULT_CONFIG } from '../types.js';

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
