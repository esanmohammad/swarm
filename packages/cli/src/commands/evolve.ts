import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DebtData } from '../types.js';
import { loadConfig, requireSwarmDir } from '../core/config.js';
import { createContext } from './shared.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface DebtItem {
  id: string;
  type: 'code-quality' | 'architecture' | 'dependency' | 'test' | 'documentation';
  severity: number; // 1-5
  file: string;
  description: string;
  estimatedEffort: string;
  autoFixable: boolean;
  age: number; // days since file last modified
}

interface DebtSnapshot {
  scannedAt: number;
  score: number;
  items: DebtItem[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getDebtPath(swarmDir: string): string {
  return join(swarmDir, 'debt.json');
}

function getHistoryPath(swarmDir: string): string {
  return join(swarmDir, 'debt-history.jsonl');
}

function loadDebt(swarmDir: string): DebtSnapshot | null {
  const p = getDebtPath(swarmDir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as DebtSnapshot;
  } catch {
    return null;
  }
}

function saveDebt(swarmDir: string, snapshot: DebtSnapshot): void {
  writeFileSync(getDebtPath(swarmDir), JSON.stringify(snapshot, null, 2));
}

function appendHistory(swarmDir: string, score: number, itemCount: number): void {
  const entry = { date: new Date().toISOString().slice(0, 10), score, items: itemCount, timestamp: Date.now() };
  appendFileSync(getHistoryPath(swarmDir), JSON.stringify(entry) + '\n');
}

function loadHistory(swarmDir: string): Array<{ date: string; score: number; items: number; timestamp: number }> {
  const p = getHistoryPath(swarmDir);
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean);
  return lines.map((l) => JSON.parse(l));
}

/** Age in days since file was last modified. */
function fileDaysOld(filePath: string): number {
  try {
    const stat = statSync(filePath);
    return Math.floor((Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
}

/** Recursively collect files, respecting common ignore dirs. */
function walkDir(dir: string, ignoreDirs: Set<string>): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (ignoreDirs.has(entry)) continue;
    const full = join(dir, entry);
    try {
      const st = statSync(full);
      if (st.isDirectory()) {
        results.push(...walkDir(full, ignoreDirs));
      } else if (st.isFile()) {
        results.push(full);
      }
    } catch {
      // skip unreadable
    }
  }
  return results;
}

// ── Scanners ─────────────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt',
  '.swarm', '__pycache__', '.tox', 'venv', '.venv', 'vendor', 'target',
]);

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.swift', '.java', '.kt']);

