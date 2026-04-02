import { watch, readFileSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export interface PairSuggestion {
  id: string;
  type: 'bug' | 'pattern' | 'test-gap' | 'security' | 'import' | 'co-change';
  file: string;
  line?: number;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: number;
  accepted?: boolean;
}

export interface PairSession {
  id: string;
  startedAt: number;
  mode: 'suggest' | 'assist' | 'silent';
  focusDir?: string;
  filesWatched: number;
  suggestions: PairSuggestion[];
  changedFiles: string[];
}

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs']);
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.swarm', '.next',
  '__pycache__', '.venv', 'venv', 'target', '.build', 'coverage', '.cache', '.turbo',
]);

const DEBOUNCE_MS = 2000;

export class PairEngine extends EventEmitter {
  private session: PairSession;
  private watchers: Map<string, ReturnType<typeof watch>> = new Map();
  private fileSnapshots: Map<string, string> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private cwd: string;

  constructor(cwd: string, options: { mode: 'suggest' | 'assist' | 'silent'; focusDir?: string }) {
    super();
    this.cwd = cwd;
    this.session = {
      id: randomUUID(),
      startedAt: Date.now(),
      mode: options.mode,
      focusDir: options.focusDir,
      filesWatched: 0,
      suggestions: [],
      changedFiles: [],
    };
  }

  start(): void {
    const watchDir = this.session.focusDir
      ? join(this.cwd, this.session.focusDir)
      : this.cwd;

    this.watchDirectory(watchDir);
  }

  stop(): PairSession {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    this.emit('session-end', this.session);
    return { ...this.session };
  }

  getSession(): PairSession {
    return { ...this.session };
  }

  acceptSuggestion(id: string): void {
    const suggestion = this.session.suggestions.find(s => s.id === id);
    if (suggestion) {
      suggestion.accepted = true;
    }
  }

  dismissSuggestion(id: string): void {
    const suggestion = this.session.suggestions.find(s => s.id === id);
    if (suggestion) {
      suggestion.accepted = false;
    }
  }

  private watchDirectory(dir: string): void {
    if (!existsSync(dir)) return;

    try {
      const watcher = watch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const fullPath = join(dir, filename);
        const ext = extname(filename);

        // Skip non-source files
        if (!SOURCE_EXTS.has(ext)) return;

        // Skip ignored directories
        const parts = filename.split('/');
        if (parts.some(p => IGNORE_DIRS.has(p))) return;

        // Debounce per file
        const existing = this.debounceTimers.get(fullPath);
        if (existing) clearTimeout(existing);

        this.debounceTimers.set(fullPath, setTimeout(() => {
          this.debounceTimers.delete(fullPath);
          this.handleFileChange(fullPath);
        }, DEBOUNCE_MS));
      });

