import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';

export interface SecretFinding {
  type: string;
  file: string;
  line: number;
  match: string;
  severity: 'critical' | 'high' | 'medium';
  message: string;
}

interface SecretPattern {
  type: string;
  regex: RegExp;
  severity: 'critical' | 'high' | 'medium';
  message: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    type: 'aws-key',
    regex: /AKIA[0-9A-Z]{16}/,
    severity: 'critical',
    message: 'AWS Access Key ID detected',
  },
  {
    type: 'aws-secret',
    regex: /aws_secret[_a-zA-Z]*\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/i,
    severity: 'critical',
    message: 'AWS Secret Access Key detected',
  },
  {
    type: 'github-token',
    regex: /ghp_[A-Za-z0-9]{36}/,
    severity: 'critical',
    message: 'GitHub Personal Access Token detected',
  },
  {
    type: 'github-token',
    regex: /github_pat_[A-Za-z0-9_]{82}/,
    severity: 'critical',
    message: 'GitHub Fine-grained Personal Access Token detected',
  },
  {
    type: 'github-token',
    regex: /gh[ors]_[A-Za-z0-9]{36}/,
    severity: 'critical',
    message: 'GitHub OAuth/App token detected',
  },
  {
    type: 'stripe-key',
    regex: /sk_live_[A-Za-z0-9]{24,}/,
    severity: 'critical',
    message: 'Stripe Secret Key detected',
  },
  {
    type: 'stripe-key',
    regex: /pk_live_[A-Za-z0-9]{24,}/,
    severity: 'high',
    message: 'Stripe Publishable Key (live) detected',
  },
  {
    type: 'google-api-key',
    regex: /AIza[A-Za-z0-9_-]{35}/,
    severity: 'high',
    message: 'Google API Key detected',
  },
  {
    type: 'private-key',
    regex: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/,
    severity: 'critical',
    message: 'Private key detected',
  },
  {
    type: 'jwt',
    regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    severity: 'high',
    message: 'JSON Web Token detected',
  },
  {
    type: 'database-url',
    regex: /(postgres|mysql|mongodb):\/\/[^:]+:[^@]+@/,
    severity: 'critical',
    message: 'Database connection string with credentials detected',
  },
  {
    type: 'generic-api-key',
    regex: /(api[_-]?key|apikey|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"][A-Za-z0-9]{16,}['"]/i,
    severity: 'high',
    message: 'Hardcoded API key or secret detected',
  },
  {
    type: 'slack-token',
    regex: /xox[bpsa]-[A-Za-z0-9-]+/,
    severity: 'high',
    message: 'Slack token detected',
  },
  {
    type: 'sendgrid',
    regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/,
    severity: 'high',
    message: 'SendGrid API key detected',
  },
  {
    type: 'twilio',
    regex: /SK[a-f0-9]{32}/,
    severity: 'high',
    message: 'Twilio API key detected',
  },
  {
    type: 'generic-secret',
    regex: /(password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    severity: 'medium',
    message: 'Hardcoded password detected',
  },
];

/** Files that should be covered by .gitignore */
const GITIGNORE_EXPECTED = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  'credentials.json',
  'service-account.json',
];

/** Directories to always skip */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.swarm', 'coverage', '.next', '__pycache__']);

/** File extensions to scan (text-based files) */
const SCANNABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.swift', '.java', '.kt',
  '.json', '.yaml', '.yml', '.toml', '.xml',
  '.env', '.cfg', '.conf', '.ini', '.properties',
  '.sh', '.bash', '.zsh', '.fish',
  '.sql', '.graphql', '.gql',
  '.tf', '.tfvars',
  '.dockerfile', '',
  '.md', '.txt',
]);

function isTestFile(filePath: string): boolean {
  const name = basename(filePath);
  if (/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/.test(name)) return true;
  if (filePath.includes('__tests__/') || filePath.includes('__mocks__/')) return true;
  return false;
}

function isExampleFile(filePath: string): boolean {
  const name = basename(filePath);
  return /\.(example|sample)$/.test(name);
}

function isCommentWithPlaceholder(line: string): boolean {
  const lower = line.toLowerCase();
  // Check if line has a comment marker and placeholder-like words
  const hasComment = /\/\/|\/\*|#|<!--/.test(line);
  const hasPlaceholder = /(example|placeholder|dummy|test|fake|mock|sample|xxx|todo|fixme)/.test(lower);
  return hasComment && hasPlaceholder;
}

