import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import type { ArchReviewData } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FocusArea = 'performance' | 'scalability' | 'maintainability' | 'security';

interface FileInfo {
  path: string;
  relativePath: string;
  lines: number;
  imports: string[];
  size: number;
  ext: string;
}

interface CircularDep {
  cycle: string[];
  length: number;
}

interface GodModule {
  file: string;
  importCount: number;
  importedBy: number;
  totalConnections: number;
}

interface Issue {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  evidence: string;
  impact: string;
  solutions: Array<{ name: string; description: string; effort: string; risk: string; recommended: boolean }>;
}

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

const SCAN_EXTENSIONS = new Set(['.ts', '.js', '.py', '.go']);
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.swarm', 'coverage',
  '.next', '.nuxt', '__pycache__', '.tox', 'vendor', '.cache',
]);

function scanFiles(rootDir: string): FileInfo[] {
  const files: FileInfo[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (!IGNORE_DIRS.has(entry)) {
          walk(fullPath);
        }
      } else if (stat.isFile()) {
        const ext = entry.slice(entry.lastIndexOf('.'));
        if (SCAN_EXTENSIONS.has(ext)) {
          let content: string;
          try {
            content = readFileSync(fullPath, 'utf-8');
          } catch {
            continue;
          }
          const lines = content.split('\n').length;
          const imports = extractImports(content, ext);
          files.push({
            path: fullPath,
            relativePath: relative(rootDir, fullPath),
            lines,
            imports,
            size: stat.size,
            ext,
          });
        }
      }
    }
  }

  walk(rootDir);
  return files;
}

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

function extractImports(content: string, ext: string): string[] {
  const imports: string[] = [];

  if (ext === '.ts' || ext === '.js') {
    // ES import
    const esImportRe = /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = esImportRe.exec(content)) !== null) {
      imports.push(m[1]);
    }
    // require()
    const requireRe = /require\(['"]([^'"]+)['"]\)/g;
    while ((m = requireRe.exec(content)) !== null) {
      imports.push(m[1]);
    }
  } else if (ext === '.py') {
    // Python imports
    const pyImportRe = /^(?:from\s+(\S+)\s+import|import\s+(\S+))/gm;
    let m: RegExpExecArray | null;
    while ((m = pyImportRe.exec(content)) !== null) {
      imports.push(m[1] || m[2]);
    }
  } else if (ext === '.go') {
    // Go imports
    const goImportRe = /import\s+(?:"([^"]+)"|\(\s*([\s\S]*?)\s*\))/g;
    let m: RegExpExecArray | null;
    while ((m = goImportRe.exec(content)) !== null) {
      if (m[1]) {
        imports.push(m[1]);
      } else if (m[2]) {
        const block = m[2];
        const lineRe = /"([^"]+)"/g;
        let lm: RegExpExecArray | null;
        while ((lm = lineRe.exec(block)) !== null) {
          imports.push(lm[1]);
        }
      }
    }
  }

  return imports;
}

// ---------------------------------------------------------------------------
// Resolve relative imports to file paths
// ---------------------------------------------------------------------------

