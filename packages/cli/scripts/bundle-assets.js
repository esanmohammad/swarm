#!/usr/bin/env node

/**
 * Copies bundled assets (prompts + dashboard) into dist/ for npm publishing.
 * This ensures the published package is self-contained and doesn't depend
 * on the monorepo directory structure.
 *
 * Layout after bundling:
 *   dist/
 *     bin/          (compiled CLI entry point)
 *     src/          (compiled TypeScript)
 *     prompts/      (persona system prompts)
 *     dashboard/    (pre-built React dashboard)
 */

import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, '..');
const repoRoot = join(cliRoot, '..', '..');
const distDir = join(cliRoot, 'dist');

// Ensure dist exists (tsc should have created it)
if (!existsSync(distDir)) {
  console.error('dist/ not found — run `npm run build` first');
  process.exit(1);
}

// 1. Copy prompts/ → dist/prompts/
const promptsSrc = join(repoRoot, 'prompts');
const promptsDest = join(distDir, 'prompts');

if (existsSync(promptsSrc)) {
  mkdirSync(promptsDest, { recursive: true });
  cpSync(promptsSrc, promptsDest, { recursive: true });
  console.log(`Bundled prompts/ → dist/prompts/ (${readdirCount(promptsSrc)} files)`);
} else {
  console.warn('Warning: prompts/ directory not found at repo root');
}

// 2. Copy dashboard dist/ → dist/dashboard/
const dashboardSrc = join(repoRoot, 'packages', 'dashboard', 'dist');
const dashboardDest = join(distDir, 'dashboard');

if (existsSync(dashboardSrc)) {
  mkdirSync(dashboardDest, { recursive: true });
  cpSync(dashboardSrc, dashboardDest, { recursive: true });
  console.log(`Bundled dashboard/dist/ → dist/dashboard/`);
} else {
  console.warn('Warning: dashboard not built — run `npm run build:dashboard` first');
}

// 3. Copy LICENSE and README to package root (for npm)
for (const file of ['LICENSE', 'README.md']) {
  const src = join(repoRoot, file);
  const dest = join(cliRoot, file);
  if (existsSync(src)) {
    cpSync(src, dest);
    console.log(`Copied ${file} to package root`);
  }
}

function readdirCount(dir) {
  try {
    return readdirSync(dir).length;
  } catch {
    return '?';
  }
}