function scanCodeQuality(cwd: string, files: string[]): DebtItem[] {
  const items: DebtItem[] = [];
  const sourceFiles = files.filter((f) => SOURCE_EXTS.has(extname(f)));

  for (const file of sourceFiles) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    const rel = relative(cwd, file);
    const age = fileDaysOld(file);

    // 1. Large files (> 300 lines)
    if (lines.length > 300) {
      items.push({
        id: randomUUID().slice(0, 8),
        type: 'code-quality',
        severity: lines.length > 600 ? 4 : 3,
        file: rel,
        description: `File has ${lines.length} lines (threshold: 300). Consider splitting.`,
        estimatedEffort: 'medium',
        autoFixable: false,
        age,
      });
    }

    // 2. Long functions (> 50 lines) — heuristic: function/def/func keyword to closing brace
    const funcPattern = /^[ \t]*(export\s+)?(async\s+)?function\s+\w+|^[ \t]*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(|^[ \t]*def\s+\w+|^[ \t]*func\s+\w+/;
    let funcStart = -1;
    let funcName = '';
    let braceDepth = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (funcPattern.test(line) && funcStart === -1) {
        funcStart = i;
        funcName = (line.match(/(?:function|def|func|const|let|var)\s+(\w+)/) || [])[1] || 'anonymous';
        braceDepth = 0;
      }
      if (funcStart !== -1) {
        braceDepth += (line.match(/\{/g) || []).length;
        braceDepth -= (line.match(/\}/g) || []).length;
        if (braceDepth <= 0 && i > funcStart) {
          const funcLen = i - funcStart + 1;
          if (funcLen > 50) {
            items.push({
              id: randomUUID().slice(0, 8),
              type: 'code-quality',
              severity: funcLen > 100 ? 4 : 3,
              file: rel,
              description: `Function '${funcName}' is ${funcLen} lines (threshold: 50). Consider refactoring.`,
              estimatedEffort: 'medium',
              autoFixable: false,
              age,
            });
          }
          funcStart = -1;
        }
      }
    }

    // 3. TODO/FIXME/HACK comments
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/\b(TODO|FIXME|HACK|XXX)\b/);
      if (match) {
        items.push({
          id: randomUUID().slice(0, 8),
          type: 'code-quality',
          severity: match[1] === 'HACK' ? 3 : 2,
          file: rel,
          description: `${match[1]} comment at line ${i + 1}: ${lines[i].trim().slice(0, 80)}`,
          estimatedEffort: 'small',
          autoFixable: false,
          age,
        });
      }
    }

    // 4. TypeScript `any` types
    if (extname(file) === '.ts' || extname(file) === '.tsx') {
      for (let i = 0; i < lines.length; i++) {
        // Match `: any`, `as any`, `<any>`, but not in comments
        const line = lines[i];
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
        if (/:\s*any\b|as\s+any\b|<any>/.test(line)) {
          items.push({
            id: randomUUID().slice(0, 8),
            type: 'code-quality',
            severity: 2,
            file: rel,
            description: `Untyped 'any' at line ${i + 1}. Add proper types.`,
            estimatedEffort: 'small',
            autoFixable: true,
            age,
          });
        }
      }
    }

    // 5. Deep nesting (indentation > 4 levels)
    let maxNesting = 0;
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      const indent = line.match(/^(\s*)/)?.[1] || '';
      const level = indent.includes('\t') ? indent.split('\t').length - 1 : Math.floor(indent.length / 2);
      if (level > maxNesting) maxNesting = level;
    }
    if (maxNesting > 8) {
      items.push({
        id: randomUUID().slice(0, 8),
        type: 'code-quality',
        severity: 3,
        file: rel,
        description: `Deep nesting detected (${maxNesting} levels). Consider early returns or extraction.`,
        estimatedEffort: 'medium',
        autoFixable: false,
        age,
      });
    }
  }

  return items;
}

function scanDependencyDebt(cwd: string): DebtItem[] {
  const items: DebtItem[] = [];
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return items;

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    return items;
  }

  const allDeps = {
    ...(pkg.dependencies as Record<string, string> || {}),
    ...(pkg.devDependencies as Record<string, string> || {}),
  };

  // Check for deprecated version patterns (e.g., very old pinned versions)
  for (const [name, version] of Object.entries(allDeps)) {
    if (typeof version !== 'string') continue;
    // Flag exact 0.x versions as potentially outdated
    if (/^0\.\d+\.\d+$/.test(version)) {
      items.push({
        id: randomUUID().slice(0, 8),
        type: 'dependency',
        severity: 2,
        file: 'package.json',
        description: `Dependency '${name}@${version}' is pinned to a 0.x version. May be outdated.`,
        estimatedEffort: 'small',
        autoFixable: false,
        age: fileDaysOld(pkgPath),
      });
    }
  }

  // Check for unused dependencies — heuristic: scan source for import references
  const sourceFiles = walkDir(cwd, IGNORE_DIRS).filter((f) => SOURCE_EXTS.has(extname(f)));
  const allSource = sourceFiles.map((f) => {
    try { return readFileSync(f, 'utf-8'); } catch { return ''; }
  }).join('\n');

  const deps = pkg.dependencies as Record<string, string> || {};
  for (const depName of Object.keys(deps)) {
    // Skip @types/ packages and common implicit deps
    if (depName.startsWith('@types/')) continue;
    // Check if dep name appears in any import/require statement
    const escaped = depName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const importPattern = new RegExp(`(?:from\\s+['"]${escaped}|require\\(['"]${escaped}|import\\s+['"]${escaped})`, 'm');
    if (!importPattern.test(allSource)) {
      items.push({
        id: randomUUID().slice(0, 8),
        type: 'dependency',
        severity: 2,
        file: 'package.json',
        description: `Dependency '${depName}' may be unused — no import found in source files.`,
        estimatedEffort: 'small',
        autoFixable: false,
        age: fileDaysOld(pkgPath),
      });
    }
  }

  return items;
}

