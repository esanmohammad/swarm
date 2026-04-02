import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execSync } from 'node:child_process';
import type { HotPath, QueryIssue, OptimizeReport, TechStack } from '../types.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const REPORTS_FILE = 'optimize-reports.json';

/** Patterns that suggest N+1 queries */
const N_PLUS_ONE_PATTERNS = [
  /for\s*\(.*\)\s*\{[^}]*\b(query|exec|find|findOne|select|fetch|get)\b/,
  /\.forEach\s*\([^)]*\)\s*=>\s*\{[^}]*\b(query|exec|find|findOne|select|fetch|get)\b/,
  /\.map\s*\([^)]*\)\s*=>\s*[^;]*\b(query|exec|find|findOne|select|fetch|get)\b/,
  /for\s+await\s*\(.*\)\s*\{[^}]*\b(query|exec|find|findOne|select|fetch|get)\b/,
];

/** Patterns that suggest missing index opportunities */
const MISSING_INDEX_PATTERNS = [
  /\.find\(\{[^}]*\}\)/,
  /WHERE\s+(?!.*(?:PRIMARY|INDEX))/i,
  /\.filter\(\{[^}]*\}\)/,
];

/** Patterns suggesting full table/collection scans */
const FULL_SCAN_PATTERNS = [
  /\.find\(\s*\{\s*\}\s*\)/,
  /SELECT\s+\*\s+FROM/i,
  /\.aggregate\(\s*\[\s*\{\s*\$match/,
];

/** Memory leak patterns */
const MEMORY_LEAK_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /setInterval\s*\(/, description: 'setInterval without cleanup — may accumulate callbacks' },
  { pattern: /addEventListener\s*\([^)]+\)\s*(?!.*removeEventListener)/, description: 'addEventListener without removeEventListener' },
  { pattern: /new\s+Map\(\)/, description: 'Unbounded Map growth — check if entries are ever deleted' },
  { pattern: /new\s+Set\(\)/, description: 'Unbounded Set growth — check if entries are ever deleted' },
  { pattern: /\.push\([^)]+\)\s*(?!.*splice|pop|shift|length\s*=)/, description: 'Array push without bounded cleanup' },
  { pattern: /global\.\w+\s*=/, description: 'Global variable assignment — potential leak if accumulated' },
  { pattern: /process\.on\s*\(/, description: 'process event listener — check for cleanup on exit' },
  { pattern: /cache\s*[=:]\s*(?:new\s+Map|{})/, description: 'Cache without eviction policy — may grow unbounded' },
];

/** Large npm dependency names known to bloat bundles */
const LARGE_DEPS = [
  'moment', 'lodash', 'rxjs', 'core-js', 'aws-sdk', 'firebase',
  'antd', 'material-ui', '@mui/material', 'chart.js', 'd3',
  'pdf-lib', 'pdfkit', 'puppeteer', 'playwright', 'jsdom',
];

// ─── Stack detection ────────────────────────────────────────────────────────

type DetectedStack = 'node' | 'go' | 'python' | 'unknown';

function detectStack(cwd: string): DetectedStack {
  if (existsSync(join(cwd, 'package.json'))) return 'node';
  if (existsSync(join(cwd, 'go.mod'))) return 'go';
  if (existsSync(join(cwd, 'pyproject.toml')) || existsSync(join(cwd, 'setup.py')) || existsSync(join(cwd, 'requirements.txt'))) return 'python';
  return 'unknown';
}

// ─── Source file walking ────────────────────────────────────────────────────

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs']);
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.swarm', '__pycache__', 'vendor', '.venv', 'venv']);

function walkSourceFiles(dir: string, base: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          files.push(...walkSourceFiles(full, base));
        } else if (SOURCE_EXTS.has(extname(entry))) {
          files.push(relative(base, full));
        }
      } catch { /* permission or symlink — skip */ }
    }
  } catch { /* unreadable dir — skip */ }
  return files;
}

// ─── PerfAnalyzer ───────────────────────────────────────────────────────────