      this.watchers.set(dir, watcher);
      this.session.filesWatched++;
    } catch {
      // Directory may not be watchable — ignore
    }
  }

  private handleFileChange(filePath: string): void {
    if (!existsSync(filePath)) return;

    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      return;
    }

    const relPath = relative(this.cwd, filePath);
    const previousContent = this.fileSnapshots.get(filePath) || '';
    this.fileSnapshots.set(filePath, content);

    // Track changed files
    if (!this.session.changedFiles.includes(relPath)) {
      this.session.changedFiles.push(relPath);
    }

    this.emit('file-change', { file: relPath, timestamp: Date.now() });

    // Skip analysis on first snapshot (no previous to compare)
    if (!previousContent) return;

    // Run analysis checks
    const newLines = this.getNewLines(previousContent, content);
    if (newLines.length === 0) return;

    this.checkBugs(relPath, content, newLines);
    this.checkPatterns(relPath, content, newLines);
    this.checkTestGaps(relPath, content, newLines);
    this.checkSecurity(relPath, content, newLines);
    this.checkImports(relPath, content);
    this.checkCoChange(relPath);
  }

  private getNewLines(previous: string, current: string): Array<{ line: number; text: string }> {
    const prevLines = previous.split('\n');
    const currLines = current.split('\n');
    const newLines: Array<{ line: number; text: string }> = [];

    for (let i = 0; i < currLines.length; i++) {
      if (i >= prevLines.length || currLines[i] !== prevLines[i]) {
        newLines.push({ line: i + 1, text: currLines[i] });
      }
    }

    return newLines;
  }

  private addSuggestion(suggestion: Omit<PairSuggestion, 'id' | 'timestamp'>): void {
    const full: PairSuggestion = {
      ...suggestion,
      id: randomUUID(),
      timestamp: Date.now(),
    };

    this.session.suggestions.push(full);
    this.emit('suggestion', full);
  }

  private checkBugs(file: string, content: string, newLines: Array<{ line: number; text: string }>): void {
    for (const { line, text } of newLines) {
      // console.log left in code
      if (/console\.log\(/.test(text) && !/\/\//.test(text.split('console.log')[0])) {
        this.addSuggestion({
          type: 'bug',
          file,
          line,
          message: 'console.log() detected — consider removing before commit',
          severity: 'warning',
        });
      }

      // Missing null check on optional chain result used directly
      if (/\?\.\w+\(/.test(text) && !/if\s*\(/.test(text) && !/\?\?/.test(text) && !/\?\..*\?\./g.test(text)) {
        // Heuristic: optional chain call without null coalescing or guard
      }

      // Empty catch blocks
      if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(text)) {
        this.addSuggestion({
          type: 'bug',
          file,
          line,
          message: 'Empty catch block — errors will be silently swallowed',
          severity: 'warning',
        });
      }

      // TODO/FIXME left in new code
      if (/\/\/\s*(TODO|FIXME|HACK|XXX)\b/i.test(text)) {
        this.addSuggestion({
          type: 'bug',
          file,
          line,
          message: `${text.match(/TODO|FIXME|HACK|XXX/i)?.[0]} marker detected in new code`,
          severity: 'info',
        });
      }
    }
  }

  private checkPatterns(file: string, content: string, newLines: Array<{ line: number; text: string }>): void {
    for (const { line, text } of newLines) {
      // Try without catch
      if (/\btry\s*\{/.test(text)) {
        const lines = content.split('\n');
        let braceCount = 0;
        let foundCatch = false;
        for (let i = line - 1; i < Math.min(line + 30, lines.length); i++) {
          braceCount += (lines[i].match(/\{/g) || []).length;
          braceCount -= (lines[i].match(/\}/g) || []).length;
          if (/\bcatch\b/.test(lines[i])) {
            foundCatch = true;
            break;
          }
          if (braceCount <= 0 && i > line - 1) break;
        }
        if (!foundCatch) {
          this.addSuggestion({
            type: 'pattern',
            file,
            line,
            message: 'try block without catch — consider adding error handling',
            severity: 'warning',
          });
        }
      }

      // Inconsistent naming: camelCase function with snake_case variable
      const funcMatch = text.match(/(?:function|const|let|var)\s+([a-z][a-zA-Z0-9]*_[a-zA-Z0-9]+)/);
      if (funcMatch && (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx'))) {
        this.addSuggestion({
          type: 'pattern',
          file,
          line,
          message: `snake_case identifier "${funcMatch[1]}" in a camelCase codebase`,
          severity: 'info',
        });
      }
    }
  }

  private checkTestGaps(file: string, _content: string, newLines: Array<{ line: number; text: string }>): void {
    // Only check non-test source files
    if (/\.(test|spec)\.[jt]sx?$/.test(file) || /__(tests|mocks)__/.test(file)) return;

    for (const { line, text } of newLines) {
      // New exported function
      const exportMatch = text.match(/export\s+(?:async\s+)?function\s+(\w+)/);
      if (exportMatch) {
        this.addSuggestion({
          type: 'test-gap',
          file,
          line,
          message: `New exported function "${exportMatch[1]}" — ensure test coverage exists`,
          severity: 'info',
        });
      }
    }
  }

  private checkSecurity(file: string, _content: string, newLines: Array<{ line: number; text: string }>): void {
    for (const { line, text } of newLines) {
      // eval usage
      if (/\beval\s*\(/.test(text)) {
        this.addSuggestion({
          type: 'security',
          file,
          line,
          message: 'eval() usage detected — potential code injection vulnerability',
          severity: 'critical',
        });
      }

      // innerHTML
      if (/\.innerHTML\s*=/.test(text)) {
        this.addSuggestion({
          type: 'security',
          file,
          line,
          message: 'innerHTML assignment — risk of XSS. Consider using textContent or a sanitizer',
          severity: 'critical',
        });
      }

      // SQL string concatenation
      if (/(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE).*\+\s*(?:\w+|`|\$\{)/.test(text) ||
          /(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE).*\$\{/.test(text)) {
        this.addSuggestion({
          type: 'security',
          file,
          line,
          message: 'Possible SQL injection — use parameterized queries instead of string concatenation',
          severity: 'critical',
        });
      }

      // Hardcoded secrets (basic)
      if (/(?:password|secret|api_key|apikey|token)\s*[:=]\s*['"][^'"]{8,}['"]/i.test(text)) {
        this.addSuggestion({
          type: 'security',
          file,
          line,
          message: 'Possible hardcoded secret — use environment variables instead',
          severity: 'critical',
        });
      }
    }
  }

  private checkImports(file: string, content: string): void {
    if (!(file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx'))) return;

    const lines = content.split('\n');
    const importedNames: Array<{ name: string; line: number }> = [];

    for (let i = 0; i < lines.length; i++) {
      const importMatch = lines[i].match(/import\s+\{([^}]+)\}\s+from/);
      if (importMatch) {
        const names = importMatch[1].split(',').map(n => n.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean);
        for (const name of names) {
          importedNames.push({ name, line: i + 1 });
        }
      }
    }

    // Check if imported names are used in the rest of the file
    const contentWithoutImports = lines
      .filter(l => !l.trim().startsWith('import '))
      .join('\n');

    for (const { name, line } of importedNames) {
      // Simple heuristic: check if name appears outside import lines
      const regex = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (!regex.test(contentWithoutImports)) {
        this.addSuggestion({
          type: 'import',
          file,
          line,
          message: `Import "${name}" appears unused`,
          severity: 'info',
        });
      }
    }
  }

  private checkCoChange(changedFile: string): void {
    // Co-change heuristics based on file naming patterns
    const coChangeMap: Array<{ pattern: RegExp; suggest: (file: string) => string; message: string }> = [
      {
        pattern: /^(.+)\.ts$/,
        suggest: (f) => f.replace(/\.ts$/, '.test.ts'),
        message: 'Source file changed — consider updating its test file',
      },
      {
        pattern: /types\.ts$/,
        suggest: () => '../dashboard/src/types.ts',
        message: 'CLI types changed — remember to sync dashboard types (mirrored copy)',
      },
      {
        pattern: /\.tsx$/,
        suggest: (f) => f.replace(/\.tsx$/, '.test.tsx'),
        message: 'Component changed — consider updating its test file',
      },
    ];

    for (const rule of coChangeMap) {
      if (rule.pattern.test(changedFile)) {
        const suggested = rule.suggest(changedFile);
        // Only suggest if we haven't already changed the suggested file
        if (!this.session.changedFiles.includes(suggested)) {
          this.addSuggestion({
            type: 'co-change',
            file: changedFile,
            message: `${rule.message} (${suggested})`,
            severity: 'info',
          });
        }
      }
    }
  }
}
