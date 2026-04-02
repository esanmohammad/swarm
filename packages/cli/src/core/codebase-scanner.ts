import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Scan a project directory and return a concise context string for LLM prompts. */
export function scanCodebase(cwd: string, packages?: string[]): string {
  const sections: string[] = [];

  // 1. Package info
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const deps = Object.keys(pkg.dependencies ?? {}).slice(0, 20);
      const devDeps = Object.keys(pkg.devDependencies ?? {}).slice(0, 10);
      sections.push(`**Package:** ${pkg.name || 'unnamed'}`);
      if (deps.length > 0) sections.push(`**Dependencies:** ${deps.join(', ')}`);
      if (devDeps.length > 0) sections.push(`**Dev deps:** ${devDeps.join(', ')}`);
      if (pkg.scripts) {
        const scripts = Object.keys(pkg.scripts).slice(0, 10);
        sections.push(`**Scripts:** ${scripts.join(', ')}`);
      }
    } catch { /* ignore */ }
  }

  // Go module
  const goModPath = join(cwd, 'go.mod');
  if (existsSync(goModPath)) {
    try {
      const goMod = readFileSync(goModPath, 'utf-8');
      const moduleLine = goMod.split('\n').find(l => l.startsWith('module '));
      if (moduleLine) sections.push(`**Go module:** ${moduleLine.replace('module ', '')}`);
    } catch { /* ignore */ }
  }

  // Python
  const reqPath = join(cwd, 'requirements.txt');
  const pyprojectPath = join(cwd, 'pyproject.toml');
  if (existsSync(reqPath)) {
    try {
      const reqs = readFileSync(reqPath, 'utf-8').split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 15);
      sections.push(`**Python deps:** ${reqs.join(', ')}`);
    } catch { /* ignore */ }
  } else if (existsSync(pyprojectPath)) {
    sections.push(`**Python project:** pyproject.toml present`);
  }

  // 2. File tree (top-level + one level deep for src/)
  try {
    const tree = buildFileTree(cwd, 2);
    if (tree) sections.push(`**File structure:**\n${tree}`);
  } catch { /* ignore */ }

  // 3. Existing test files
  try {
    const testFiles = findFiles(cwd, /\.(test|spec)\.(ts|tsx|js|jsx)$|_test\.go$|test_.*\.py$/, 3);
    if (testFiles.length > 0) {
      sections.push(`**Existing tests:** ${testFiles.slice(0, 10).join(', ')}${testFiles.length > 10 ? ` (+${testFiles.length - 10} more)` : ''}`);
    }
  } catch { /* ignore */ }

  // 4. Git info
  try {
    const branch = execSync('git branch --show-current', { encoding: 'utf-8', cwd }).trim();
    const recentCommits = execSync('git log --oneline -5', { encoding: 'utf-8', cwd }).trim();
    sections.push(`**Branch:** ${branch}`);
    sections.push(`**Recent commits:**\n${recentCommits}`);
  } catch { /* not a git repo */ }

  // 5. Monorepo package info
  if (packages && packages.length > 0) {
    sections.push(`**Monorepo packages:** ${packages.join(', ')}`);
    sections.push('Only modify code within these packages. Respect package boundaries.');
    for (const pkg of packages.slice(0, 5)) {
      const pkgDir = join(cwd, pkg);
      const pkgJsonPath = join(pkgDir, 'package.json');
      if (existsSync(pkgJsonPath)) {
        try {
          const p = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
          const deps = Object.keys(p.dependencies ?? {}).slice(0, 8);
          sections.push(`  ${pkg}: ${p.name || pkg} — deps: ${deps.join(', ') || 'none'}`);
        } catch { /* ignore */ }
      }
    }
  }

  if (sections.length === 0) return '';

  return [
    '## Existing Codebase Context',
    '',
    'This is an EXISTING project. Do NOT start from scratch. Extend the current codebase.',
    '',
    ...sections,
  ].join('\n');
}

/** Build a file tree string up to maxDepth levels. */
function buildFileTree(dir: string, maxDepth: number, prefix = '', depth = 0): string {
  if (depth >= maxDepth) return '';

  const IGNORE = new Set([
    'node_modules', '.git', 'dist', 'build', '.swarm', '.next',
    '__pycache__', '.venv', 'venv', 'target', '.build', '.swiftpm',
    'coverage', '.nyc_output', '.cache',
  ]);

  let entries: string[];
  try {
    entries = readdirSync(dir).filter(e => !IGNORE.has(e) && !e.startsWith('.'));
  } catch {
    return '';
  }

  // Sort: dirs first, then files
  entries.sort((a, b) => {
    const aIsDir = safeIsDir(join(dir, a));
    const bIsDir = safeIsDir(join(dir, b));
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a.localeCompare(b);
  });

  // Limit entries to avoid huge trees
  const maxEntries = 25;
  const truncated = entries.length > maxEntries;
  const shown = entries.slice(0, maxEntries);

  const lines: string[] = [];
  for (const entry of shown) {
    const fullPath = join(dir, entry);
    const isDir = safeIsDir(fullPath);
    lines.push(`${prefix}${isDir ? '📁' : '📄'} ${entry}`);
    if (isDir && depth < maxDepth - 1) {
      const sub = buildFileTree(fullPath, maxDepth, prefix + '  ', depth + 1);
      if (sub) lines.push(sub);
    }
  }
  if (truncated) lines.push(`${prefix}... (+${entries.length - maxEntries} more)`);

  return lines.join('\n');
}

function safeIsDir(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

/** Find files matching a regex pattern, up to maxDepth levels. */
function findFiles(dir: string, pattern: RegExp, maxDepth: number, depth = 0): string[] {
  if (depth >= maxDepth) return [];

  const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.swarm', '__pycache__', '.venv', 'target']);
  const results: string[] = [];

  let entries: string[];
  try { entries = readdirSync(dir); } catch { return []; }

  for (const entry of entries) {
    if (IGNORE.has(entry)) continue;
    const fullPath = join(dir, entry);
    if (safeIsDir(fullPath)) {
      results.push(...findFiles(fullPath, pattern, maxDepth, depth + 1));
    } else if (pattern.test(entry)) {
      results.push(relative(dir, fullPath));
    }
  }

  return results;
}