function scanTestDebt(cwd: string, files: string[]): DebtItem[] {
  const items: DebtItem[] = [];
  const sourceFiles = files.filter((f) => {
    const ext = extname(f);
    if (!SOURCE_EXTS.has(ext)) return false;
    const rel = relative(cwd, f);
    // Exclude test files themselves
    if (/\.(test|spec|_test)\.[^.]+$/.test(rel)) return false;
    if (/\b(test|tests|__tests__|__test__)\b/.test(rel)) return false;
    return true;
  });

  const testFiles = new Set(
    files.filter((f) => /\.(test|spec|_test)\.[^.]+$/.test(f)).map((f) => relative(cwd, f))
  );

  for (const file of sourceFiles) {
    const rel = relative(cwd, file);
    const base = rel.replace(/\.[^.]+$/, '');
    const ext = extname(file);

    // Check common test file naming patterns
    const possibleTests = [
      `${base}.test${ext}`,
      `${base}.spec${ext}`,
      `${base}_test${ext}`,
      rel.replace(/^src\//, 'test/').replace(/\.[^.]+$/, `.test${ext}`),
      rel.replace(/^src\//, '__tests__/').replace(/\.[^.]+$/, `.test${ext}`),
    ];

    const hasTest = possibleTests.some((t) => testFiles.has(t));
    if (!hasTest) {
      items.push({
        id: randomUUID().slice(0, 8),
        type: 'test',
        severity: 2,
        file: rel,
        description: `No test file found for '${rel}'.`,
        estimatedEffort: 'medium',
        autoFixable: false,
        age: fileDaysOld(file),
      });
    }
  }

  return items;
}

function scanDocumentationDebt(cwd: string, files: string[]): DebtItem[] {
  const items: DebtItem[] = [];
  const tsFiles = files.filter((f) => extname(f) === '.ts' || extname(f) === '.tsx');

  for (const file of tsFiles) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    const rel = relative(cwd, file);

    // Check for exported functions/classes without JSDoc
    const exportedPattern = /^export\s+(async\s+)?function\s+(\w+)|^export\s+(class|interface)\s+(\w+)/gm;
    let match: RegExpExecArray | null;
    let undocumentedExports = 0;
    while ((match = exportedPattern.exec(content)) !== null) {
      const pos = match.index;
      // Look for JSDoc in the 3 lines before the export
      const before = content.slice(Math.max(0, pos - 200), pos);
      if (!before.includes('*/')) {
        undocumentedExports++;
      }
    }

    if (undocumentedExports > 0) {
      items.push({
        id: randomUUID().slice(0, 8),
        type: 'documentation',
        severity: 1,
        file: rel,
        description: `${undocumentedExports} exported symbol(s) without JSDoc.`,
        estimatedEffort: 'small',
        autoFixable: true,
        age: fileDaysOld(file),
      });
    }
  }

  // Check for stale README
  const readmePath = join(cwd, 'README.md');
  if (existsSync(readmePath)) {
    const readmeAge = fileDaysOld(readmePath);
    if (readmeAge > 90) {
      items.push({
        id: randomUUID().slice(0, 8),
        type: 'documentation',
        severity: 2,
        file: 'README.md',
        description: `README.md is ${readmeAge} days old. May be stale.`,
        estimatedEffort: 'small',
        autoFixable: false,
        age: readmeAge,
      });
    }
  } else {
    items.push({
      id: randomUUID().slice(0, 8),
      type: 'documentation',
      severity: 3,
      file: 'README.md',
      description: 'No README.md found in project root.',
      estimatedEffort: 'small',
      autoFixable: false,
      age: 0,
    });
  }

  return items;
}

function scanArchitectureDebt(cwd: string, files: string[]): DebtItem[] {
  const items: DebtItem[] = [];
  const sourceFiles = files.filter((f) => SOURCE_EXTS.has(extname(f)));

  // Build import graph
  const importCounts = new Map<string, number>(); // file -> number of times imported by others
  const importMap = new Map<string, Set<string>>(); // file -> set of files it imports

  for (const file of sourceFiles) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    const rel = relative(cwd, file);
    const imports = new Set<string>();

    // Match import/require statements
    const importPattern = /(?:import\s+.*?from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g;
    let m: RegExpExecArray | null;
    while ((m = importPattern.exec(content)) !== null) {
      const importPath = m[1] || m[2];
      if (importPath.startsWith('.')) {
        // Resolve relative import to a normalized path
        const resolved = join(file, '..', importPath).replace(/\.[^.]*$/, '');
        const resolvedRel = relative(cwd, resolved);
        imports.add(resolvedRel);
      }
    }
    importMap.set(rel, imports);
  }

  // Count how many files import each file
  for (const [, imports] of importMap) {
    for (const imp of imports) {
      importCounts.set(imp, (importCounts.get(imp) || 0) + 1);
    }
  }

  // God modules: files imported by many others (> 15 importers)
  for (const [file, count] of importCounts) {
    if (count > 15) {
      items.push({
        id: randomUUID().slice(0, 8),
        type: 'architecture',
        severity: count > 25 ? 4 : 3,
        file,
        description: `God module: imported by ${count} files. Consider splitting responsibilities.`,
        estimatedEffort: 'large',
        autoFixable: false,
        age: 0,
      });
    }
  }

  // Circular imports: detect A -> B -> A cycles
  for (const [fileA, importsA] of importMap) {
    for (const impB of importsA) {
      const importsB = importMap.get(impB) || importMap.get(impB + '.ts') || importMap.get(impB + '.js');
      if (importsB) {
        const normalA = fileA.replace(/\.[^.]*$/, '');
        if (importsB.has(normalA) || importsB.has(fileA)) {
          items.push({
            id: randomUUID().slice(0, 8),
            type: 'architecture',
            severity: 4,
            file: fileA,
            description: `Circular import detected: '${fileA}' <-> '${impB}'.`,
            estimatedEffort: 'large',
            autoFixable: false,
            age: 0,
          });
        }
      }
    }
  }

  return items;
}

/** Calculate aggregate debt score (0 = no debt, 100 = critical). */
function calculateDebtScore(items: DebtItem[]): number {
  if (items.length === 0) return 0;
  const totalSeverity = items.reduce((sum, it) => sum + it.severity, 0);
  // Normalize: score is based on total severity, capped at 100
  const raw = Math.min(100, Math.round((totalSeverity / Math.max(items.length * 5, 1)) * 100 * (Math.log10(items.length + 1) / 2)));
  return Math.min(100, Math.max(0, raw));
}

// ── Formatters ───────────────────────────────────────────────────────────────

function severityLabel(s: number): string {
  const labels: Record<number, string> = {
    1: chalk.dim('low'),
    2: chalk.blue('minor'),
    3: chalk.yellow('moderate'),
    4: chalk.red('high'),
    5: chalk.bgRed.white(' critical '),
  };
  return labels[s] || chalk.dim('unknown');
}

function scoreGauge(score: number): string {
  const width = 30;
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  const color = score < 30 ? chalk.green : score < 60 ? chalk.yellow : chalk.red;
  const bar = color('\u2588'.repeat(filled)) + chalk.dim('\u2591'.repeat(empty));
  return `${bar} ${score}/100`;
}

function trendArrow(trend: 'improving' | 'degrading' | 'stable'): string {
  if (trend === 'improving') return chalk.green('\u2193 improving');
  if (trend === 'degrading') return chalk.red('\u2191 degrading');
  return chalk.dim('\u2192 stable');
}

function determineTrend(history: Array<{ score: number }>): 'improving' | 'degrading' | 'stable' {
  if (history.length < 2) return 'stable';
  const recent = history.slice(-5);
  const first = recent[0].score;
  const last = recent[recent.length - 1].score;
  const diff = last - first;
  if (diff < -5) return 'improving';
  if (diff > 5) return 'degrading';
  return 'stable';
}

// ── Command Registration ─────────────────────────────────────────────────────

export function registerEvolve(program: Command): void {
  const evolve = program
    .command('evolve')
    .description('Proactive tech debt management — scan, plan, fix, and track');

  // ── swarm evolve scan ────────────────────────────────────────────────────

  evolve
    .command('scan')
    .description('Analyze codebase for tech debt')
    .option('--type <type>', 'Scan only a specific debt type (code-quality, dependency, test, documentation, architecture)')
    .option('--json', 'Output raw JSON')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const cwd = process.cwd();

      console.log(chalk.bold('\nScanning for tech debt...\n'));

      const allFiles = walkDir(cwd, IGNORE_DIRS);
      const items: DebtItem[] = [];

      const types = opts.type ? [opts.type] : ['code-quality', 'dependency', 'test', 'documentation', 'architecture'];

      if (types.includes('code-quality')) {
        process.stdout.write(chalk.dim('  Checking code quality...'));
        const found = scanCodeQuality(cwd, allFiles);
        items.push(...found);
        console.log(chalk.dim(` ${found.length} items`));
      }

      if (types.includes('dependency')) {
        process.stdout.write(chalk.dim('  Checking dependencies...'));
        const found = scanDependencyDebt(cwd);
        items.push(...found);
        console.log(chalk.dim(` ${found.length} items`));
      }

      if (types.includes('test')) {
        process.stdout.write(chalk.dim('  Checking test coverage...'));
        const found = scanTestDebt(cwd, allFiles);
        items.push(...found);
        console.log(chalk.dim(` ${found.length} items`));
      }

      if (types.includes('documentation')) {
        process.stdout.write(chalk.dim('  Checking documentation...'));
        const found = scanDocumentationDebt(cwd, allFiles);
        items.push(...found);
        console.log(chalk.dim(` ${found.length} items`));
      }

      if (types.includes('architecture')) {
        process.stdout.write(chalk.dim('  Checking architecture...'));
        const found = scanArchitectureDebt(cwd, allFiles);
        items.push(...found);
        console.log(chalk.dim(` ${found.length} items`));
      }

      const score = calculateDebtScore(items);
      const history = loadHistory(swarmDir);
      const trend = determineTrend(history);

      // Save snapshot
      const snapshot: DebtSnapshot = { scannedAt: Date.now(), score, items };
      saveDebt(swarmDir, snapshot);
      appendHistory(swarmDir, score, items.length);

      if (opts.json) {
        const data: DebtData = {
          score,
          trend,
          items: items.map((it) => ({
            id: it.id,
            type: it.type,
            severity: it.severity,
            file: it.file,
            description: it.description,
            estimatedEffort: it.estimatedEffort,
            autoFixable: it.autoFixable,
            age: it.age,
          })),
          burndown: history.slice(-30).map((h) => ({ date: h.date, score: h.score })),
          byType: Object.entries(
            items.reduce((acc, it) => {
              if (!acc[it.type]) acc[it.type] = { count: 0, totalSeverity: 0 };
              acc[it.type].count++;
              acc[it.type].totalSeverity += it.severity;
              return acc;
            }, {} as Record<string, { count: number; totalSeverity: number }>)
          ).map(([type, data]) => ({ type, ...data })),
        };
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      // Display results
      console.log(`\n${chalk.bold('Debt Score:')} ${scoreGauge(score)}  ${trendArrow(trend)}`);
      console.log(`${chalk.bold('Total Items:')} ${items.length}\n`);

      // Group by type
      const byType = new Map<string, DebtItem[]>();
      for (const item of items) {
        const arr = byType.get(item.type) || [];
        arr.push(item);
        byType.set(item.type, arr);
      }

      for (const [type, typeItems] of byType) {
        const typeSeverity = typeItems.reduce((s, it) => s + it.severity, 0);
        console.log(chalk.bold(`  ${type} (${typeItems.length} items, severity: ${typeSeverity})`));
        // Show top 5 highest severity
        const sorted = [...typeItems].sort((a, b) => b.severity - a.severity).slice(0, 5);
        for (const item of sorted) {
          const fixable = item.autoFixable ? chalk.green(' [auto-fixable]') : '';
          console.log(`    ${severityLabel(item.severity)} ${chalk.dim(item.file)} — ${item.description}${fixable}`);
        }
        if (typeItems.length > 5) {
          console.log(chalk.dim(`    ... and ${typeItems.length - 5} more`));
        }
        console.log();
      }

      const autoFixable = items.filter((it) => it.autoFixable).length;
      if (autoFixable > 0) {
        console.log(chalk.green(`  ${autoFixable} items are auto-fixable. Run ${chalk.bold('swarm evolve work')} to fix them.\n`));
      }
    });

  // ── swarm evolve plan ────────────────────────────────────────────────────

  evolve
    .command('plan')
    .description('Generate a debt reduction roadmap')
    .option('--target <score>', 'Target debt score (default: 20)', '20')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const debt = loadDebt(swarmDir);

      if (!debt) {
        console.log(chalk.yellow('No debt data found. Run `swarm evolve scan` first.'));
        return;
      }

      const targetScore = parseInt(opts.target, 10);
      const items = [...debt.items].sort((a, b) => b.severity - a.severity);

      console.log(chalk.bold('\nDebt Reduction Roadmap\n'));
      console.log(`  Current score: ${scoreGauge(debt.score)}`);
      console.log(`  Target score:  ${targetScore}\n`);

      // Phase 1: Quick wins (auto-fixable, severity >= 2)
      const quickWins = items.filter((it) => it.autoFixable && it.severity >= 2);
      // Phase 2: High severity manual items
      const highSeverity = items.filter((it) => !it.autoFixable && it.severity >= 4);
      // Phase 3: Medium severity
      const medium = items.filter((it) => !it.autoFixable && it.severity === 3);
      // Phase 4: Low severity cleanup
      const low = items.filter((it) => !it.autoFixable && it.severity <= 2);

      const phases = [
        { name: 'Quick Wins (auto-fixable)', items: quickWins, effort: 'hours' },
        { name: 'Critical Fixes (severity 4-5)', items: highSeverity, effort: 'days' },
        { name: 'Moderate Improvements (severity 3)', items: medium, effort: '1-2 weeks' },
        { name: 'Cleanup (severity 1-2)', items: low, effort: '2-4 weeks' },
      ];

      let phaseNum = 1;
      for (const phase of phases) {
        if (phase.items.length === 0) continue;
        const phaseSeverity = phase.items.reduce((s, it) => s + it.severity, 0);
        console.log(chalk.bold(`  Phase ${phaseNum}: ${phase.name}`));
        console.log(chalk.dim(`  Estimated effort: ${phase.effort} | ${phase.items.length} items | Combined severity: ${phaseSeverity}`));

        const typeBreakdown = new Map<string, number>();
        for (const it of phase.items) {
          typeBreakdown.set(it.type, (typeBreakdown.get(it.type) || 0) + 1);
        }
        for (const [type, count] of typeBreakdown) {
          console.log(chalk.dim(`    - ${type}: ${count} items`));
        }

        // Show top 3 items
        for (const it of phase.items.slice(0, 3)) {
          console.log(`    ${severityLabel(it.severity)} ${chalk.dim(it.file)} — ${it.description}`);
        }
        if (phase.items.length > 3) {
          console.log(chalk.dim(`    ... and ${phase.items.length - 3} more`));
        }
        console.log();
        phaseNum++;
      }

      console.log(chalk.dim(`  Tip: Run ${chalk.bold('swarm evolve work')} to start fixing auto-fixable items.\n`));
    });

  // ── swarm evolve work ────────────────────────────────────────────────────

  evolve
    .command('work')
    .description('Fix highest-priority auto-fixable debt items')
    .option('-n, --count <n>', 'Max items to fix', '10')
    .option('-m, --model <model>', 'Model override (default: sonnet)')
    .option('-b, --budget <amount>', 'Max budget in USD', '5')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const config = loadConfig();
      config.model = opts.model || 'sonnet';
      if (opts.budget) {
        config.maxBudgetUsd = opts.budget === 'none' ? null : (parseFloat(opts.budget) || 5);
      }

      const debt = loadDebt(swarmDir);
      if (!debt) {
        console.log(chalk.yellow('No debt data found. Run `swarm evolve scan` first.'));
        return;
      }

      const maxItems = parseInt(opts.count, 10);
      const fixableItems = debt.items
        .filter((it) => it.autoFixable)
        .sort((a, b) => b.severity - a.severity)
        .slice(0, maxItems);

      if (fixableItems.length === 0) {
        console.log(chalk.yellow('No auto-fixable debt items found.'));
        return;
      }

      console.log(chalk.bold(`\nFixing ${fixableItems.length} auto-fixable debt items...\n`));

      const { agentManager, cleanup } = createContext(swarmDir, config);

      try {
        // Build a prompt describing all items to fix
        const itemDescriptions = fixableItems.map((it, i) =>
          `${i + 1}. [${it.type}] ${it.file}: ${it.description}`
        ).join('\n');

        const prompt = `You are a tech debt reduction agent. Fix the following auto-fixable issues in the codebase.
For each item, make the minimal change needed. Do NOT refactor unrelated code.

Items to fix:
${itemDescriptions}

Rules:
- For 'any' types: replace with proper TypeScript types based on usage context.
- For missing JSDoc: add concise JSDoc comments to exported functions/classes.
- Keep changes minimal and focused on the specific debt item.
- Do not introduce new dependencies.

After fixing, briefly summarize what you changed.`;

        const agentObj = await agentManager.spawn({
          name: 'debt-fixer',
          persona: 'engineer',
          stack: config.stack,
          prompt,
          model: config.model,
          permissionMode: 'acceptEdits',
          cwd: process.cwd(),
          interactive: false,
        });

        console.log(chalk.dim(`  Agent spawned: ${agentObj.id}`));
        console.log(chalk.dim('  Waiting for agent to complete...\n'));

        await agentManager.waitForAgent(agentObj.id);

        const agent = agentManager.getAgent(agentObj.id);
        if (agent) {
          if (agent.status === 'done') {
            console.log(chalk.green('\n  Agent completed successfully.'));
            // Print last part of output as summary
            const output = agent.output.trim();
            const lastLines = output.split('\n').slice(-20).join('\n');
            if (lastLines) {
              console.log(chalk.dim('\n  Summary:'));
              console.log(chalk.dim(`  ${lastLines.split('\n').join('\n  ')}`));
            }
            console.log(chalk.dim(`\n  Cost: $${agent.cost.totalUsd.toFixed(4)}`));
          } else {
            console.log(chalk.red(`\n  Agent finished with status: ${agent.status}`));
            if (agent.error) console.log(chalk.red(`  Error: ${agent.error}`));
          }
        }

        console.log(chalk.dim(`\n  Run ${chalk.bold('swarm evolve scan')} to measure improvement.\n`));
      } finally {
        cleanup();
      }
    });

  // ── swarm evolve report ──────────────────────────────────────────────────

  evolve
    .command('report')
    .description('Tech debt trend report')
    .option('--json', 'Output raw JSON')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const debt = loadDebt(swarmDir);
      const history = loadHistory(swarmDir);

      if (!debt) {
        console.log(chalk.yellow('No debt data found. Run `swarm evolve scan` first.'));
        return;
      }

      const trend = determineTrend(history);

      if (opts.json) {
        const data: DebtData = {
          score: debt.score,
          trend,
          items: debt.items,
          burndown: history.slice(-30).map((h) => ({ date: h.date, score: h.score })),
          byType: Object.entries(
            debt.items.reduce((acc, it) => {
              if (!acc[it.type]) acc[it.type] = { count: 0, totalSeverity: 0 };
              acc[it.type].count++;
              acc[it.type].totalSeverity += it.severity;
              return acc;
            }, {} as Record<string, { count: number; totalSeverity: number }>)
          ).map(([type, data]) => ({ type, ...data })),
        };
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      // Display report
      console.log(chalk.bold('\nTech Debt Report\n'));
      console.log(`  ${chalk.bold('Debt Score:')}  ${scoreGauge(debt.score)}  ${trendArrow(trend)}`);
      console.log(`  ${chalk.bold('Total Items:')} ${debt.items.length}`);
      console.log(`  ${chalk.bold('Auto-fixable:')} ${debt.items.filter((it) => it.autoFixable).length}`);
      console.log(`  ${chalk.bold('Last Scan:')}   ${new Date(debt.scannedAt).toLocaleString()}`);

      // Items by type
      console.log(chalk.bold('\n  By Type:'));
      const byType = new Map<string, { count: number; severity: number }>();
      for (const item of debt.items) {
        const entry = byType.get(item.type) || { count: 0, severity: 0 };
        entry.count++;
        entry.severity += item.severity;
        byType.set(item.type, entry);
      }
      for (const [type, data] of [...byType.entries()].sort((a, b) => b[1].severity - a[1].severity)) {
        const bar = chalk.red('\u2588'.repeat(Math.min(20, data.count)));
        console.log(`    ${type.padEnd(18)} ${String(data.count).padStart(4)} items  severity: ${data.severity}  ${bar}`);
      }

      // Burndown trend
      if (history.length > 1) {
        console.log(chalk.bold('\n  Burndown (last 15 scans):'));
        const recent = history.slice(-15);
        const maxScore = Math.max(...recent.map((h) => h.score), 1);
        for (const entry of recent) {
          const barLen = Math.round((entry.score / maxScore) * 30);
          const color = entry.score < 30 ? chalk.green : entry.score < 60 ? chalk.yellow : chalk.red;
          console.log(`    ${entry.date}  ${color('\u2588'.repeat(barLen))}${chalk.dim('\u2591'.repeat(30 - barLen))} ${entry.score}`);
        }
      }

      // Severity distribution
      console.log(chalk.bold('\n  Severity Distribution:'));
      for (let sev = 5; sev >= 1; sev--) {
        const count = debt.items.filter((it) => it.severity === sev).length;
        if (count > 0) {
          console.log(`    ${severityLabel(sev).padEnd(20)} ${count} items`);
        }
      }

      // Top 10 worst files
      const fileScores = new Map<string, number>();
      for (const item of debt.items) {
        fileScores.set(item.file, (fileScores.get(item.file) || 0) + item.severity);
      }
      const worstFiles = [...fileScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      if (worstFiles.length > 0) {
        console.log(chalk.bold('\n  Hotspots (top 10 worst files):'));
        for (const [file, score] of worstFiles) {
          console.log(`    ${chalk.dim(file.padEnd(50))} severity: ${score}`);
        }
      }

      console.log();
    });
}
