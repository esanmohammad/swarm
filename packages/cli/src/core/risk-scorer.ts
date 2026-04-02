import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, basename, extname } from 'node:path';
import { execSync } from 'node:child_process';

export interface RiskDimension {
  name: string;
  score: number;   // 0-100
  weight: number;  // 0-1
  detail: string;
}

export interface RiskScore {
  file: string;
  overall: number;  // 0-100 weighted composite
  level: 'low' | 'medium' | 'high' | 'critical';
  dimensions: RiskDimension[];
}

/** Patterns indicating core/critical files */
const CRITICAL_PATTERNS = [
  /auth/i, /login/i, /session/i, /token/i, /jwt/i, /oauth/i,
  /payment/i, /billing/i, /stripe/i, /checkout/i, /invoice/i,
  /database/i, /migration/i, /schema/i, /model/i,
  /security/i, /encrypt/i, /decrypt/i, /secret/i, /credential/i,
  /middleware/i, /guard/i, /permission/i, /rbac/i, /acl/i,
];

/** Patterns indicating high-risk infrastructure files */
const INFRA_PATTERNS = [
  /config/i, /env/i, /docker/i, /ci/i, /deploy/i, /pipeline/i,
  /webpack/i, /vite\.config/i, /tsconfig/i, /package\.json$/,
];

/** Common test file patterns */
const TEST_PATTERNS = [
  '.test.', '.spec.', '__tests__', '__test__',
  '.test.ts', '.test.tsx', '.test.js', '.test.jsx',
  '.spec.ts', '.spec.tsx', '.spec.js', '.spec.jsx',
];

export class RiskScorer {
  constructor(private cwd: string) {}

  /** Score a set of changed files */
  scoreFiles(files: string[]): RiskScore[] {
    return files.map(f => this.scoreFile(f)).sort((a, b) => b.overall - a.overall);
  }

  /** Score a single file */
  private scoreFile(file: string): RiskScore {
    const dimensions: RiskDimension[] = [
      { name: 'File Risk', score: this.fileRiskScore(file), weight: 0.25, detail: '' },
      { name: 'Coverage', score: this.coverageScore(file), weight: 0.20, detail: '' },
      { name: 'Blast Radius', score: this.blastRadiusScore(file), weight: 0.20, detail: '' },
      { name: 'Change History', score: this.changeHistoryScore(file), weight: 0.15, detail: '' },
      { name: 'Complexity', score: this.complexityScore(file), weight: 0.10, detail: '' },
      { name: 'Novelty', score: this.noveltyScore(file), weight: 0.10, detail: '' },
    ];

    const overall = Math.round(
      dimensions.reduce((sum, d) => sum + d.score * d.weight, 0),
    );

    const level = this.scoreToLevel(overall);

    return { file, overall, level, dimensions };
  }

  /** Detect core/critical files by path patterns */
  private fileRiskScore(file: string): number {
    const lower = file.toLowerCase();

    // Skip test files — they are low risk
    if (TEST_PATTERNS.some(p => lower.includes(p))) {
      return 5;
    }

    // Critical domain files
    const criticalMatches = CRITICAL_PATTERNS.filter(p => p.test(file));
    if (criticalMatches.length >= 2) return 95;
    if (criticalMatches.length === 1) return 75;

    // Infrastructure files
    const infraMatches = INFRA_PATTERNS.filter(p => p.test(file));
    if (infraMatches.length > 0) return 60;

    // Entry points
    if (/index\.[jt]sx?$/.test(file) || /main\.[jt]sx?$/.test(file) || /app\.[jt]sx?$/.test(file)) {
      return 50;
    }

    // Default: moderate risk
    return 25;
  }

  /** Check if test file exists — no test = higher risk */
  private coverageScore(file: string): number {
    const ext = extname(file);
    const base = basename(file, ext);
    const dir = dirname(file);
    const fullDir = join(this.cwd, dir);

    // Test files themselves have zero coverage risk
    if (TEST_PATTERNS.some(p => file.includes(p))) {
      return 0;
    }

    // Check common test file locations
    const testVariants = [
      join(fullDir, `${base}.test${ext}`),
      join(fullDir, `${base}.spec${ext}`),
      join(fullDir, '__tests__', `${base}${ext}`),
      join(fullDir, '__tests__', `${base}.test${ext}`),
      join(this.cwd, 'tests', dir, `${base}.test${ext}`),
      join(this.cwd, 'test', dir, `${base}.test${ext}`),
    ];

    for (const testPath of testVariants) {
      if (existsSync(testPath)) {
        return 15; // Has a test file — low risk
      }
    }

    return 85; // No test file found — high risk
  }

