import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

export interface SecurityFinding {
  id: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  file: string;
  line: number;
  code: string;
  message: string;
  suggestion: string;
  cwe?: string;
}

export interface SecurityReport {
  findings: SecurityFinding[];
  summary: { critical: number; high: number; medium: number; low: number; info: number };
  scannedFiles: number;
  timestamp: number;
  durationMs: number;
}

interface PatternRule {
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  pattern: RegExp;
  message: string;
  suggestion: string;
  cwe?: string;
  /** Only match in these file extensions (without dot). If empty, match all. */
  extensions?: string[];
}

const SCAN_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.swift',
]);

const EXCLUDE_DIRS = new Set([
  'node_modules', 'dist', '.git', '.next', 'build', 'coverage',
  '__pycache__', '.tox', 'target', '.swarm', 'vendor',
]);

const PATTERN_RULES: PatternRule[] = [
  // --- SQL Injection ---
  {
    category: 'sql-injection',
    severity: 'critical',
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\s+.*["'`]\s*\+\s*/i,
    message: 'String concatenation in SQL query — potential SQL injection',
    suggestion: 'Use parameterized queries or prepared statements instead of string concatenation.',
    cwe: 'CWE-89',
  },
  {
    category: 'sql-injection',
    severity: 'critical',
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\s+.*\$\{/i,
    message: 'Template literal interpolation in SQL query — potential SQL injection',
    suggestion: 'Use parameterized queries or prepared statements instead of template literals.',
    cwe: 'CWE-89',
  },
  {
    category: 'sql-injection',
    severity: 'high',
    pattern: /\.(?:query|execute|raw)\s*\(\s*["'`].*\$\{/i,
    message: 'Dynamic query construction with interpolation',
    suggestion: 'Use parameterized queries (e.g., db.query("SELECT ?", [value])).',
    cwe: 'CWE-89',
  },

  // --- XSS ---
  {
    category: 'xss',
    severity: 'high',
    pattern: /\.innerHTML\s*=\s*(?!['"`]<)/,
    message: 'Direct innerHTML assignment — potential XSS',
    suggestion: 'Use textContent or a DOM sanitization library (e.g., DOMPurify).',
    cwe: 'CWE-79',
    extensions: ['ts', 'tsx', 'js', 'jsx'],
  },
  {
    category: 'xss',
    severity: 'high',
    pattern: /dangerouslySetInnerHTML/,
    message: 'dangerouslySetInnerHTML usage — potential XSS',
    suggestion: 'Sanitize HTML with DOMPurify before using dangerouslySetInnerHTML.',
    cwe: 'CWE-79',
    extensions: ['ts', 'tsx', 'js', 'jsx'],
  },
  {
    category: 'xss',
    severity: 'high',
    pattern: /document\.write\s*\(/,
    message: 'document.write usage — potential XSS vector',
    suggestion: 'Use DOM manipulation methods instead of document.write.',
    cwe: 'CWE-79',
    extensions: ['ts', 'tsx', 'js', 'jsx'],
  },

  // --- Hardcoded Secrets ---
  {
    category: 'hardcoded-secret',
    severity: 'critical',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{4,}/i,
    message: 'Possible hardcoded password',
    suggestion: 'Use environment variables or a secrets manager for credentials.',
    cwe: 'CWE-798',
  },
  {
    category: 'hardcoded-secret',
    severity: 'critical',
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["'][^"']{8,}/i,
    message: 'Possible hardcoded API key',
    suggestion: 'Store API keys in environment variables or a secrets manager.',
    cwe: 'CWE-798',
  },
  {
    category: 'hardcoded-secret',
    severity: 'critical',
    pattern: /(?:secret|token)\s*[:=]\s*["'][^"']{8,}/i,
    message: 'Possible hardcoded secret or token',
    suggestion: 'Use environment variables or a secrets manager.',
    cwe: 'CWE-798',
  },
  {
    category: 'hardcoded-secret',
    severity: 'critical',
    pattern: /AKIA[0-9A-Z]{16}/,
    message: 'AWS Access Key ID detected',
    suggestion: 'Remove the AWS key and rotate it immediately. Use IAM roles or environment variables.',
    cwe: 'CWE-798',
  },
  {
    category: 'hardcoded-secret',
    severity: 'critical',
    pattern: /ghp_[A-Za-z0-9]{36,}/,
    message: 'GitHub personal access token detected',
    suggestion: 'Remove and revoke the token. Use environment variables or GitHub Apps.',
    cwe: 'CWE-798',
  },
  {
    category: 'hardcoded-secret',
    severity: 'high',
    pattern: /(?:sk-|pk_live_|sk_live_)[A-Za-z0-9]{20,}/,
    message: 'Possible Stripe or OpenAI key detected',
    suggestion: 'Remove the key and rotate it. Use environment variables.',
    cwe: 'CWE-798',
  },

  // --- Path Traversal ---
  {
    category: 'path-traversal',
    severity: 'high',
    pattern: /req\.(?:params|query|body)\s*[\[.]\s*.*(?:readFile|readdir|createReadStream|access|stat|open|unlink|rmdir)/i,
    message: 'User input used in file system operation — potential path traversal',
    suggestion: 'Validate and sanitize paths. Use path.resolve() and verify the result stays within allowed directories.',
    cwe: 'CWE-22',
  },
  {
    category: 'path-traversal',
    severity: 'medium',
    pattern: /(?:readFile|writeFile|createReadStream|createWriteStream)\s*\(.*\.\.\//,
    message: 'Relative path with ../ in file operation',
    suggestion: 'Resolve paths with path.resolve() and ensure they stay within the intended directory.',
    cwe: 'CWE-22',
  },

  // --- Command Injection ---
  {
    category: 'command-injection',
    severity: 'critical',
    pattern: /(?:exec|execSync|spawn|spawnSync)\s*\(\s*(?:["'`].*\$\{|.*\+\s*(?:req\.|user|input|param|query|body))/i,
    message: 'Dynamic command execution with potential user input — command injection risk',
    suggestion: 'Use execFile/execFileSync with argument arrays instead of shell string concatenation.',
    cwe: 'CWE-78',
  },
  {
    category: 'command-injection',
    severity: 'high',
    pattern: /(?:exec|execSync)\s*\(\s*`[^`]*\$\{/,
    message: 'Template literal in exec/execSync — potential command injection',
    suggestion: 'Use execFile with an arguments array to avoid shell interpretation.',
    cwe: 'CWE-78',
  },

  // --- Eval Usage ---
  {
    category: 'eval-usage',
    severity: 'high',
    pattern: /\beval\s*\(/,
    message: 'eval() usage detected — potential code injection',
    suggestion: 'Avoid eval(). Use JSON.parse() for data, or safer alternatives for dynamic code.',
    cwe: 'CWE-95',
  },
  {
    category: 'eval-usage',
    severity: 'high',
    pattern: /new\s+Function\s*\(/,
    message: 'new Function() usage — equivalent to eval()',
    suggestion: 'Avoid dynamic code generation. Use static alternatives.',
    cwe: 'CWE-95',
  },
  {
    category: 'eval-usage',
    severity: 'medium',
    pattern: /setTimeout\s*\(\s*["'`]/,
    message: 'setTimeout with string argument — implicit eval()',
    suggestion: 'Pass a function reference to setTimeout instead of a string.',
    cwe: 'CWE-95',
  },

  // --- Insecure Crypto ---
  {
    category: 'insecure-crypto',
    severity: 'medium',
    pattern: /Math\.random\s*\(\s*\)/,
    message: 'Math.random() is not cryptographically secure',
    suggestion: 'Use crypto.randomBytes() or crypto.getRandomValues() for security-sensitive randomness.',
    cwe: 'CWE-338',
  },
  {
    category: 'insecure-crypto',
    severity: 'high',
    pattern: /createHash\s*\(\s*['"]md5['"]\s*\)/,
    message: 'MD5 hash detected — cryptographically broken',
    suggestion: 'Use SHA-256 or stronger hash algorithms. For passwords, use bcrypt or argon2.',
    cwe: 'CWE-328',
  },
  {
    category: 'insecure-crypto',
    severity: 'medium',
    pattern: /createHash\s*\(\s*['"]sha1['"]\s*\)/,
    message: 'SHA-1 hash detected — considered weak',
    suggestion: 'Use SHA-256 or stronger for new implementations.',
    cwe: 'CWE-328',
  },

  // --- Prototype Pollution ---
  {
    category: 'prototype-pollution',
    severity: 'high',
    pattern: /__proto__/,
    message: '__proto__ access detected — potential prototype pollution',
    suggestion: 'Use Object.create(null) for lookup objects. Validate and sanitize object keys.',
    cwe: 'CWE-1321',
  },
  {
    category: 'prototype-pollution',
    severity: 'medium',
    pattern: /Object\.assign\s*\(\s*\{\s*\}\s*,\s*(?:req\.|user|input|param|query|body)/i,
    message: 'Object.assign with user input — potential prototype pollution',
    suggestion: 'Use a safe deep-clone library or validate input keys before merging.',
    cwe: 'CWE-1321',
  },

  // --- SSRF ---
  {
    category: 'ssrf',
    severity: 'high',
    pattern: /(?:fetch|axios\.get|axios\.post|http\.get|https\.get|got|request)\s*\(\s*(?:req\.|user|input|param|query|body)/i,
    message: 'HTTP request with user-controlled URL — potential SSRF',
    suggestion: 'Validate and allowlist URLs. Block internal/private IP ranges.',
    cwe: 'CWE-918',
  },
  {
    category: 'ssrf',
    severity: 'medium',
    pattern: /(?:fetch|axios|got|request)\s*\(\s*`[^`]*\$\{/,
    message: 'HTTP request with template literal URL — potential SSRF',
    suggestion: 'Validate URLs against an allowlist before making requests.',
    cwe: 'CWE-918',
  },

  // --- Insecure Headers ---
  {
    category: 'insecure-headers',
    severity: 'medium',
    pattern: /Access-Control-Allow-Origin['":\s]*['"]\*['"]/i,
    message: 'Wildcard CORS origin — allows any domain',
    suggestion: 'Restrict CORS to specific trusted origins.',
    cwe: 'CWE-942',
  },
  {
    category: 'insecure-headers',
    severity: 'info',
    pattern: /(?:helmet|csp|Content-Security-Policy)/i,
    message: 'CSP/security headers configuration found',
    suggestion: 'Verify Content-Security-Policy is properly configured.',
    cwe: 'CWE-693',
  },
];

let findingCounter = 0;

function nextId(): string {
  findingCounter++;
  return `SEC-${String(findingCounter).padStart(4, '0')}`;
}

export class SecurityScanner {
  constructor(private cwd: string) {}

  scan(opts?: { files?: string[]; full?: boolean }): SecurityReport {
    findingCounter = 0;
    const startTime = Date.now();
    const files = opts?.files ?? this.getSourceFiles();
    const findings: SecurityFinding[] = [];

    for (const file of files) {
      try {
        findings.push(...this.scanFile(file));
      } catch {
        // Skip files that can't be read
      }
    }

    // Sort by severity
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    findings.sort((a, b) => (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5));

    const summary = {
      critical: findings.filter(f => f.severity === 'critical').length,
      high: findings.filter(f => f.severity === 'high').length,
      medium: findings.filter(f => f.severity === 'medium').length,
      low: findings.filter(f => f.severity === 'low').length,
      info: findings.filter(f => f.severity === 'info').length,
    };

    return {
      findings,
      summary,
      scannedFiles: files.length,
      timestamp: Date.now(),
      durationMs: Date.now() - startTime,
    };
  }

  private scanFile(filePath: string): SecurityFinding[] {
    const absPath = filePath.startsWith('/') ? filePath : join(this.cwd, filePath);
    if (!existsSync(absPath)) return [];

    const content = readFileSync(absPath, 'utf-8');
    const lines = content.split('\n');
    const ext = extname(filePath).replace('.', '');
    const relPath = filePath.startsWith('/') ? relative(this.cwd, filePath) : filePath;
    const findings: SecurityFinding[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comment-only lines
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        continue;
      }

      for (const rule of PATTERN_RULES) {
        // Skip if rule is extension-restricted and file doesn't match
        if (rule.extensions && rule.extensions.length > 0 && !rule.extensions.includes(ext)) {
          continue;
        }

        if (rule.pattern.test(line)) {
          findings.push({
            id: nextId(),
            category: rule.category,
            severity: rule.severity,
            file: relPath,
            line: i + 1,
            code: line.trim().substring(0, 200),
            message: rule.message,
            suggestion: rule.suggestion,
            cwe: rule.cwe,
          });
        }
      }
    }

    return findings;
  }

  private getSourceFiles(): string[] {
    const files: string[] = [];
    this.walkDir(this.cwd, files);
    return files;
  }

  private walkDir(dir: string, files: string[], depth = 0): void {
    if (depth > 15) return; // Prevent overly deep recursion

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (EXCLUDE_DIRS.has(entry)) continue;
      if (entry.startsWith('.') && entry !== '.') continue;

      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        this.walkDir(fullPath, files, depth + 1);
      } else if (stat.isFile() && SCAN_EXTENSIONS.has(extname(entry))) {
        files.push(relative(this.cwd, fullPath));
      }
    }
  }
}
