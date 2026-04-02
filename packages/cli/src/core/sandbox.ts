import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve, normalize } from 'node:path';
import { homedir } from 'node:os';

export type SandboxMode = 'strict' | 'moderate' | 'off';

export interface SandboxViolation {
  type: 'filesystem' | 'network' | 'command' | 'process';
  detail: string;
  severity: 'blocked' | 'warning';
  timestamp: number;
}

export interface SandboxConfig {
  mode: SandboxMode;
  /** Allowed filesystem paths (project dir always allowed) */
  allowedPaths?: string[];
  /** Blocked filesystem paths */
  blockedPaths?: string[];
  /** Allowed network hosts (package registries always allowed) */
  allowedHosts?: string[];
  /** Blocked commands */
  blockedCommands?: string[];
}

const HOME = homedir();

/** Sensitive paths that are always blocked in moderate/strict modes */
const DEFAULT_BLOCKED_PATHS = [
  join(HOME, '.ssh'),
  join(HOME, '.aws'),
  join(HOME, '.config', 'gcloud'),
  join(HOME, '.npmrc'),
  join(HOME, '.netrc'),
  '/etc/passwd',
  '/etc/shadow',
  '/etc/hosts',
];

/** Package registry hosts allowed in moderate mode */
const DEFAULT_ALLOWED_HOSTS = [
  'registry.npmjs.org',
  'pypi.org',
  'proxy.golang.org',
  'crates.io',
  'github.com',
];

