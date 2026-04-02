import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execSync } from 'node:child_process';

export type CodeOrigin = 'ai' | 'human' | 'mixed';

export interface FileFingerprint {
  file: string;
  origin: CodeOrigin;
  confidence: number;    // 0-100
  aiPercentage: number;  // 0-100, estimated % of AI-generated lines
  indicators: string[];  // why we think it's AI
  lastModified: string;
  model?: string;        // which model generated it (from provenance)
}

export interface FingerprintReport {
  files: FileFingerprint[];
  summary: {
    totalFiles: number;
    aiFiles: number;
    humanFiles: number;
    mixedFiles: number;
    aiLinesEstimate: number;
    totalLines: number;
  };
  timestamp: number;
}

/** Source file extensions to scan */
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.swift', '.java', '.kt',
  '.c', '.cpp', '.h', '.hpp', '.cs',
  '.rb', '.php', '.vue', '.svelte',
  '.css', '.scss', '.less',
  '.html', '.yml', '.yaml', '.json',
  '.sh', '.bash', '.zsh',
  '.md', '.mdx',
]);

/** Directories to skip */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next',
  '__pycache__', '.venv', 'venv', 'target', '.swarm',
  'vendor', 'coverage', '.turbo', '.cache',
]);

export class CodeFingerprinter {
  constructor(private cwd: string, private swarmDir: string) {}

  /** Fingerprint all source files or a subset */
  scan(opts?: { files?: string[] }): FingerprintReport {
    const files = opts?.files?.length
      ? opts.files.map(f => (f.startsWith('/') ? relative(this.cwd, f) : f))
      : this.collectSourceFiles(this.cwd);

    const fingerprints: FileFingerprint[] = [];
    let totalLines = 0;
    let aiLinesEstimate = 0;

    for (const file of files) {
      const fp = this.fingerprintFile(file);
      if (fp) {
        fingerprints.push(fp);
        const absPath = join(this.cwd, file);
        try {
          const content = readFileSync(absPath, 'utf-8');
          const lineCount = content.split('\n').length;
          totalLines += lineCount;
          aiLinesEstimate += Math.round(lineCount * (fp.aiPercentage / 100));
        } catch {
          // skip unreadable
        }
      }
    }

    // Sort by confidence descending
    fingerprints.sort((a, b) => b.confidence - a.confidence);

    const aiFiles = fingerprints.filter(f => f.origin === 'ai').length;
    const humanFiles = fingerprints.filter(f => f.origin === 'human').length;
    const mixedFiles = fingerprints.filter(f => f.origin === 'mixed').length;

    return {
      files: fingerprints,
      summary: {
        totalFiles: fingerprints.length,
        aiFiles,
        humanFiles,
        mixedFiles,
        aiLinesEstimate,
        totalLines,
      },
      timestamp: Date.now(),
    };
  }

  /** Fingerprint a single file */
  private fingerprintFile(filePath: string): FileFingerprint | null {
    const absPath = join(this.cwd, filePath);
    if (!existsSync(absPath)) return null;

    let content: string;
    try {
      content = readFileSync(absPath, 'utf-8');
    } catch {
      return null;
    }

    const stat = statSync(absPath);
    const indicators: string[] = [];
    let score = 0;
    let model: string | undefined;

    // Check git trailers
    const trailerInfo = this.checkGitTrailers(filePath);
    if (trailerInfo.hasAiCommits) {
      score += 40;
      indicators.push('Git commit has AI/swarm trailer');
      if (trailerInfo.model) model = trailerInfo.model;
    }

    // Check provenance records
    const provenance = this.checkProvenance(filePath);
    if (provenance.found) {
      score += 35;
      indicators.push('Provenance record found in .swarm/provenance/');
      if (provenance.model && !model) model = provenance.model;
    }

    // Heuristic analysis
    const heuristic = this.heuristicCheck(content);
    score += heuristic.score;
    indicators.push(...heuristic.indicators);

    // Clamp score
    const confidence = Math.min(100, Math.max(0, score));

    // Determine origin
    let origin: CodeOrigin;
    if (confidence >= 70) {
      origin = 'ai';
    } else if (confidence >= 30) {
      origin = 'mixed';
    } else {
      origin = 'human';
    }

    // Estimate AI percentage based on confidence and origin
    let aiPercentage: number;
    if (origin === 'ai') {
      aiPercentage = Math.min(100, 60 + Math.round((confidence - 70) * (40 / 30)));
    } else if (origin === 'mixed') {
      aiPercentage = Math.round(30 + ((confidence - 30) / 40) * 30);
    } else {
      aiPercentage = Math.max(0, Math.round(confidence * 0.3));
    }

    return {
      file: filePath,
      origin,
      confidence,
      aiPercentage,
      indicators,
      lastModified: stat.mtime.toISOString(),
      model,
    };
  }

  /** Check git history for AI commit trailers */
  private checkGitTrailers(filePath: string): { hasAiCommits: boolean; model?: string } {
    try {
      const log = execSync(
        `git log --format="%B" -5 -- "${filePath}" 2>/dev/null`,
        { cwd: this.cwd, encoding: 'utf-8', timeout: 5000 },
      ).trim();

      if (!log) return { hasAiCommits: false };

      // Look for common AI generation markers in commit messages
      const aiPatterns = [
        /Generated-By:\s*swarm\/?(\S*)/i,
        /Co-Authored-By:.*Claude/i,
        /Co-Authored-By:.*anthropic/i,
        /\[ai[- ]generated\]/i,
        /\[swarm\]/i,
        /Generated-By:\s*claude/i,
      ];

      let model: string | undefined;
      let hasAiCommits = false;

      for (const pattern of aiPatterns) {
        const match = log.match(pattern);
        if (match) {
          hasAiCommits = true;
          if (match[1]) model = match[1];
          break;
        }
      }

      // Extract model from Co-Authored-By if present
      if (hasAiCommits && !model) {
        const modelMatch = log.match(/Co-Authored-By:.*Claude\s+(\w+)/i);
        if (modelMatch) model = modelMatch[1].toLowerCase();
      }

      return { hasAiCommits, model };
    } catch {
      return { hasAiCommits: false };
    }
  }

