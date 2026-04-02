import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execSync } from 'node:child_process';

export interface FileNode {
  path: string;
  imports: string[];
  exports: string[];
  size: number;
  complexity: number;
  churnRate: number;
  lastModified: number;
  testCoverage: boolean;
}

export interface CodebaseIndex {
  files: FileNode[];
  dependencyGraph: Record<string, string[]>;
  symbols: Array<{ name: string; type: 'function' | 'class' | 'type' | 'variable'; file: string; line: number; exported: boolean }>;
  modules: Array<{ path: string; purpose: string; isPublicApi: boolean }>;
  fragileFiles: Array<{ path: string; failureRate: number; reason: string }>;
  coChangePatterns: Array<{ fileA: string; fileB: string; frequency: number }>;
  semantic?: { architecture: string; dataFlows: string[]; invariants: string[]; hazardZones: string[] };
  builtAt: number;
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.swift']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git', '.swarm', 'coverage', '__pycache__', 'target', '.next', '.nuxt', 'build']);

// ─── Helpers ────────────────────────────────────────────────────────────────

function walkDir(dir: string, root: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      results.push(...walkDir(full, root));
    } else if (SOURCE_EXTENSIONS.has(extname(entry))) {
      results.push(relative(root, full));
    }
  }
  return results;
}