export class PerfAnalyzer {
  private swarmDir: string;
  private cwd: string;
  private stack: DetectedStack;
  private report: OptimizeReport;

  constructor(swarmDir: string, stackOverride?: TechStack) {
    this.swarmDir = swarmDir;
    this.cwd = join(swarmDir, '..');
    this.stack = stackOverride ? this.mapStack(stackOverride) : detectStack(this.cwd);
    this.report = this.emptyReport('profile');
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Run the stack-appropriate profiler and analyze hot paths */
  profile(cwd?: string): OptimizeReport {
    const dir = cwd ?? this.cwd;
    this.report = this.emptyReport('profile');

    const hotPaths = this.runProfiler(dir);
    this.report.hotPaths = hotPaths;

    // Generate recommendations from hot paths
    if (hotPaths.length > 0) {
      const top = hotPaths[0];
      this.report.recommendations.push(
        `Top hot path: ${top.function} in ${top.file}:${top.line} — ${top.cpuPercent.toFixed(1)}% CPU`,
      );
      if (hotPaths.length > 3) {
        this.report.recommendations.push(
          `${hotPaths.length} hot paths found — focus on the top 3 for maximum impact`,
        );
      }
      for (const hp of hotPaths.slice(0, 5)) {
        if (hp.cpuPercent > 20) {
          this.report.recommendations.push(
            `Consider optimizing ${hp.function} — it consumes ${hp.cpuPercent.toFixed(1)}% of CPU time`,
          );
        }
      }
    } else {
      this.report.recommendations.push(
        'No profiler data available. Install a profiler for your stack or run with --scope to target specific files.',
      );
    }

    this.persistReport(this.report);
    return this.report;
  }

  /** Analyze JS/TS bundle for size, large deps, and tree-shaking opportunities */
  analyzeBundle(cwd?: string): OptimizeReport {
    const dir = cwd ?? this.cwd;
    this.report = this.emptyReport('bundle');

    const pkgPath = join(dir, 'package.json');
    if (!existsSync(pkgPath)) {
      this.report.recommendations.push('No package.json found — bundle analysis is only available for JS/TS projects.');
      this.persistReport(this.report);
      return this.report;
    }

    let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch { /* invalid json */ }

    const deps = Object.keys(pkg.dependencies ?? {});
    const largestModules: Array<{ name: string; bytes: number }> = [];

    // Check node_modules sizes for known large deps
    for (const dep of deps) {
      const depDir = join(dir, 'node_modules', dep);
      if (!existsSync(depDir)) continue;
      const size = this.dirSize(depDir);
      largestModules.push({ name: dep, bytes: size });
    }

    largestModules.sort((a, b) => b.bytes - a.bytes);

    // Measure dist/ if exists
    const distDir = join(dir, 'dist');
    let totalBytes = 0;
    if (existsSync(distDir)) {
      totalBytes = this.dirSize(distDir);
    }

    this.report.bundleSize = {
      totalBytes,
      largestModules: largestModules.slice(0, 15),
    };

    // Check for known large deps
    const largeDepsFound = deps.filter(d => LARGE_DEPS.some(ld => d.includes(ld)));
    for (const ld of largeDepsFound) {
      this.report.recommendations.push(
        `Large dependency "${ld}" detected — consider a lighter alternative or import only needed modules`,
      );
    }

    // Check for lodash (prefer lodash-es or specific imports)
    if (deps.includes('lodash')) {
      this.report.recommendations.push(
        'Replace "lodash" with "lodash-es" or individual lodash function packages for tree-shaking',
      );
    }

    // Check for moment (prefer date-fns or dayjs)
    if (deps.includes('moment')) {
      this.report.recommendations.push(
        'Replace "moment" with "date-fns" or "dayjs" — moment is 300KB+ and not tree-shakeable',
      );
    }

    // Check for duplicate React
    if (deps.includes('react') && (pkg.devDependencies ?? {})['react']) {
      this.report.recommendations.push(
        'React appears in both dependencies and devDependencies — this may cause bundle duplication',
      );
    }

    // Check for source maps in dist
    try {
      const distFiles = existsSync(distDir) ? readdirSync(distDir) : [];
      const mapFiles = distFiles.filter(f => f.endsWith('.map'));
      if (mapFiles.length > 0) {
        this.report.recommendations.push(
          `${mapFiles.length} source map file(s) in dist/ — ensure these are not served to production`,
        );
      }
    } catch { /* ignore */ }

    if (this.report.recommendations.length === 0) {
      this.report.recommendations.push('Bundle looks clean — no obvious optimization opportunities found.');
    }

    this.persistReport(this.report);
    return this.report;
  }

  /** Scan source code for slow query patterns, N+1, full scans */
  analyzeQueries(cwd?: string): OptimizeReport {
    const dir = cwd ?? this.cwd;
    this.report = this.emptyReport('queries');

    const sourceFiles = walkSourceFiles(dir, dir);
    const issues: QueryIssue[] = [];

    for (const file of sourceFiles) {
      const fullPath = join(dir, file);
      let content: string;
      try {
        content = readFileSync(fullPath, 'utf-8');
      } catch { continue; }

      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // N+1 detection: look at surrounding context (5-line window)
        const window = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join('\n');
        for (const pat of N_PLUS_ONE_PATTERNS) {
          if (pat.test(window)) {
            issues.push({
              query: line.trim().slice(0, 120),
              file,
              line: lineNum,
              type: 'n-plus-one',
              estimatedImpactMs: 50,
              suggestion: 'Batch queries or use eager loading to avoid N+1',
            });
            break;
          }
        }

        // Full scan detection
        for (const pat of FULL_SCAN_PATTERNS) {
          if (pat.test(line)) {
            issues.push({
              query: line.trim().slice(0, 120),
              file,
              line: lineNum,
              type: 'full-scan',
              estimatedImpactMs: 100,
              suggestion: 'Add a filter condition or use pagination to avoid full scans',
            });
          }
        }

        // Missing index hints
        for (const pat of MISSING_INDEX_PATTERNS) {
          if (pat.test(line) && /\.find|WHERE/i.test(line)) {
            const alreadyCovered = issues.some(iss => iss.file === file && iss.line === lineNum);
            if (!alreadyCovered) {
              issues.push({
                query: line.trim().slice(0, 120),
                file,
                line: lineNum,
                type: 'missing-index',
                estimatedImpactMs: 30,
                suggestion: 'Ensure the queried fields have database indexes',
              });
            }
          }
        }
      }
    }

    // Deduplicate by file+line
    const seen = new Set<string>();
    this.report.queryIssues = issues.filter(iss => {
      const key = `${iss.file}:${iss.line}:${iss.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Recommendations
    const nPlusOne = this.report.queryIssues.filter(q => q.type === 'n-plus-one').length;
    const fullScans = this.report.queryIssues.filter(q => q.type === 'full-scan').length;
    const missingIdx = this.report.queryIssues.filter(q => q.type === 'missing-index').length;

    if (nPlusOne > 0) this.report.recommendations.push(`${nPlusOne} potential N+1 query pattern(s) found — batch or eager-load`);
    if (fullScans > 0) this.report.recommendations.push(`${fullScans} full scan pattern(s) found — add filters or pagination`);
    if (missingIdx > 0) this.report.recommendations.push(`${missingIdx} query(ies) may benefit from database indexes`);

    if (this.report.queryIssues.length === 0) {
      this.report.recommendations.push('No obvious query performance issues detected.');
    }

    this.persistReport(this.report);
    return this.report;
  }

  /** Detect potential memory leak patterns in source code */
  analyzeMemory(cwd?: string): OptimizeReport {
    const dir = cwd ?? this.cwd;
    this.report = this.emptyReport('memory');

    const sourceFiles = walkSourceFiles(dir, dir);
    const leaks: Array<{ location: string; growthRateMbPerHour: number; description: string }> = [];

    for (const file of sourceFiles) {
      const fullPath = join(dir, file);
      let content: string;
      try {
        content = readFileSync(fullPath, 'utf-8');
      } catch { continue; }

      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        for (const { pattern, description } of MEMORY_LEAK_PATTERNS) {
          if (pattern.test(line)) {
            leaks.push({
              location: `${file}:${lineNum}`,
              growthRateMbPerHour: 0, // Static analysis — can't measure actual rate
              description,
            });
          }
        }
      }
    }

    this.report.memoryLeaks = leaks;

    // Recommendations
    if (leaks.length > 0) {
      this.report.recommendations.push(
        `${leaks.length} potential memory leak pattern(s) detected — review each location`,
      );

      const intervalLeaks = leaks.filter(l => l.description.includes('setInterval'));
      if (intervalLeaks.length > 0) {
        this.report.recommendations.push(
          'Ensure all setInterval calls have corresponding clearInterval in cleanup/teardown',
        );
      }

      const cacheLeaks = leaks.filter(l => l.description.includes('Cache'));
      if (cacheLeaks.length > 0) {
        this.report.recommendations.push(
          'Add eviction policies (TTL or LRU) to caches to prevent unbounded memory growth',
        );
      }
    } else {
      this.report.recommendations.push('No obvious memory leak patterns detected.');
    }

    // Stack-specific profiler tips
    if (this.stack === 'node') {
      this.report.recommendations.push(
        'For deeper analysis: run `node --inspect` with Chrome DevTools heap snapshots',
      );
    } else if (this.stack === 'go') {
      this.report.recommendations.push(
        'For deeper analysis: use `go tool pprof` with heap profile endpoint',
      );
    } else if (this.stack === 'python') {
      this.report.recommendations.push(
        'For deeper analysis: use tracemalloc or objgraph for runtime memory tracking',
      );
    }

    this.persistReport(this.report);
    return this.report;
  }

  /** Goal-directed optimization — run all analyses and prioritize by goal */
  optimizeForGoal(goal: string, cwd?: string): OptimizeReport {
    const dir = cwd ?? this.cwd;
    this.report = this.emptyReport('goal');

    const lowerGoal = goal.toLowerCase();

    // Determine which analyses to run based on goal
    const runProfile = /latency|speed|slow|cpu|perf/.test(lowerGoal);
    const runBundle = /bundle|size|load|startup|deploy/.test(lowerGoal);
    const runQueries = /query|database|db|api|latency|slow/.test(lowerGoal);
    const runMemory = /memory|leak|oom|ram|heap/.test(lowerGoal);
    const runAll = !runProfile && !runBundle && !runQueries && !runMemory;

    const allHotPaths: HotPath[] = [];
    const allQueryIssues: QueryIssue[] = [];
    const allRecommendations: string[] = [`Goal: "${goal}"`];

    if (runProfile || runAll) {
      const profileReport = this.profile(dir);
      allHotPaths.push(...profileReport.hotPaths);
      allRecommendations.push(...profileReport.recommendations);
    }

    if (runBundle || runAll) {
      const bundleReport = this.analyzeBundle(dir);
      if (bundleReport.bundleSize) {
        this.report.bundleSize = bundleReport.bundleSize;
      }
      allRecommendations.push(...bundleReport.recommendations);
    }

    if (runQueries || runAll) {
      const queryReport = this.analyzeQueries(dir);
      allQueryIssues.push(...queryReport.queryIssues);
      allRecommendations.push(...queryReport.recommendations);
    }

    if (runMemory || runAll) {
      const memoryReport = this.analyzeMemory(dir);
      this.report.memoryLeaks = memoryReport.memoryLeaks;
      allRecommendations.push(...memoryReport.recommendations);
    }

    this.report.hotPaths = allHotPaths;
    this.report.queryIssues = allQueryIssues;
    this.report.recommendations = [...new Set(allRecommendations)]; // deduplicate

    this.persistReport(this.report);
    return this.report;
  }

  /** Get the most recent persisted report */
  getReport(): OptimizeReport | null {
    const reports = this.loadReports();
    return reports.length > 0 ? reports[reports.length - 1] : null;
  }

  /** Get all persisted reports */
  getReports(): OptimizeReport[] {
    return this.loadReports();
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private mapStack(stack: TechStack): DetectedStack {
    if (stack === 'node' || stack === 'react') return 'node';
    if (stack === 'go') return 'go';
    if (stack === 'python') return 'python';
    return 'unknown';
  }

  private emptyReport(type: OptimizeReport['type']): OptimizeReport {
    return {
      type,
      hotPaths: [],
      queryIssues: [],
      improvements: [],
      recommendations: [],
      timestamp: Date.now(),
    };
  }

  /** Run the appropriate profiler based on stack and parse output */
  private runProfiler(dir: string): HotPath[] {
    const hotPaths: HotPath[] = [];

    if (this.stack === 'node') {
      return this.profileNode(dir);
    }
    if (this.stack === 'go') {
      return this.profileGo(dir);
    }
    if (this.stack === 'python') {
      return this.profilePython(dir);
    }

    return hotPaths;
  }

  private profileNode(dir: string): HotPath[] {
    const hotPaths: HotPath[] = [];

    // Try clinic.js / 0x first, fallback to --prof
    try {
      // Check for an existing .clinic or .cpuprofile
      const clinicData = this.findFile(dir, '.clinic');
      if (clinicData) {
        // Parse clinic output if available
        return hotPaths;
      }
    } catch { /* no clinic */ }

    // Try to find entry point and profile with --cpu-prof
    const entryPoints = ['dist/index.js', 'dist/main.js', 'src/index.ts', 'index.js', 'server.js', 'app.js'];
    let entry: string | null = null;
    for (const ep of entryPoints) {
      if (existsSync(join(dir, ep))) {
        entry = ep;
        break;
      }
    }

    if (!entry) return hotPaths;

    try {
      // Run a short CPU profile (5 second timeout)
      execSync(
        `node --cpu-prof --cpu-prof-dir=.swarm --cpu-prof-interval=1000 -e "require('./${entry}')" 2>/dev/null || true`,
        { cwd: dir, timeout: 10000, encoding: 'utf-8', stdio: 'pipe' },
      );

      // Look for generated .cpuprofile files
      const swarmDir = join(dir, '.swarm');
      if (existsSync(swarmDir)) {
        const cpuFiles = readdirSync(swarmDir).filter(f => f.endsWith('.cpuprofile'));
        if (cpuFiles.length > 0) {
          const profilePath = join(swarmDir, cpuFiles[cpuFiles.length - 1]);
          return this.parseCpuProfile(profilePath, dir);
        }
      }
    } catch { /* profiling failed — acceptable */ }

    return hotPaths;
  }

  private parseCpuProfile(profilePath: string, basedir: string): HotPath[] {
    const hotPaths: HotPath[] = [];
    try {
      const data = JSON.parse(readFileSync(profilePath, 'utf-8'));
      const nodes = data.nodes || [];
      const totalTicks = nodes.reduce((sum: number, n: { hitCount?: number }) => sum + (n.hitCount ?? 0), 0);

      if (totalTicks === 0) return hotPaths;

      for (const node of nodes) {
        if (!node.callFrame || node.hitCount === 0) continue;
        const cf = node.callFrame;
        if (!cf.url || cf.url.includes('node_modules') || cf.url.startsWith('node:')) continue;

        const cpuPercent = (node.hitCount / totalTicks) * 100;
        if (cpuPercent < 1) continue;

        hotPaths.push({
          function: cf.functionName || '(anonymous)',
          file: relative(basedir, cf.url.replace('file://', '')),
          line: cf.lineNumber ?? 0,
          cpuPercent,
          callCount: node.hitCount,
        });
      }

      hotPaths.sort((a, b) => b.cpuPercent - a.cpuPercent);
      return hotPaths.slice(0, 20);
    } catch {
      return hotPaths;
    }
  }

  private profileGo(dir: string): HotPath[] {
    const hotPaths: HotPath[] = [];

    try {
      // Run go tool pprof on CPU profile if test benchmarks exist
      execSync(
        'go test -cpuprofile=.swarm/cpu.prof -bench=. -benchtime=2s ./... 2>&1 || true',
        { cwd: dir, timeout: 60000, encoding: 'utf-8', stdio: 'pipe' },
      );

      const profPath = join(dir, '.swarm', 'cpu.prof');
      if (existsSync(profPath)) {
        const topOutput = execSync(
          `go tool pprof -top -nodecount=20 .swarm/cpu.prof 2>/dev/null || true`,
          { cwd: dir, timeout: 15000, encoding: 'utf-8', stdio: 'pipe' },
        );

        // Parse "flat  flat%  sum%  cum  cum%  function" lines
        const lineRe = /^\s*([\d.]+\w*)\s+([\d.]+)%\s+[\d.]+%\s+[\d.]+\w*\s+[\d.]+%\s+(.+)$/gm;
        let m: RegExpExecArray | null;
        while ((m = lineRe.exec(topOutput))) {
          const funcName = m[3].trim();
          hotPaths.push({
            function: funcName,
            file: funcName.split('.')[0] || '',
            line: 0,
            cpuPercent: parseFloat(m[2]),
            callCount: 0,
          });
        }
      }
    } catch { /* profiling failed */ }

    return hotPaths.slice(0, 20);
  }

  private profilePython(dir: string): HotPath[] {
    const hotPaths: HotPath[] = [];

    try {
      // Use cProfile with a quick run
      const entryPoints = ['main.py', 'app.py', 'manage.py', 'src/main.py'];
      let entry: string | null = null;
      for (const ep of entryPoints) {
        if (existsSync(join(dir, ep))) {
          entry = ep;
          break;
        }
      }

      if (!entry) return hotPaths;

      const output = execSync(
        `python -m cProfile -s cumulative ${entry} 2>&1 | head -40 || true`,
        { cwd: dir, timeout: 15000, encoding: 'utf-8', stdio: 'pipe' },
      );

      // Parse cProfile output:  ncalls  tottime  percall  cumtime  percall filename:lineno(function)
      const lineRe = /^\s*(\d+)\s+([\d.]+)\s+[\d.]+\s+([\d.]+)\s+[\d.]+\s+(.+):(\d+)\((.+)\)/gm;
      let m: RegExpExecArray | null;
      const totalTime = parseFloat(output.match(/in ([\d.]+) seconds/)?.[1] ?? '1');

      while ((m = lineRe.exec(output))) {
        const cumTime = parseFloat(m[3]);
        const cpuPercent = totalTime > 0 ? (cumTime / totalTime) * 100 : 0;
        if (cpuPercent < 1) continue;

        hotPaths.push({
          function: m[6],
          file: m[4],
          line: parseInt(m[5]),
          cpuPercent,
          callCount: parseInt(m[1]),
        });
      }
    } catch { /* profiling failed */ }

    return hotPaths.sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 20);
  }

  private findFile(dir: string, name: string): string | null {
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.includes(name)) return join(dir, entry);
      }
    } catch { /* ignore */ }
    return null;
  }

  private dirSize(dir: string): number {
    let total = 0;
    try {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        try {
          const st = statSync(full);
          if (st.isDirectory()) {
            total += this.dirSize(full);
          } else {
            total += st.size;
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
    return total;
  }

  private loadReports(): OptimizeReport[] {
    const p = join(this.swarmDir, REPORTS_FILE);
    if (!existsSync(p)) return [];
    try {
      return JSON.parse(readFileSync(p, 'utf-8'));
    } catch {
      return [];
    }
  }

  private persistReport(report: OptimizeReport): void {
    const reports = this.loadReports();
    reports.push(report);
    // Keep last 30 reports
    const trimmed = reports.slice(-30);
    writeFileSync(join(this.swarmDir, REPORTS_FILE), JSON.stringify(trimmed, null, 2));
  }
}