function resolveImport(importPath: string, fromFile: string, rootDir: string, fileSet: Set<string>): string | null {
  // Only resolve relative imports
  if (!importPath.startsWith('.')) return null;

  const fromDir = dirname(fromFile);
  let resolved = join(fromDir, importPath);
  // Strip .js extension that might reference .ts files
  resolved = resolved.replace(/\.js$/, '');

  // Try exact match, then with extensions
  const candidates = [
    resolved,
    resolved + '.ts',
    resolved + '.js',
    resolved + '.py',
    resolved + '.go',
    join(resolved, 'index.ts'),
    join(resolved, 'index.js'),
  ];

  for (const c of candidates) {
    const rel = relative(rootDir, c);
    if (fileSet.has(rel)) return rel;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Circular dependency detection (DFS)
// ---------------------------------------------------------------------------

function detectCircularDeps(files: FileInfo[], rootDir: string): CircularDep[] {
  const fileSet = new Set(files.map(f => f.relativePath));
  const adjList = new Map<string, string[]>();

  for (const file of files) {
    const deps: string[] = [];
    for (const imp of file.imports) {
      const resolved = resolveImport(imp, file.path, rootDir, fileSet);
      if (resolved) deps.push(resolved);
    }
    adjList.set(file.relativePath, deps);
  }

  const cycles: CircularDep[] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stack: string[] = [];

  function dfs(node: string): void {
    if (inStack.has(node)) {
      const cycleStart = stack.indexOf(node);
      const cycle = stack.slice(cycleStart).concat(node);
      cycles.push({ cycle, length: cycle.length - 1 });
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    inStack.add(node);
    stack.push(node);

    for (const dep of adjList.get(node) || []) {
      dfs(dep);
    }

    stack.pop();
    inStack.delete(node);
  }

  for (const file of files) {
    dfs(file.relativePath);
  }

  // Deduplicate cycles (normalize by smallest element first)
  const seen = new Set<string>();
  return cycles.filter(c => {
    const normalized = [...c.cycle.slice(0, -1)];
    const minIdx = normalized.indexOf(normalized.reduce((a, b) => (a < b ? a : b)));
    const key = [...normalized.slice(minIdx), ...normalized.slice(0, minIdx)].join(' -> ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// God module detection
// ---------------------------------------------------------------------------

function detectGodModules(files: FileInfo[], rootDir: string, threshold: number = 10): GodModule[] {
  const fileSet = new Set(files.map(f => f.relativePath));
  const importedByCount = new Map<string, number>();

  for (const file of files) {
    for (const imp of file.imports) {
      const resolved = resolveImport(imp, file.path, rootDir, fileSet);
      if (resolved) {
        importedByCount.set(resolved, (importedByCount.get(resolved) || 0) + 1);
      }
    }
  }

  const gods: GodModule[] = [];
  for (const file of files) {
    const outgoing = file.imports.filter(i => resolveImport(i, file.path, rootDir, fileSet)).length;
    const incoming = importedByCount.get(file.relativePath) || 0;
    const total = outgoing + incoming;
    if (total >= threshold) {
      gods.push({
        file: file.relativePath,
        importCount: outgoing,
        importedBy: incoming,
        totalConnections: total,
      });
    }
  }

  return gods.sort((a, b) => b.totalConnections - a.totalConnections);
}

// ---------------------------------------------------------------------------
// Complexity heuristics
// ---------------------------------------------------------------------------

function calculateComplexity(files: FileInfo[]): { score: number; largeFiles: FileInfo[]; avgLines: number; totalFiles: number } {
  if (files.length === 0) {
    return { score: 0, largeFiles: [], avgLines: 0, totalFiles: 0 };
  }
  const totalLines = files.reduce((sum, f) => sum + f.lines, 0);
  const avgLines = Math.round(totalLines / files.length);
  const largeFiles = files.filter(f => f.lines > 300).sort((a, b) => b.lines - a.lines);

  // Score: 0-100 where higher = more complex/risky
  let score = 0;
  // Penalize large average file size
  score += Math.min(30, Math.round((avgLines / 200) * 30));
  // Penalize many large files
  score += Math.min(30, Math.round((largeFiles.length / Math.max(files.length, 1)) * 100));
  // Penalize high total file count (sprawl)
  score += Math.min(20, Math.round((files.length / 500) * 20));
  // Penalize deep nesting (files with many path segments)
  const avgDepth = files.reduce((s, f) => s + f.relativePath.split('/').length, 0) / files.length;
  score += Math.min(20, Math.round((avgDepth / 6) * 20));

  return { score: Math.min(100, score), largeFiles: largeFiles.slice(0, 15), avgLines, totalFiles: files.length };
}

// ---------------------------------------------------------------------------
// Coupling score
// ---------------------------------------------------------------------------

function calculateCoupling(files: FileInfo[], rootDir: string): number {
  if (files.length === 0) return 0;
  const fileSet = new Set(files.map(f => f.relativePath));
  let totalEdges = 0;

  for (const file of files) {
    for (const imp of file.imports) {
      if (resolveImport(imp, file.path, rootDir, fileSet)) {
        totalEdges++;
      }
    }
  }

  // Coupling density: edges / possible edges, scaled to 0-100
  const possibleEdges = files.length * (files.length - 1);
  if (possibleEdges === 0) return 0;
  const density = totalEdges / possibleEdges;
  return Math.min(100, Math.round(density * 1000)); // Scale up for readability
}

// ---------------------------------------------------------------------------
// Growth pattern analysis
// ---------------------------------------------------------------------------

function analyzeGrowthPatterns(files: FileInfo[]): Array<{ metric: string; direction: 'improving' | 'degrading' | 'stable'; detail: string }> {
  const trends: Array<{ metric: string; direction: 'improving' | 'degrading' | 'stable'; detail: string }> = [];

  // Analyze file size distribution
  const sizes = files.map(f => f.lines).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] || 0;
  const p90 = sizes[Math.floor(sizes.length * 0.9)] || 0;
  const skew = p90 / Math.max(median, 1);

  if (skew > 5) {
    trends.push({
      metric: 'File size distribution',
      direction: 'degrading',
      detail: `High skew (p90/median = ${skew.toFixed(1)}x) — a few files are disproportionately large`,
    });
  } else if (skew > 2) {
    trends.push({
      metric: 'File size distribution',
      direction: 'stable',
      detail: `Moderate skew (p90/median = ${skew.toFixed(1)}x) — acceptable distribution`,
    });
  } else {
    trends.push({
      metric: 'File size distribution',
      direction: 'improving',
      detail: `Low skew (p90/median = ${skew.toFixed(1)}x) — evenly distributed file sizes`,
    });
  }

  // Analyze import fan-out
  const importCounts = files.map(f => f.imports.length).sort((a, b) => a - b);
  const avgImports = importCounts.reduce((s, c) => s + c, 0) / Math.max(importCounts.length, 1);
  const maxImports = importCounts[importCounts.length - 1] || 0;

  if (maxImports > 20) {
    trends.push({
      metric: 'Import fan-out',
      direction: 'degrading',
      detail: `Max imports in a single file: ${maxImports} (avg: ${avgImports.toFixed(1)}) — high coupling risk`,
    });
  } else if (avgImports > 8) {
    trends.push({
      metric: 'Import fan-out',
      direction: 'stable',
      detail: `Average imports per file: ${avgImports.toFixed(1)} — monitor for growth`,
    });
  } else {
    trends.push({
      metric: 'Import fan-out',
      direction: 'improving',
      detail: `Average imports per file: ${avgImports.toFixed(1)} — well-factored modules`,
    });
  }

  // Directory depth
  const depths = files.map(f => f.relativePath.split('/').length);
  const maxDepth = Math.max(...depths, 0);

  if (maxDepth > 8) {
    trends.push({
      metric: 'Directory depth',
      direction: 'degrading',
      detail: `Max nesting depth: ${maxDepth} levels — consider flattening the structure`,
    });
  } else {
    trends.push({
      metric: 'Directory depth',
      direction: 'stable',
      detail: `Max nesting depth: ${maxDepth} levels — reasonable project structure`,
    });
  }

  return trends;
}

// ---------------------------------------------------------------------------
// Focus-area specific analysis
// ---------------------------------------------------------------------------

function focusAnalysis(focus: FocusArea | undefined, files: FileInfo[]): Issue[] {
  const issues: Issue[] = [];
  let idCounter = 1;

  const makeId = () => `ARCH-${String(idCounter++).padStart(3, '0')}`;

  if (!focus || focus === 'performance') {
    // Check for large files that may cause slow builds / bundle sizes
    const hugeFiles = files.filter(f => f.lines > 500);
    if (hugeFiles.length > 0) {
      issues.push({
        id: makeId(),
        title: 'Oversized source files detected',
        severity: hugeFiles.some(f => f.lines > 1000) ? 'high' : 'medium',
        category: 'performance',
        evidence: hugeFiles.slice(0, 5).map(f => `${f.relativePath} (${f.lines} lines)`).join(', '),
        impact: 'Large files slow IDE performance, increase build times, and make code review harder',
        solutions: [
          { name: 'Split into modules', description: 'Break large files into focused, single-responsibility modules', effort: 'medium', risk: 'low', recommended: true },
          { name: 'Extract utilities', description: 'Move shared helpers to utility modules', effort: 'low', risk: 'low', recommended: false },
        ],
      });
    }
  }

  if (!focus || focus === 'scalability') {
    // Check for single-directory bottleneck
    const dirCounts = new Map<string, number>();
    for (const f of files) {
      const dir = dirname(f.relativePath);
      dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1);
    }
    const bloatedDirs = [...dirCounts.entries()].filter(([, count]) => count > 20).sort((a, b) => b[1] - a[1]);
    if (bloatedDirs.length > 0) {
      issues.push({
        id: makeId(),
        title: 'Directory scalability bottleneck',
        severity: bloatedDirs[0][1] > 40 ? 'high' : 'medium',
        category: 'scalability',
        evidence: bloatedDirs.slice(0, 5).map(([dir, count]) => `${dir}/ (${count} files)`).join(', '),
        impact: 'Too many files in a single directory hinders navigation and increases merge conflicts',
        solutions: [
          { name: 'Introduce sub-packages', description: 'Group related files into feature-based sub-directories', effort: 'medium', risk: 'medium', recommended: true },
          { name: 'Domain-driven structure', description: 'Reorganize by bounded contexts or feature domains', effort: 'high', risk: 'medium', recommended: false },
        ],
      });
    }
  }

  if (!focus || focus === 'maintainability') {
    // Check for deeply nested files
    const deepFiles = files.filter(f => f.relativePath.split('/').length > 6);
    if (deepFiles.length > 0) {
      issues.push({
        id: makeId(),
        title: 'Deeply nested file structure',
        severity: 'medium',
        category: 'maintainability',
        evidence: deepFiles.slice(0, 5).map(f => f.relativePath).join(', '),
        impact: 'Deep nesting makes navigation difficult and import paths excessively long',
        solutions: [
          { name: 'Flatten structure', description: 'Reduce nesting by colocating related files', effort: 'medium', risk: 'low', recommended: true },
          { name: 'Use path aliases', description: 'Configure TypeScript/bundler path aliases for deep imports', effort: 'low', risk: 'low', recommended: false },
        ],
      });
    }

    // Check for files with no imports (potential dead code)
    const orphanFiles = files.filter(f => f.imports.length === 0 && f.lines > 10);
    if (orphanFiles.length > 5) {
      issues.push({
        id: makeId(),
        title: 'Potential dead code or isolated modules',
        severity: 'low',
        category: 'maintainability',
        evidence: `${orphanFiles.length} files with zero imports: ${orphanFiles.slice(0, 5).map(f => f.relativePath).join(', ')}`,
        impact: 'Isolated files may be dead code, increasing maintenance burden',
        solutions: [
          { name: 'Audit for dead code', description: 'Review isolated files and remove unused code', effort: 'low', risk: 'low', recommended: true },
          { name: 'Add integration', description: 'Connect orphan modules to the rest of the codebase or document their standalone purpose', effort: 'low', risk: 'low', recommended: false },
        ],
      });
    }
  }

  if (!focus || focus === 'security') {
    // Check for hardcoded secrets patterns
    const secretPatterns = [
      /(?:api[_-]?key|secret|password|token|credential)\s*[:=]\s*['"][^'"]{8,}['"]/i,
      /(?:AKIA|AIza)[A-Za-z0-9]{12,}/,
    ];
    const suspectFiles: string[] = [];
    for (const file of files) {
      try {
        const content = readFileSync(file.path, 'utf-8');
        for (const pattern of secretPatterns) {
          if (pattern.test(content)) {
            suspectFiles.push(file.relativePath);
            break;
          }
        }
      } catch {
        // skip unreadable
      }
    }
    if (suspectFiles.length > 0) {
      issues.push({
        id: makeId(),
        title: 'Potential hardcoded secrets detected',
        severity: 'critical',
        category: 'security',
        evidence: suspectFiles.slice(0, 10).join(', '),
        impact: 'Hardcoded secrets can be leaked through version control, logs, or build artifacts',
        solutions: [
          { name: 'Use environment variables', description: 'Move secrets to environment variables or a secrets manager', effort: 'low', risk: 'low', recommended: true },
          { name: 'Add secret scanning', description: 'Integrate a pre-commit secret scanner like gitleaks or trufflehog', effort: 'low', risk: 'low', recommended: true },
        ],
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateMarkdown(data: ArchReviewData, focus: FocusArea | undefined): string {
  const lines: string[] = [];
  lines.push('# Architecture Review Report');
  lines.push('');
  if (focus) {
    lines.push(`> **Focus Area:** ${focus}`);
    lines.push('');
  }
  lines.push(`> Generated: ${new Date(data.timestamp).toISOString()}`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(data.summary);
  lines.push('');

  // Scores
  lines.push('## Metrics');
  lines.push('');
  lines.push(`| Metric | Score |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Coupling | ${data.couplingScore}/100 |`);
  lines.push(`| Complexity | ${data.complexityScore}/100 |`);
  lines.push('');

  // Issues
  if (data.issues.length > 0) {
    lines.push('## Issues');
    lines.push('');
    for (const issue of data.issues) {
      const severityColor: Record<string, string> = {
        critical: '🔴', high: '🟠', medium: '🟡', low: '🟢',
      };
      lines.push(`### ${severityColor[issue.severity] || ''} ${issue.id}: ${issue.title}`);
      lines.push('');
      lines.push(`- **Severity:** ${issue.severity}`);
      lines.push(`- **Category:** ${issue.category}`);
      lines.push(`- **Evidence:** ${issue.evidence}`);
      lines.push(`- **Impact:** ${issue.impact}`);
      lines.push('');
      if (issue.solutions.length > 0) {
        lines.push('**Solutions:**');
        lines.push('');
        for (const sol of issue.solutions) {
          const rec = sol.recommended ? ' *(recommended)*' : '';
          lines.push(`- **${sol.name}**${rec}: ${sol.description} (effort: ${sol.effort}, risk: ${sol.risk})`);
        }
        lines.push('');
      }
    }
  }

  // Trends
  if (data.trends.length > 0) {
    lines.push('## Growth Patterns & Trends');
    lines.push('');
    const arrows: Record<string, string> = { improving: '↗', degrading: '↘', stable: '→' };
    for (const trend of data.trends) {
      lines.push(`- ${arrows[trend.direction] || '→'} **${trend.metric}** (${trend.direction}): ${trend.detail}`);
    }
    lines.push('');
  }

  // Action plan
  if (data.actionPlan.length > 0) {
    lines.push('## Action Plan');
    lines.push('');
    lines.push('| Priority | Action | Effort | Impact |');
    lines.push('|----------|--------|--------|--------|');
    for (const item of data.actionPlan) {
      lines.push(`| ${item.priority} | ${item.action} | ${item.effort} | ${item.impact} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Build action plan from issues
// ---------------------------------------------------------------------------

function buildActionPlan(issues: Issue[]): Array<{ priority: number; action: string; effort: string; impact: string }> {
  const severityWeight: Record<string, number> = { critical: 1, high: 2, medium: 3, low: 4 };
  const sorted = [...issues].sort((a, b) => (severityWeight[a.severity] || 5) - (severityWeight[b.severity] || 5));

  return sorted.map((issue, idx) => {
    const recommended = issue.solutions.find(s => s.recommended);
    return {
      priority: idx + 1,
      action: recommended ? `${issue.title} — ${recommended.name}` : issue.title,
      effort: recommended?.effort || 'medium',
      impact: issue.severity === 'critical' || issue.severity === 'high' ? 'high' : 'medium',
    };
  });
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerArchitectReview(program: Command): void {
  program
    .command('architect-review')
    .description('Strategic architecture review — analyze coupling, complexity, circular deps, and growth patterns')
    .option('-f, --focus <area>', 'Focus on a specific area: performance, scalability, maintainability, security')
    .option('-d, --dir <path>', 'Project directory to scan (default: cwd)')
    .option('-t, --threshold <n>', 'God-module connection threshold', '10')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const _config = loadConfig();

      const projectDir = opts.dir ? join(process.cwd(), opts.dir) : process.cwd();
      const focus = opts.focus as FocusArea | undefined;
      const godThreshold = parseInt(opts.threshold, 10) || 10;

      if (focus && !['performance', 'scalability', 'maintainability', 'security'].includes(focus)) {
        console.error(chalk.red(`Invalid focus area: ${focus}. Choose from: performance, scalability, maintainability, security`));
        process.exit(1);
      }

      console.log(chalk.bold('\nArchitecture Review'));
      console.log(chalk.dim(`Scanning: ${projectDir}`));
      if (focus) console.log(chalk.dim(`Focus: ${focus}`));
      console.log('');

      // 1. Scan files
      console.log(chalk.cyan('Scanning project files...'));
      const files = scanFiles(projectDir);
      console.log(chalk.dim(`  Found ${files.length} source files`));

      if (files.length === 0) {
        console.log(chalk.yellow('No source files found. Nothing to review.'));
        return;
      }

      // 2. Detect circular dependencies
      console.log(chalk.cyan('Detecting circular dependencies...'));
      const circularDeps = detectCircularDeps(files, projectDir);
      console.log(chalk.dim(`  Found ${circularDeps.length} circular dependency cycle(s)`));

      // 3. Detect god modules
      console.log(chalk.cyan('Finding god modules...'));
      const godModules = detectGodModules(files, projectDir, godThreshold);
      console.log(chalk.dim(`  Found ${godModules.length} god module(s) (threshold: ${godThreshold} connections)`));

      // 4. Calculate complexity
      console.log(chalk.cyan('Calculating complexity heuristics...'));
      const complexity = calculateComplexity(files);
      console.log(chalk.dim(`  Complexity score: ${complexity.score}/100 | Avg lines: ${complexity.avgLines}`));

      // 5. Calculate coupling
      console.log(chalk.cyan('Calculating coupling score...'));
      const couplingScore = calculateCoupling(files, projectDir);
      console.log(chalk.dim(`  Coupling score: ${couplingScore}/100`));

      // 6. Analyze growth patterns
      console.log(chalk.cyan('Analyzing growth patterns...'));
      const trends = analyzeGrowthPatterns(files);

      // 7. Build issues list
      console.log(chalk.cyan('Compiling issues...'));
      const issues: Issue[] = [];

      // Circular dep issues
      if (circularDeps.length > 0) {
        issues.push({
          id: 'ARCH-CYC',
          title: 'Circular dependencies detected',
          severity: circularDeps.length > 5 ? 'critical' : circularDeps.length > 2 ? 'high' : 'medium',
          category: 'maintainability',
          evidence: circularDeps.slice(0, 5).map(c => c.cycle.join(' -> ')).join('; '),
          impact: 'Circular dependencies create tight coupling, make testing difficult, and can cause runtime initialization issues',
          solutions: [
            { name: 'Dependency inversion', description: 'Introduce interfaces/abstractions to break the cycle', effort: 'medium', risk: 'low', recommended: true },
            { name: 'Extract shared module', description: 'Move shared code into a separate module that both sides depend on', effort: 'medium', risk: 'low', recommended: false },
            { name: 'Barrel file restructure', description: 'Reorganize barrel/index files to eliminate re-export cycles', effort: 'low', risk: 'low', recommended: false },
          ],
        });
      }

      // God module issues
      if (godModules.length > 0) {
        issues.push({
          id: 'ARCH-GOD',
          title: 'God modules with excessive connections',
          severity: godModules[0].totalConnections > 25 ? 'high' : 'medium',
          category: 'scalability',
          evidence: godModules.slice(0, 5).map(g => `${g.file} (${g.totalConnections} connections: ${g.importCount} out, ${g.importedBy} in)`).join('; '),
          impact: 'God modules become bottlenecks for changes, slow builds, and increase merge conflict risk',
          solutions: [
            { name: 'Decompose into focused modules', description: 'Split the module by responsibility into smaller, focused units', effort: 'high', risk: 'medium', recommended: true },
            { name: 'Introduce facade pattern', description: 'Keep the module as a thin facade delegating to smaller internal modules', effort: 'medium', risk: 'low', recommended: false },
          ],
        });
      }

      // Focus-specific issues
      const focusIssues = focusAnalysis(focus, files);
      issues.push(...focusIssues);

      // 8. Build action plan
      const actionPlan = buildActionPlan(issues);

      // 9. Build summary
      const criticalCount = issues.filter(i => i.severity === 'critical').length;
      const highCount = issues.filter(i => i.severity === 'high').length;
      const summaryParts = [
        `Scanned **${files.length}** files across the project.`,
        `Found **${issues.length}** issue(s): ${criticalCount} critical, ${highCount} high, ${issues.length - criticalCount - highCount} medium/low.`,
        `Coupling score: **${couplingScore}/100** | Complexity score: **${complexity.score}/100**.`,
        circularDeps.length > 0
          ? `Detected **${circularDeps.length}** circular dependency cycle(s).`
          : 'No circular dependencies detected.',
        godModules.length > 0
          ? `Found **${godModules.length}** god module(s).`
          : 'No god modules found.',
      ];

      const data: ArchReviewData = {
        summary: summaryParts.join(' '),
        issues,
        couplingScore,
        complexityScore: complexity.score,
        trends,
        actionPlan,
        timestamp: Date.now(),
      };

      // 10. Write outputs
      const reportPath = join(projectDir, 'ARCHITECTURE-REVIEW.md');
      const jsonPath = join(swarmDir, 'arch-review.json');

      // Ensure .swarm dir exists
      if (!existsSync(swarmDir)) {
        mkdirSync(swarmDir, { recursive: true });
      }

      const markdown = generateMarkdown(data, focus);
      writeFileSync(reportPath, markdown, 'utf-8');
      writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');

      console.log('');
      console.log(chalk.green('Architecture review complete!'));
      console.log('');

      // Print summary
      if (criticalCount > 0) {
        console.log(chalk.red(`  ${criticalCount} critical issue(s)`));
      }
      if (highCount > 0) {
        console.log(chalk.yellow(`  ${highCount} high-severity issue(s)`));
      }
      console.log(chalk.dim(`  ${issues.length - criticalCount - highCount} medium/low issue(s)`));
      console.log('');
      console.log(chalk.dim(`  Coupling:   ${couplingScore}/100`));
      console.log(chalk.dim(`  Complexity: ${complexity.score}/100`));
      console.log('');
      console.log(`  Report:  ${chalk.underline(reportPath)}`);
      console.log(`  Data:    ${chalk.underline(jsonPath)}`);
      console.log('');
    });
}