function redact(match: string): string {
  if (match.length <= 8) return '****';
  return match.slice(0, 4) + '...' + match.slice(-4);
}

export class SecretDetector {
  constructor(private cwd: string) {}

  /** Recursively collect files to scan */
  private collectFiles(dir: string, files: string[]): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;

      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        this.collectFiles(fullPath, files);
      } else if (stat.isFile()) {
        const ext = extname(entry).toLowerCase();
        const name = basename(entry).toLowerCase();
        // Include files with scannable extensions, or dotfiles like .env
        if (SCANNABLE_EXTENSIONS.has(ext) || name.startsWith('.env') || name === 'dockerfile') {
          files.push(fullPath);
        }
      }
    }
  }

  /** Scan files for hardcoded secrets */
  scan(opts?: { files?: string[]; includeTests?: boolean }): SecretFinding[] {
    const includeTests = opts?.includeTests ?? false;
    let files: string[];

    if (opts?.files && opts.files.length > 0) {
      files = opts.files.map(f => (f.startsWith('/') ? f : join(this.cwd, f)));
    } else {
      files = [];
      this.collectFiles(this.cwd, files);
    }

    const findings: SecretFinding[] = [];

    for (const filePath of files) {
      const relPath = relative(this.cwd, filePath);

      // Skip test/example files unless opted in
      if (!includeTests && isTestFile(relPath)) continue;
      if (isExampleFile(relPath)) continue;

      let content: string;
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      // Skip binary-looking files
      if (content.includes('\0')) continue;

      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip lines with placeholder-like comments
        if (isCommentWithPlaceholder(line)) continue;

        for (const pattern of SECRET_PATTERNS) {
          // Skip generic password pattern for test files even if includeTests is true
          if (pattern.type === 'generic-secret' && isTestFile(relPath)) continue;

          const match = line.match(pattern.regex);
          if (match) {
            findings.push({
              type: pattern.type,
              file: relPath,
              line: i + 1,
              match: redact(match[0]),
              severity: pattern.severity,
              message: pattern.message,
            });
          }
        }
      }
    }

    return findings;
  }

  /** Check if .gitignore covers common secret files */
  checkGitignore(): { covered: string[]; missing: string[] } {
    const gitignorePath = join(this.cwd, '.gitignore');
    let gitignoreContent = '';

    if (existsSync(gitignorePath)) {
      try {
        gitignoreContent = readFileSync(gitignorePath, 'utf-8');
      } catch {
        // If we can't read it, treat as empty
      }
    }

    const lines = gitignoreContent
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));

    const covered: string[] = [];
    const missing: string[] = [];

    for (const expected of GITIGNORE_EXPECTED) {
      // Check if any gitignore line would cover this pattern
      const isCovered = lines.some(line => {
        // Exact match
        if (line === expected) return true;
        // Wildcard pattern match (simple check)
        if (expected.includes('*')) {
          // e.g., .env.* should be covered by .env* or .env.* or .env.local etc.
          const prefix = expected.replace('*', '');
          return lines.some(l => l.startsWith(prefix) || l === expected);
        }
        // Check if a broader pattern covers it (e.g., *.pem covers all .pem)
        if (expected.startsWith('*.')) {
          const ext = expected.slice(1); // e.g., ".pem"
          return line === expected || line === `*${ext}`;
        }
        return false;
      });

      if (isCovered) {
        covered.push(expected);
      } else {
        missing.push(expected);
      }
    }

    // Special check: .npmrc with authToken
    const npmrcPath = join(this.cwd, '.npmrc');
    if (existsSync(npmrcPath)) {
      try {
        const npmrcContent = readFileSync(npmrcPath, 'utf-8');
        if (npmrcContent.includes('authToken') || npmrcContent.includes('_auth')) {
          const npmrcCovered = lines.some(l => l === '.npmrc');
          if (npmrcCovered) {
            covered.push('.npmrc');
          } else {
            missing.push('.npmrc (contains authToken)');
          }
        }
      } catch {
        // ignore
      }
    }

    return { covered, missing };
  }
}