  /** Count importers of this file via grep */
  private blastRadiusScore(file: string): number {
    try {
      const relPath = file.replace(/\.[jt]sx?$/, '');
      const fileName = basename(relPath);

      // Search for imports of this file
      const result = execSync(
        `git grep -l --no-color -E "(import|require).*['\"].*${fileName}['\"]" -- "*.ts" "*.tsx" "*.js" "*.jsx" 2>/dev/null || true`,
        { cwd: this.cwd, encoding: 'utf-8', timeout: 10000 },
      ).trim();

      const importers = result ? result.split('\n').filter(l => l.trim().length > 0).length : 0;

      // Scale: 0 importers = 0, 1-2 = 20, 3-5 = 40, 6-10 = 60, 11-20 = 80, 20+ = 100
      if (importers === 0) return 0;
      if (importers <= 2) return 20;
      if (importers <= 5) return 40;
      if (importers <= 10) return 60;
      if (importers <= 20) return 80;
      return 100;
    } catch {
      return 30; // Default moderate if git grep fails
    }
  }

  /** Count recent commits touching this file (last 90 days) */
  private changeHistoryScore(file: string): number {
    try {
      const result = execSync(
        `git log --oneline --since="90 days ago" -- "${file}" 2>/dev/null | wc -l`,
        { cwd: this.cwd, encoding: 'utf-8', timeout: 10000 },
      ).trim();

      const commits = parseInt(result, 10) || 0;

      // Scale: 0-1 = 10, 2-5 = 30, 6-10 = 50, 11-20 = 70, 21-50 = 85, 50+ = 100
      if (commits <= 1) return 10;
      if (commits <= 5) return 30;
      if (commits <= 10) return 50;
      if (commits <= 20) return 70;
      if (commits <= 50) return 85;
      return 100;
    } catch {
      return 30; // Default moderate if git fails
    }
  }

  /** File size / line count as complexity proxy */
  private complexityScore(file: string): number {
    const fullPath = join(this.cwd, file);
    if (!existsSync(fullPath)) return 50; // Can't assess — moderate default

    try {
      const content = readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n').length;

      // Count nesting depth (braces, brackets for complexity)
      let maxDepth = 0;
      let currentDepth = 0;
      for (const char of content) {
        if (char === '{') {
          currentDepth++;
          if (currentDepth > maxDepth) maxDepth = currentDepth;
        } else if (char === '}') {
          currentDepth--;
        }
      }

      // Combine line count and nesting
      let lineScore: number;
      if (lines <= 50) lineScore = 10;
      else if (lines <= 150) lineScore = 25;
      else if (lines <= 300) lineScore = 45;
      else if (lines <= 500) lineScore = 65;
      else if (lines <= 1000) lineScore = 80;
      else lineScore = 95;

      let depthScore: number;
      if (maxDepth <= 3) depthScore = 10;
      else if (maxDepth <= 5) depthScore = 30;
      else if (maxDepth <= 8) depthScore = 55;
      else if (maxDepth <= 12) depthScore = 75;
      else depthScore = 95;

      return Math.round(lineScore * 0.6 + depthScore * 0.4);
    } catch {
      return 50;
    }
  }

  /** Is this a new file (no git history)? */
  private noveltyScore(file: string): number {
    try {
      const result = execSync(
        `git log --oneline -- "${file}" 2>/dev/null | wc -l`,
        { cwd: this.cwd, encoding: 'utf-8', timeout: 10000 },
      ).trim();

      const totalCommits = parseInt(result, 10) || 0;

      // Brand new (0-1 commits) = high risk, battle-tested = low
      if (totalCommits === 0) return 100; // Untracked / brand new
      if (totalCommits === 1) return 80;  // Just added
      if (totalCommits <= 3) return 55;   // Young
      if (totalCommits <= 10) return 30;  // Moderate history
      return 10; // Well-established
    } catch {
      return 70; // If we can't check, assume fairly new
    }
  }

  /** Map overall score to risk level */
  private scoreToLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score <= 25) return 'low';
    if (score <= 50) return 'medium';
    if (score <= 75) return 'high';
    return 'critical';
  }
}
