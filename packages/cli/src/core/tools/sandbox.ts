/**
 * Tool Execution Sandbox
 *
 * Safety boundary for tool execution. Validates file paths stay within
 * the project root and filters dangerous shell commands.
 */

import { resolve, normalize, relative } from 'node:path';

export interface ToolSandboxConfig {
  projectRoot: string;
  allowedPaths?: string[];
  commandTimeout?: number;
  commandBlocklist?: string[];
  maxFileSize?: number;
  readOnly?: boolean;
}

/** Default command patterns that are always blocked */
const DEFAULT_COMMAND_BLOCKLIST: string[] = [
  'rm -rf /',
  'rm -rf ~',
  'sudo ',
  ':(){:|:&};:',
  'mkfs',
  'dd if=',
  '> /dev/',
  'chmod 777 /',
  'chown -R',
  'shutdown',
  'reboot',
  'init 0',
  'init 6',
];

/** Commands that are dangerous when piped to */
const DANGEROUS_PIPE_TARGETS: string[] = [
  'sh',
  'bash',
  'zsh',
  'eval',
  'exec',
  'source',
];

export class ToolSandbox {
  private readonly projectRoot: string;
  private readonly allowedPaths: string[];
  private readonly commandBlocklist: string[];
  readonly commandTimeout: number;
  readonly maxFileSize: number;
  readonly readOnly: boolean;

  constructor(config: ToolSandboxConfig) {
    this.projectRoot = resolve(config.projectRoot);
    this.allowedPaths = (config.allowedPaths ?? []).map((p) => resolve(p));
    this.commandTimeout = config.commandTimeout ?? 30_000;
    this.commandBlocklist = [
      ...DEFAULT_COMMAND_BLOCKLIST,
      ...(config.commandBlocklist ?? []),
    ];
    this.maxFileSize = config.maxFileSize ?? 10 * 1024 * 1024; // 10 MB
    this.readOnly = config.readOnly ?? false;
  }

  /**
   * Validate that a file path resolves to within the sandbox boundaries.
   * Returns the resolved absolute path.
   * Throws if the path escapes the sandbox.
   */
  validatePath(path: string): string {
    // Resolve relative to project root
    const absolute = resolve(this.projectRoot, path);
    const normalized = normalize(absolute);

    // Check the path is within project root or an allowed path
    const isWithinProjectRoot = normalized.startsWith(this.projectRoot + '/') || normalized === this.projectRoot;

    const isWithinAllowed = this.allowedPaths.some(
      (allowed) => normalized.startsWith(allowed + '/') || normalized === allowed,
    );

    if (!isWithinProjectRoot && !isWithinAllowed) {
      // Compute relative path for a clear error message
      const rel = relative(this.projectRoot, normalized);
      throw new Error(
        `Path "${path}" resolves to "${normalized}" which is outside the sandbox. ` +
          `Relative resolution: "${rel}". Access is restricted to the project root: "${this.projectRoot}".`,
      );
    }

    return normalized;
  }

  /**
   * Validate that a command is safe to execute.
   * Throws if the command matches a blocked pattern.
   */
  validateCommand(command: string): void {
    const lower = command.toLowerCase().trim();

    for (const blocked of this.commandBlocklist) {
      if (lower.includes(blocked.toLowerCase())) {
        throw new Error(
          `Command blocked by sandbox: "${command}" matches blocklist pattern "${blocked}".`,
        );
      }
    }

    // Check for pipe to dangerous commands
    const pipeSegments = command.split('|').slice(1); // everything after the first pipe
    for (const segment of pipeSegments) {
      const target = segment.trim().split(/\s+/)[0];
      if (target && DANGEROUS_PIPE_TARGETS.includes(target)) {
        throw new Error(
          `Command blocked by sandbox: piping to "${target}" is not allowed.`,
        );
      }
    }
  }

  /** Check if write operations are allowed */
  isWriteAllowed(): boolean {
    return !this.readOnly;
  }

  /** Enforce write permission, throwing if read-only */
  requireWrite(): void {
    if (this.readOnly) {
      throw new Error('Write operation denied: sandbox is in read-only mode.');
    }
  }

  /** Get the resolved project root */
  getProjectRoot(): string {
    return this.projectRoot;
  }
}