function parseImports(content: string, ext: string): string[] {
  const imports: string[] = [];
  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
    // ES import/require
    const importRe = /(?:import\s+.*?from\s+['"](.+?)['"]|require\s*\(\s*['"](.+?)['"]\s*\))/g;
    let m;
    while ((m = importRe.exec(content)) !== null) {
      imports.push(m[1] || m[2]);
    }
  } else if (ext === '.py') {
    const pyRe = /(?:from\s+(\S+)\s+import|import\s+(\S+))/g;
    let m;
    while ((m = pyRe.exec(content)) !== null) {
      imports.push(m[1] || m[2]);
    }
  } else if (ext === '.go') {
    const goRe = /import\s+(?:\(\s*([\s\S]*?)\)|"(.+?)")/g;
    let m;
    while ((m = goRe.exec(content)) !== null) {
      if (m[2]) {
        imports.push(m[2]);
      } else if (m[1]) {
        const inner = m[1].match(/"(.+?)"/g);
        if (inner) inner.forEach(i => imports.push(i.replace(/"/g, '')));
      }
    }
  } else if (ext === '.rs') {
    const rsRe = /use\s+(\S+?);/g;
    let m;
    while ((m = rsRe.exec(content)) !== null) {
      imports.push(m[1]);
    }
  } else if (ext === '.swift') {
    const swRe = /import\s+(\S+)/g;
    let m;
    while ((m = swRe.exec(content)) !== null) {
      imports.push(m[1]);
    }
  }
  return imports;
}

function parseExports(content: string, ext: string): string[] {
  const exports: string[] = [];
  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
    const expRe = /export\s+(?:default\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/g;
    let m;
    while ((m = expRe.exec(content)) !== null) {
      exports.push(m[1]);
    }
  } else if (ext === '.py') {
    // Top-level def/class as "exports"
    const pyRe = /^(?:def|class)\s+(\w+)/gm;
    let m;
    while ((m = pyRe.exec(content)) !== null) {
      if (!m[1].startsWith('_')) exports.push(m[1]);
    }
  } else if (ext === '.go') {
    // Exported = capitalized functions/types
    const goRe = /^(?:func|type)\s+([A-Z]\w*)/gm;
    let m;
    while ((m = goRe.exec(content)) !== null) {
      exports.push(m[1]);
    }
  } else if (ext === '.rs') {
    const rsRe = /pub\s+(?:fn|struct|enum|trait|type|mod)\s+(\w+)/g;
    let m;
    while ((m = rsRe.exec(content)) !== null) {
      exports.push(m[1]);
    }
  } else if (ext === '.swift') {
    const swRe = /(?:public|open)\s+(?:func|class|struct|enum|protocol)\s+(\w+)/g;
    let m;
    while ((m = swRe.exec(content)) !== null) {
      exports.push(m[1]);
    }
  }
  return exports;
}

function extractSymbols(content: string, filePath: string, ext: string): CodebaseIndex['symbols'] {
  const symbols: CodebaseIndex['symbols'] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      const exported = line.trimStart().startsWith('export');
      let m;

      m = line.match(/(?:export\s+)?(?:default\s+)?function\s+(\w+)/);
      if (m) { symbols.push({ name: m[1], type: 'function', file: filePath, line: i + 1, exported }); continue; }

      m = line.match(/(?:export\s+)?(?:default\s+)?class\s+(\w+)/);
      if (m) { symbols.push({ name: m[1], type: 'class', file: filePath, line: i + 1, exported }); continue; }

      m = line.match(/(?:export\s+)?(?:type|interface)\s+(\w+)/);
      if (m) { symbols.push({ name: m[1], type: 'type', file: filePath, line: i + 1, exported }); continue; }

      m = line.match(/(?:export\s+)?(?:const|let|var)\s+(\w+)/);
      if (m) { symbols.push({ name: m[1], type: 'variable', file: filePath, line: i + 1, exported }); continue; }
    } else if (ext === '.py') {
      let m;
      m = line.match(/^def\s+(\w+)/);
      if (m) { symbols.push({ name: m[1], type: 'function', file: filePath, line: i + 1, exported: !m[1].startsWith('_') }); continue; }
      m = line.match(/^class\s+(\w+)/);
      if (m) { symbols.push({ name: m[1], type: 'class', file: filePath, line: i + 1, exported: !m[1].startsWith('_') }); continue; }
    } else if (ext === '.go') {
      let m;
      m = line.match(/^func\s+(\w+)/);
      if (m) { symbols.push({ name: m[1], type: 'function', file: filePath, line: i + 1, exported: /^[A-Z]/.test(m[1]) }); continue; }
      m = line.match(/^type\s+(\w+)/);
      if (m) { symbols.push({ name: m[1], type: 'type', file: filePath, line: i + 1, exported: /^[A-Z]/.test(m[1]) }); continue; }
    } else if (ext === '.rs') {
      const exported = line.trimStart().startsWith('pub');
      let m;
      m = line.match(/(?:pub\s+)?fn\s+(\w+)/);
      if (m) { symbols.push({ name: m[1], type: 'function', file: filePath, line: i + 1, exported }); continue; }
      m = line.match(/(?:pub\s+)?(?:struct|enum)\s+(\w+)/);
      if (m) { symbols.push({ name: m[1], type: 'class', file: filePath, line: i + 1, exported }); continue; }
      m = line.match(/(?:pub\s+)?trait\s+(\w+)/);
      if (m) { symbols.push({ name: m[1], type: 'type', file: filePath, line: i + 1, exported }); continue; }
    } else if (ext === '.swift') {
      const exported = /(?:public|open)\s+/.test(line);
      let m;
      m = line.match(/(?:public\s+|open\s+|private\s+|internal\s+)?func\s+(\w+)/);
      if (m) { symbols.push({ name: m[1], type: 'function', file: filePath, line: i + 1, exported }); continue; }
      m = line.match(/(?:public\s+|open\s+)?(?:class|struct)\s+(\w+)/);
      if (m) { symbols.push({ name: m[1], type: 'class', file: filePath, line: i + 1, exported }); continue; }
      m = line.match(/(?:public\s+|open\s+)?(?:protocol|enum)\s+(\w+)/);
      if (m) { symbols.push({ name: m[1], type: 'type', file: filePath, line: i + 1, exported }); continue; }
    }
  }

  return symbols;
}

function computeComplexity(content: string): number {
  // Simple cyclomatic-ish complexity: count branching keywords
  const keywords = /\b(if|else|for|while|switch|case|catch|&&|\|\||\?)\b/g;
  const matches = content.match(keywords);
  return matches ? matches.length : 0;
}

function getFileChurn(cwd: string, filePath: string): number {
  try {
    const result = execSync(`git log --format='%H' --follow -- "${filePath}" | wc -l`, {
      cwd,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return parseInt(result.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function hasTestCoverage(filePath: string, allFiles: string[]): boolean {
  const base = filePath.replace(/\.[^.]+$/, '');
  const testPatterns = [
    `${base}.test.`,
    `${base}.spec.`,
    `${base}_test.`,
    base.replace(/src\//, 'test/') + '.',
    base.replace(/src\//, '__tests__/') + '.',
  ];
  return allFiles.some(f => testPatterns.some(p => f.startsWith(p)));
}

function inferModulePurpose(dirPath: string, files: string[]): string {
  const dirFiles = files.filter(f => f.startsWith(dirPath + '/') && !f.slice(dirPath.length + 1).includes('/'));
  if (dirFiles.length === 0) return 'empty module';
  const names = dirFiles.map(f => f.split('/').pop()!.replace(/\.[^.]+$/, '')).join(', ');
  if (dirPath.includes('test') || dirPath.includes('spec')) return 'tests';
  if (dirPath.includes('command') || dirPath.includes('cmd')) return 'CLI commands';
  if (dirPath.includes('core') || dirPath.includes('lib')) return 'core library';
  if (dirPath.includes('util') || dirPath.includes('helper')) return 'utilities';
  if (dirPath.includes('component') || dirPath.includes('view')) return 'UI components';
  if (dirPath.includes('api') || dirPath.includes('route')) return 'API layer';
  if (dirPath.includes('model') || dirPath.includes('schema')) return 'data models';
  return `module (${names.slice(0, 60)})`;
}

function buildCoChangePatterns(cwd: string, files: string[]): CodebaseIndex['coChangePatterns'] {
  const pairCounts = new Map<string, number>();
  let commitFiles: string[][];

  try {
    const log = execSync('git log --pretty=format:"---COMMIT---" --name-only -200', {
      cwd,
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const commits = log.split('---COMMIT---').filter(Boolean);
    const fileSet = new Set(files);

    commitFiles = commits.map(c =>
      c.split('\n')
        .map(l => l.trim())
        .filter(l => l && fileSet.has(l))
    );
  } catch {
    return [];
  }

  for (const changed of commitFiles) {
    if (changed.length < 2 || changed.length > 20) continue; // Skip giant commits
    for (let i = 0; i < changed.length; i++) {
      for (let j = i + 1; j < changed.length; j++) {
        const key = [changed[i], changed[j]].sort().join('|||');
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  }

  return Array.from(pairCounts.entries())
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([key, frequency]) => {
      const [fileA, fileB] = key.split('|||');
      return { fileA, fileB, frequency };
    });
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function buildIndex(cwd: string, swarmDir: string): CodebaseIndex {
  const filePaths = walkDir(cwd, cwd);
  const files: FileNode[] = [];
  const dependencyGraph: Record<string, string[]> = {};
  const allSymbols: CodebaseIndex['symbols'] = [];

  for (const relPath of filePaths) {
    const absPath = join(cwd, relPath);
    const ext = extname(relPath);
    let content: string;
    let stat;

    try {
      content = readFileSync(absPath, 'utf8');
      stat = statSync(absPath);
    } catch {
      continue;
    }

    const imports = parseImports(content, ext);
    const exports = parseExports(content, ext);
    const symbols = extractSymbols(content, relPath, ext);
    const complexity = computeComplexity(content);
    const churnRate = getFileChurn(cwd, relPath);

    files.push({
      path: relPath,
      imports,
      exports,
      size: stat.size,
      complexity,
      churnRate,
      lastModified: stat.mtimeMs,
      testCoverage: hasTestCoverage(relPath, filePaths),
    });

    dependencyGraph[relPath] = imports;
    allSymbols.push(...symbols);
  }

  // Discover modules (unique directories)
  const dirSet = new Set<string>();
  for (const f of filePaths) {
    const parts = f.split('/');
    if (parts.length > 1) {
      dirSet.add(parts.slice(0, -1).join('/'));
    }
  }
  const modules = Array.from(dirSet).sort().map(d => ({
    path: d,
    purpose: inferModulePurpose(d, filePaths),
    isPublicApi: d.includes('api') || d.includes('commands') || d.includes('bin'),
  }));

  // Fragile files: high churn + high complexity + no tests
  const fragileFiles: CodebaseIndex['fragileFiles'] = [];
  const avgChurn = files.reduce((s, f) => s + f.churnRate, 0) / Math.max(files.length, 1);
  const avgComplexity = files.reduce((s, f) => s + f.complexity, 0) / Math.max(files.length, 1);

  for (const f of files) {
    const reasons: string[] = [];
    if (f.churnRate > avgChurn * 2) reasons.push('high churn');
    if (f.complexity > avgComplexity * 2) reasons.push('high complexity');
    if (!f.testCoverage) reasons.push('no tests');
    if (reasons.length >= 2) {
      const failureRate = Math.min(1, (f.churnRate / Math.max(avgChurn, 1) * 0.3 + f.complexity / Math.max(avgComplexity, 1) * 0.3 + (f.testCoverage ? 0 : 0.4)));
      fragileFiles.push({
        path: f.path,
        failureRate: Math.round(failureRate * 100) / 100,
        reason: reasons.join(', '),
      });
    }
  }
  fragileFiles.sort((a, b) => b.failureRate - a.failureRate);

  // Co-change patterns
  const coChangePatterns = buildCoChangePatterns(cwd, filePaths);

  const index: CodebaseIndex = {
    files,
    dependencyGraph,
    symbols: allSymbols,
    modules,
    fragileFiles,
    coChangePatterns,
    builtAt: Date.now(),
  };

  // Persist
  const indexDir = join(swarmDir, 'index');
  if (!existsSync(indexDir)) mkdirSync(indexDir, { recursive: true });
  writeFileSync(join(indexDir, 'graph.json'), JSON.stringify(index, null, 2));

  return index;
}

export function loadIndex(swarmDir: string): CodebaseIndex | null {
  const indexPath = join(swarmDir, 'index', 'graph.json');
  if (!existsSync(indexPath)) return null;
  try {
    return JSON.parse(readFileSync(indexPath, 'utf8')) as CodebaseIndex;
  } catch {
    return null;
  }
}

export function queryIndex(index: CodebaseIndex, query: string): string {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results: Array<{ item: string; score: number }> = [];

  // Search file paths
  for (const f of index.files) {
    const lower = f.path.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (lower.includes(t)) score += 2;
    }
    if (score > 0) {
      results.push({
        item: `File: ${f.path} (${f.exports.length} exports, ${f.imports.length} imports, complexity: ${f.complexity})`,
        score,
      });
    }
  }

  // Search symbols
  for (const s of index.symbols) {
    const lower = s.name.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (lower.includes(t)) score += 3;
    }
    if (score > 0) {
      results.push({
        item: `Symbol: ${s.name} (${s.type}${s.exported ? ', exported' : ''}) in ${s.file}:${s.line}`,
        score,
      });
    }
  }

  // Search modules
  for (const m of index.modules) {
    const lower = (m.path + ' ' + m.purpose).toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (lower.includes(t)) score += 1;
    }
    if (score > 0) {
      results.push({
        item: `Module: ${m.path} — ${m.purpose}${m.isPublicApi ? ' (public API)' : ''}`,
        score,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, 20);

  if (top.length === 0) return `No results found for "${query}".`;
  return top.map(r => r.item).join('\n');
}

export function getFragileFiles(index: CodebaseIndex): Array<{ path: string; failureRate: number; reason: string }> {
  return index.fragileFiles;
}

export function getContextForPersona(index: CodebaseIndex, persona: string, taskDescription: string): string {
  const terms = taskDescription.toLowerCase().split(/\s+/).filter(Boolean);
  const lines: string[] = [];

  // Always include module overview
  lines.push('## Codebase Modules');
  for (const m of index.modules.slice(0, 10)) {
    lines.push(`- ${m.path}: ${m.purpose}${m.isPublicApi ? ' (public API)' : ''}`);
  }

  // Find relevant files based on task description
  const relevantFiles = index.files
    .map(f => {
      let score = 0;
      const lower = f.path.toLowerCase();
      for (const t of terms) {
        if (lower.includes(t)) score += 2;
      }
      for (const exp of f.exports) {
        for (const t of terms) {
          if (exp.toLowerCase().includes(t)) score += 1;
        }
      }
      return { file: f, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  if (relevantFiles.length > 0) {
    lines.push('\n## Relevant Files');
    for (const { file: f } of relevantFiles) {
      lines.push(`- ${f.path} (exports: ${f.exports.join(', ') || 'none'}, complexity: ${f.complexity})`);
    }
  }

  // Persona-specific context
  if (persona === 'analyst' || persona === 'architect') {
    lines.push('\n## Architecture');
    lines.push(`Total files: ${index.files.length}, Modules: ${index.modules.length}`);
    if (index.fragileFiles.length > 0) {
      lines.push('\n## Risk Areas');
      for (const f of index.fragileFiles.slice(0, 5)) {
        lines.push(`- ${f.path}: ${f.reason} (risk: ${(f.failureRate * 100).toFixed(0)}%)`);
      }
    }
  }

  if (persona === 'lead' || persona === 'engineer') {
    // Show dependency info for relevant files
    if (relevantFiles.length > 0) {
      lines.push('\n## Dependencies');
      for (const { file: f } of relevantFiles.slice(0, 5)) {
        if (f.imports.length > 0) {
          lines.push(`- ${f.path} imports: ${f.imports.slice(0, 5).join(', ')}`);
        }
      }
    }
  }

  if (persona === 'tester') {
    const untested = index.files.filter(f => !f.testCoverage).slice(0, 10);
    if (untested.length > 0) {
      lines.push('\n## Files Without Tests');
      for (const f of untested) {
        lines.push(`- ${f.path}`);
      }
    }
  }

  // Truncate to ~2000 chars
  let result = lines.join('\n');
  if (result.length > 2000) {
    result = result.slice(0, 1997) + '...';
  }
  return result;
}