/** Dangerous command patterns that are always blocked */
const DEFAULT_BLOCKED_COMMAND_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /rm\s+(-\w*r\w*\s+-\w*f\w*|-\w*f\w*\s+-\w*r\w*|-\w*rf\w*)\s+\/\s*$/, description: 'rm -rf /' },
  { pattern: /rm\s+(-\w*r\w*\s+-\w*f\w*|-\w*f\w*\s+-\w*r\w*|-\w*rf\w*)\s+~\s*$/, description: 'rm -rf ~' },
  { pattern: /rm\s+(-\w*r\w*\s+-\w*f\w*|-\w*f\w*\s+-\w*r\w*|-\w*rf\w*)\s+\$HOME\s*$/, description: 'rm -rf $HOME' },
  { pattern: /chmod\s+(-R\s+)?777/, description: 'chmod 777' },
  { pattern: /\bsudo\b/, description: 'sudo' },
  { pattern: /\bsu\s+-/, description: 'su -' },
  { pattern: /curl\s.*\|\s*(ba)?sh/, description: 'curl | bash' },
  { pattern: /wget\s.*\|\s*(ba)?sh/, description: 'wget | sh' },
  { pattern: /eval\s+"\$\(curl/, description: 'eval "$(curl' },
  { pattern: /\bcrontab\b/, description: 'crontab' },
  { pattern: /\bat\b\s+/, description: 'at command' },
];

export class Sandbox {
  private violations: SandboxViolation[] = [];
  private auditFilePath: string;

  constructor(
    private projectDir: string,
    private config: SandboxConfig = { mode: 'moderate' },
  ) {
    const swarmDir = join(projectDir, '.swarm');
    if (!existsSync(swarmDir)) {
      mkdirSync(swarmDir, { recursive: true });
    }
    this.auditFilePath = join(swarmDir, 'security-audit.jsonl');
  }

  /** Get the current sandbox mode */
  getMode(): SandboxMode {
    return this.config.mode;
  }

  /** Get the current config */
  getConfig(): SandboxConfig {
    return { ...this.config };
  }

  /** Validate a filesystem operation */
  checkFilesystem(path: string, operation: 'read' | 'write' | 'delete'): boolean {
    if (this.config.mode === 'off') return true;

    const resolved = resolve(path);
    const normalizedProject = resolve(this.projectDir);

    // Check for path traversal escaping project dir
    const normalized = normalize(resolved);
    if (normalized !== resolved) {
      // Path contains suspicious components
      const violation: SandboxViolation = {
        type: 'filesystem',
        detail: `Suspicious path normalization: ${path} -> ${normalized} (operation: ${operation})`,
        severity: 'blocked',
        timestamp: Date.now(),
      };
      this.logViolation(violation);
      return false;
    }

    // Always allow access within project directory
    if (resolved.startsWith(normalizedProject + '/') || resolved === normalizedProject) {
      return true;
    }

    // Check explicitly allowed paths
    const allowedPaths = this.config.allowedPaths || [];
    for (const allowed of allowedPaths) {
      const resolvedAllowed = resolve(allowed);
      if (resolved.startsWith(resolvedAllowed + '/') || resolved === resolvedAllowed) {
        return true;
      }
    }

    // Check blocked paths (default + custom)
    const blockedPaths = [...DEFAULT_BLOCKED_PATHS, ...(this.config.blockedPaths || [])];
    for (const blocked of blockedPaths) {
      const resolvedBlocked = resolve(blocked);
      if (resolved.startsWith(resolvedBlocked) || resolved === resolvedBlocked) {
        const violation: SandboxViolation = {
          type: 'filesystem',
          detail: `Access to sensitive path blocked: ${path} (operation: ${operation})`,
          severity: 'blocked',
          timestamp: Date.now(),
        };
        this.logViolation(violation);
        return false;
      }
    }

    // In strict mode, block everything outside project dir
    if (this.config.mode === 'strict') {
      const violation: SandboxViolation = {
        type: 'filesystem',
        detail: `Strict mode: access outside project dir blocked: ${path} (operation: ${operation})`,
        severity: 'blocked',
        timestamp: Date.now(),
      };
      this.logViolation(violation);
      return false;
    }

    // Moderate mode: warn about access outside project dir (except sensitive paths already blocked)
    const violation: SandboxViolation = {
      type: 'filesystem',
      detail: `Access outside project dir: ${path} (operation: ${operation})`,
      severity: 'warning',
      timestamp: Date.now(),
    };
    this.logViolation(violation);
    return true;
  }

  /** Validate a network request */
  checkNetwork(host: string): boolean {
    if (this.config.mode === 'off') return true;

    const normalizedHost = host.toLowerCase().replace(/:\d+$/, '');

    // Check explicitly allowed hosts (from config)
    const allowedHosts = this.config.allowedHosts || [];
    if (allowedHosts.some(h => normalizedHost === h.toLowerCase() || normalizedHost.endsWith('.' + h.toLowerCase()))) {
      return true;
    }

    // In moderate mode, allow default package registries
    if (this.config.mode === 'moderate') {
      if (DEFAULT_ALLOWED_HOSTS.some(h => normalizedHost === h || normalizedHost.endsWith('.' + h))) {
        return true;
      }

      // Warn about other hosts but allow
      const violation: SandboxViolation = {
        type: 'network',
        detail: `Network access to non-registry host: ${host}`,
        severity: 'warning',
        timestamp: Date.now(),
      };
      this.logViolation(violation);
      return true;
    }

    // In strict mode, block all except explicitly allowed and default registries
    if (DEFAULT_ALLOWED_HOSTS.some(h => normalizedHost === h || normalizedHost.endsWith('.' + h))) {
      return true;
    }

    const violation: SandboxViolation = {
      type: 'network',
      detail: `Strict mode: network access blocked to ${host}`,
      severity: 'blocked',
      timestamp: Date.now(),
    };
    this.logViolation(violation);
    return false;
  }

  /** Validate a command execution */
  checkCommand(cmd: string): boolean {
    if (this.config.mode === 'off') return true;

    const trimmedCmd = cmd.trim();

    // Check default blocked patterns
    for (const { pattern, description } of DEFAULT_BLOCKED_COMMAND_PATTERNS) {
      if (pattern.test(trimmedCmd)) {
        const violation: SandboxViolation = {
          type: 'command',
          detail: `Dangerous command blocked (${description}): ${trimmedCmd.slice(0, 100)}`,
          severity: 'blocked',
          timestamp: Date.now(),
        };
        this.logViolation(violation);
        return false;
      }
    }

    // Check custom blocked commands
    const blockedCommands = this.config.blockedCommands || [];
    for (const blocked of blockedCommands) {
      if (trimmedCmd.includes(blocked)) {
        const violation: SandboxViolation = {
          type: 'command',
          detail: `Custom blocked command matched (${blocked}): ${trimmedCmd.slice(0, 100)}`,
          severity: 'blocked',
          timestamp: Date.now(),
        };
        this.logViolation(violation);
        return false;
      }
    }

    // In strict mode, warn about kill/pkill
    if (this.config.mode === 'strict') {
      if (/\b(kill|pkill|killall)\b/.test(trimmedCmd)) {
        const violation: SandboxViolation = {
          type: 'process',
          detail: `Process control command in strict mode: ${trimmedCmd.slice(0, 100)}`,
          severity: 'warning',
          timestamp: Date.now(),
        };
        this.logViolation(violation);
        // Allow but warn — agent manager needs kill for managed agents
      }
    }

    return true;
  }

  /** Get violation log */
  getViolations(): SandboxViolation[] {
    return [...this.violations];
  }

  /** Get violations from the persisted security audit log */
  getPersistedViolations(limit = 100): SandboxViolation[] {
    if (!existsSync(this.auditFilePath)) return [];
    try {
      const raw = readFileSync(this.auditFilePath, 'utf-8');
      const entries = raw
        .split('\n')
        .filter(Boolean)
        .map(line => {
          try { return JSON.parse(line) as SandboxViolation; } catch { return null; }
        })
        .filter(Boolean) as SandboxViolation[];
      // Return newest first
      entries.sort((a, b) => b.timestamp - a.timestamp);
      return entries.slice(0, limit);
    } catch {
      return [];
    }
  }

  /** Build --disallowed-tools and --append-system-prompt for sandbox mode */
  getAgentConstraints(): { disallowedTools?: string[]; appendSystemPrompt?: string } {
    if (this.config.mode === 'off') {
      return {};
    }

    const disallowedTools: string[] = [];
    const promptParts: string[] = [];

    if (this.config.mode === 'strict') {
      promptParts.push(
        'SANDBOX ENFORCEMENT (STRICT MODE):',
        '- Do NOT access files outside the project directory.',
        '- Do NOT make network requests to hosts other than: ' + DEFAULT_ALLOWED_HOSTS.join(', ') + (this.config.allowedHosts?.length ? ', ' + this.config.allowedHosts.join(', ') : '') + '.',
        '- Do NOT run destructive commands (rm -rf, chmod 777, sudo, etc.).',
        '- Do NOT access sensitive files (~/.ssh, ~/.aws, ~/.npmrc, /etc/passwd, etc.).',
        '- Do NOT pipe curl/wget output to shell execution.',
        '- Do NOT use crontab or at for scheduling.',
      );
    } else {
      // moderate
      promptParts.push(
        'SANDBOX ENFORCEMENT (MODERATE MODE):',
        '- Avoid accessing files outside the project directory unless necessary.',
        '- Do NOT access sensitive files (~/.ssh, ~/.aws, ~/.npmrc, /etc/passwd, etc.).',
        '- Do NOT run destructive commands (rm -rf /, chmod 777, sudo, etc.).',
        '- Do NOT pipe curl/wget output to shell execution.',
      );
    }

    // Add blocked paths info
    const blockedPaths = [...DEFAULT_BLOCKED_PATHS, ...(this.config.blockedPaths || [])];
    if (blockedPaths.length > 0) {
      promptParts.push('- Blocked paths: ' + blockedPaths.slice(0, 5).join(', ') + (blockedPaths.length > 5 ? '...' : ''));
    }

    return {
      disallowedTools: disallowedTools.length > 0 ? disallowedTools : undefined,
      appendSystemPrompt: promptParts.length > 0 ? promptParts.join('\n') : undefined,
    };
  }

  /** Log violation to .swarm/security-audit.jsonl */
  private logViolation(v: SandboxViolation): void {
    this.violations.push(v);
    try {
      appendFileSync(this.auditFilePath, JSON.stringify(v) + '\n');
    } catch {
      // Non-critical — don't crash if audit logging fails
    }
  }
}
