import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function createTempSwarmDir(): { dir: string; swarmDir: string; cleanup: () => void } {
  const dir = join('/tmp', `swarm-test-${randomUUID()}`);
  const swarmDir = join(dir, '.swarm');
  mkdirSync(swarmDir, { recursive: true });
  mkdirSync(join(swarmDir, 'logs'), { recursive: true });
  return {
    dir,
    swarmDir,
    cleanup: () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} },
  };
}

export function writeArtifact(dir: string, name: string, content: string): void {
  writeFileSync(join(dir, name), content);
}

export function writeConfig(swarmDir: string, config: Record<string, unknown> = {}): void {
  const defaults = { stack: 'node', model: 'opus', budget: null, testFramework: 'vitest', ...config };
  writeFileSync(join(swarmDir, 'config.yaml'), Object.entries(defaults).map(([k, v]) => `${k}: ${v}`).join('\n'));
}