  /** Check provenance records in .swarm/provenance/ */
  private checkProvenance(filePath: string): { found: boolean; model?: string } {
    const provenanceDir = join(this.swarmDir, 'provenance');
    if (!existsSync(provenanceDir)) return { found: false };

    try {
      const entries = readdirSync(provenanceDir).filter(f => f.endsWith('.json') || f.endsWith('.jsonl'));

      for (const entry of entries) {
        const content = readFileSync(join(provenanceDir, entry), 'utf-8');

        // Check each line (supports JSONL)
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          if (line.includes(filePath)) {
            try {
              const record = JSON.parse(line);
              return { found: true, model: record.model || record.agent?.model };
            } catch {
              return { found: true };
            }
          }
        }
      }
    } catch {
      // ignore read errors
    }

    return { found: false };
  }

  /** Heuristic detection for AI-generated code patterns */
  private heuristicCheck(content: string): { score: number; indicators: string[] } {
    const indicators: string[] = [];
    let score = 0;
    const lines = content.split('\n');
    const nonEmptyLines = lines.filter(l => l.trim().length > 0);

    if (nonEmptyLines.length < 5) return { score: 0, indicators: [] };

    // 1. Verbose JSDoc/docstrings on most functions
    const funcCount = (content.match(/(?:function |const \w+ = (?:async )?\(|(?:async )?(?:get|set|public|private|protected)?\s+\w+\s*\()/g) || []).length;
    const jsdocCount = (content.match(/\/\*\*[\s\S]*?\*\//g) || []).length;

    if (funcCount > 2 && jsdocCount >= funcCount * 0.7) {
      score += 10;
      indicators.push('JSDoc on most functions');
    }

    // 2. AI assistant language in comments
    const aiCommentPatterns = [
      /\/\/.*\b(?:Here's|Let me|I'll|I've|I would|As requested)\b/i,
      /\/\/.*\b(?:This function|This method|This class|This module)\s+(?:handles|manages|provides|implements|creates|returns)/i,
      /#.*\b(?:Here's|Let me|I'll|I've|I would|As requested)\b/i,
    ];
    for (const pattern of aiCommentPatterns) {
      if (pattern.test(content)) {
        score += 8;
        indicators.push('AI-like language in comments');
        break;
      }
    }

    // 3. Consistent error handling — try/catch on most functions
    const tryCount = (content.match(/\btry\s*\{/g) || []).length;
    if (funcCount > 2 && tryCount >= funcCount * 0.6) {
      score += 7;
      indicators.push('try/catch on most functions');
    }

    // 4. Overly descriptive variable names (camelCase with 4+ words)
    const longVarNames = content.match(/\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+){3,}\b/g) || [];
    if (longVarNames.length >= 5) {
      score += 6;
      indicators.push('Very long descriptive variable names');
    }

    // 5. Perfect consistent indentation (no mixed tabs/spaces)
    const indentedLines = nonEmptyLines.filter(l => /^\s+/.test(l));
    const tabLines = indentedLines.filter(l => l.startsWith('\t'));
    const spaceLines = indentedLines.filter(l => l.startsWith(' '));
    if (indentedLines.length > 10 && (tabLines.length === 0 || spaceLines.length === 0)) {
      // Perfectly consistent — not a strong signal alone but contributes
      score += 3;
      indicators.push('Perfectly consistent indentation');
    }

    // 6. Excessive type annotations (TypeScript-specific)
    const typeAnnotations = (content.match(/:\s*(?:string|number|boolean|void|any|unknown|never)\b/g) || []).length;
    if (typeAnnotations > nonEmptyLines.length * 0.15 && typeAnnotations > 10) {
      score += 5;
      indicators.push('Excessive type annotations');
    }

    // 7. Formulaic comment structure (// --- Section --- patterns)
    const sectionComments = (content.match(/\/\/\s*-{3,}\s*.+\s*-{3,}/g) || []).length;
    if (sectionComments >= 3) {
      score += 5;
      indicators.push('Formulaic section comment markers');
    }

    // 8. Repeated patterns that suggest template generation
    const importLines = lines.filter(l => /^\s*import\s/.test(l));
    if (importLines.length > 5) {
      // Check if imports follow very consistent pattern (same structure)
      const importStyles = new Set(importLines.map(l =>
        l.replace(/['"].*['"]/, '""').replace(/\b\w+\b/g, 'X')
      ));
      if (importStyles.size <= 2 && importLines.length >= 8) {
        score += 4;
        indicators.push('Highly uniform import style');
      }
    }

    return { score, indicators };
  }

  /** Recursively collect source files */
  private collectSourceFiles(dir: string, base?: string): string[] {
    const files: string[] = [];
    const baseDir = base || dir;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return files;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;

      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        files.push(...this.collectSourceFiles(fullPath, baseDir));
      } else if (stat.isFile()) {
        const ext = extname(entry);
        if (SOURCE_EXTENSIONS.has(ext)) {
          files.push(relative(baseDir, fullPath));
        }
      }
    }

    return files;
  }
}
