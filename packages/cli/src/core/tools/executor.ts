/**
 * Tool Executor
 *
 * Executes tool calls from API-based LLMs within the sandbox.
 * Each tool maps to a file/shell operation performed safely within
 * the project root boundary.
 */

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, relative, resolve } from 'node:path';
import { ToolSandbox, type ToolSandboxConfig } from './sandbox.js';

const execFileAsync = promisify(execFile);

/** Maximum output size for read operations (100 KB) */
const MAX_READ_OUTPUT = 100 * 1024;

/** Maximum output size for command output (50 KB) */
const MAX_COMMAND_OUTPUT = 50 * 1024;

/** Maximum number of search result lines */
const MAX_SEARCH_RESULTS = 100;

/** Maximum number of files listed */
const MAX_LIST_FILES = 500;

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export class ToolExecutor {
  private sandbox: ToolSandbox;

  constructor(sandboxConfig: ToolSandboxConfig) {
    this.sandbox = new ToolSandbox(sandboxConfig);
  }

  /** Execute a tool call by name and return the result */
  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case 'read_file':
          return await this.readFileImpl(args as { path: string; startLine?: number; endLine?: number });
        case 'write_file':
          return await this.writeFileImpl(args as { path: string; content: string });
        case 'edit_file':
          return await this.editFileImpl(args as { path: string; old_text: string; new_text: string });
        case 'run_command':
          return await this.runCommandImpl(args as { command: string; cwd?: string; timeout?: number });
        case 'search_files':
          return await this.searchFilesImpl(args as { pattern: string; path?: string; glob?: string });
        case 'list_files':
          return await this.listFilesImpl(args as { pattern: string });
        case 'create_directory':
          return await this.createDirectoryImpl(args as { path: string });
        default:
          return { success: false, output: '', error: `Unknown tool: ${toolName}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: message };
    }
  }

  // ── read_file ──────────────────────────────────────────────────────────

  private async readFileImpl(args: { path: string; startLine?: number; endLine?: number }): Promise<ToolResult> {
    const absPath = this.sandbox.validatePath(args.path);

    const fileStat = await stat(absPath);
    if (fileStat.size > this.sandbox.maxFileSize) {
      return {
        success: false,
        output: '',
        error: `File is too large (${(fileStat.size / 1024 / 1024).toFixed(1)} MB). Maximum: ${(this.sandbox.maxFileSize / 1024 / 1024).toFixed(0)} MB. Use startLine/endLine to read a portion.`,
      };
    }

    const content = await readFile(absPath, 'utf-8');
    const lines = content.split('\n');

    const start = Math.max(1, args.startLine ?? 1);
    const end = Math.min(lines.length, args.endLine ?? lines.length);
    const sliced = lines.slice(start - 1, end);

    // Format with line numbers
    let output = sliced
      .map((line, i) => `${String(start + i).padStart(6)} | ${line}`)
      .join('\n');

    if (output.length > MAX_READ_OUTPUT) {
      output = output.slice(0, MAX_READ_OUTPUT) + '\n... [output truncated at 100KB]';
    }

    const totalLines = lines.length;
    const header = `File: ${args.path} (${totalLines} lines, ${fileStat.size} bytes)`;
    if (start > 1 || end < totalLines) {
      return { success: true, output: `${header}\nShowing lines ${start}-${end}:\n${output}` };
    }
    return { success: true, output: `${header}\n${output}` };
  }

  // ── write_file ─────────────────────────────────────────────────────────

  private async writeFileImpl(args: { path: string; content: string }): Promise<ToolResult> {
    this.sandbox.requireWrite();
    const absPath = this.sandbox.validatePath(args.path);

    const bytes = Buffer.byteLength(args.content, 'utf-8');
    if (bytes > this.sandbox.maxFileSize) {
      return {
        success: false,
        output: '',
        error: `Content too large (${(bytes / 1024 / 1024).toFixed(1)} MB). Maximum: ${(this.sandbox.maxFileSize / 1024 / 1024).toFixed(0)} MB.`,
      };
    }

    // Create parent directories
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, args.content, 'utf-8');

    const lineCount = args.content.split('\n').length;
    return {
      success: true,
      output: `Wrote ${bytes} bytes (${lineCount} lines) to ${args.path}`,
    };
  }

  // ── edit_file ──────────────────────────────────────────────────────────

  private async editFileImpl(args: { path: string; old_text: string; new_text: string }): Promise<ToolResult> {
    this.sandbox.requireWrite();
    const absPath = this.sandbox.validatePath(args.path);

    const content = await readFile(absPath, 'utf-8');

    // Count occurrences
    let count = 0;
    let idx = 0;
    while (true) {
      idx = content.indexOf(args.old_text, idx);
      if (idx === -1) break;
      count++;
      idx += args.old_text.length;
    }

    if (count === 0) {
      return {
        success: false,
        output: '',
        error: `old_text not found in ${args.path}. Make sure the text matches exactly (including whitespace and indentation).`,
      };
    }
    if (count > 1) {
      return {
        success: false,
        output: '',
        error: `old_text found ${count} times in ${args.path}. It must be unique. Include more surrounding context to make the match unique.`,
      };
    }

    const updated = content.replace(args.old_text, args.new_text);
    await writeFile(absPath, updated, 'utf-8');

    // Build a brief diff snippet
    const oldLines = args.old_text.split('\n');
    const newLines = args.new_text.split('\n');
    const diffSnippet = [
      `--- ${args.path}`,
      `+++ ${args.path}`,
      ...oldLines.map((l) => `- ${l}`),
      ...newLines.map((l) => `+ ${l}`),
    ].join('\n');

    return {
      success: true,
      output: `Edited ${args.path} (replaced ${oldLines.length} lines with ${newLines.length} lines)\n${diffSnippet}`,
    };
  }

  // ── run_command ────────────────────────────────────────────────────────

  private async runCommandImpl(args: { command: string; cwd?: string; timeout?: number }): Promise<ToolResult> {
    this.sandbox.validateCommand(args.command);

    const cwd = args.cwd
      ? this.sandbox.validatePath(args.cwd)
      : this.sandbox.getProjectRoot();

    const timeout = args.timeout ?? this.sandbox.commandTimeout;

    try {
      const { stdout, stderr } = await execFileAsync('/bin/sh', ['-c', args.command], {
        cwd,
        timeout,
        maxBuffer: MAX_COMMAND_OUTPUT * 2,
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      let output = '';
      if (stdout) output += stdout;
      if (stderr) output += (output ? '\n[stderr]\n' : '[stderr]\n') + stderr;

      if (output.length > MAX_COMMAND_OUTPUT) {
        output = output.slice(0, MAX_COMMAND_OUTPUT) + '\n... [output truncated at 50KB]';
      }

      return { success: true, output: output || '(no output)' };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean; message?: string };
      if (execErr.killed) {
        return {
          success: false,
          output: execErr.stdout?.slice(0, MAX_COMMAND_OUTPUT) ?? '',
          error: `Command timed out after ${timeout}ms`,
        };
      }

      let output = '';
      if (execErr.stdout) output += execErr.stdout;
      if (execErr.stderr) output += (output ? '\n[stderr]\n' : '[stderr]\n') + execErr.stderr;
      if (output.length > MAX_COMMAND_OUTPUT) {
        output = output.slice(0, MAX_COMMAND_OUTPUT) + '\n... [output truncated at 50KB]';
      }

      return {
        success: false,
        output: output || '',
        error: `Command exited with code ${execErr.code ?? 'unknown'}: ${execErr.message ?? ''}`,
      };
    }
  }

  // ── search_files ───────────────────────────────────────────────────────

  private async searchFilesImpl(args: { pattern: string; path?: string; glob?: string }): Promise<ToolResult> {
    const searchDir = args.path
      ? this.sandbox.validatePath(args.path)
      : this.sandbox.getProjectRoot();

    const grepArgs = ['-rn', '--color=never', '-E'];

    if (args.glob) {
      grepArgs.push('--include', args.glob);
    }

    // Exclude common non-searchable directories
    grepArgs.push(
      '--exclude-dir=node_modules',
      '--exclude-dir=.git',
      '--exclude-dir=dist',
      '--exclude-dir=build',
      '--exclude-dir=coverage',
    );

    grepArgs.push('--', args.pattern, searchDir);

    try {
      const { stdout } = await execFileAsync('grep', grepArgs, {
        timeout: this.sandbox.commandTimeout,
        maxBuffer: MAX_COMMAND_OUTPUT * 2,
        env: { ...process.env },
      });

      const lines = stdout.trim().split('\n').filter(Boolean);
      const projectRoot = this.sandbox.getProjectRoot();

      // Relativize paths for cleaner output
      const relativized = lines.map((line) => {
        if (line.startsWith(projectRoot)) {
          return line.slice(projectRoot.length + 1);
        }
        return line;
      });

      if (relativized.length > MAX_SEARCH_RESULTS) {
        const truncated = relativized.slice(0, MAX_SEARCH_RESULTS);
        return {
          success: true,
          output: truncated.join('\n') + `\n... [${relativized.length - MAX_SEARCH_RESULTS} more matches truncated]`,
        };
      }

      return { success: true, output: relativized.join('\n') || 'No matches found.' };
    } catch (err: unknown) {
      const execErr = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      // grep exits with code 1 when no matches found — that's not an error
      if (execErr.code === 1) {
        return { success: true, output: 'No matches found.' };
      }
      return {
        success: false,
        output: '',
        error: `Search failed: ${execErr.stderr || execErr.message || 'unknown error'}`,
      };
    }
  }

  // ── list_files ─────────────────────────────────────────────────────────

  private async listFilesImpl(args: { pattern: string }): Promise<ToolResult> {
    const projectRoot = this.sandbox.getProjectRoot();

    // Use find + shell glob via sh -c for portability
    // For simple patterns, this is sufficient. More complex globs would need a library.
    try {
      const { stdout } = await execFileAsync('/bin/sh', ['-c', `find . -path './.git' -prune -o -path './node_modules' -prune -o -name '${args.pattern.replace(/'/g, "'\\''")}' -type f -print 2>/dev/null | sort | head -n ${MAX_LIST_FILES + 1}`], {
        cwd: projectRoot,
        timeout: this.sandbox.commandTimeout,
        maxBuffer: MAX_COMMAND_OUTPUT * 2,
      });

      const files = stdout.trim().split('\n').filter(Boolean).map((f) => f.replace(/^\.\//, ''));

      if (files.length === 0) {
        // Try as a directory glob using find with -path
        const { stdout: pathStdout } = await execFileAsync('/bin/sh', ['-c', `find . -path './.git' -prune -o -path './node_modules' -prune -o -path './${args.pattern.replace(/'/g, "'\\''")}' -type f -print 2>/dev/null | sort | head -n ${MAX_LIST_FILES + 1}`], {
          cwd: projectRoot,
          timeout: this.sandbox.commandTimeout,
          maxBuffer: MAX_COMMAND_OUTPUT * 2,
        });

        const pathFiles = pathStdout.trim().split('\n').filter(Boolean).map((f) => f.replace(/^\.\//, ''));

        if (pathFiles.length > MAX_LIST_FILES) {
          return {
            success: true,
            output: pathFiles.slice(0, MAX_LIST_FILES).join('\n') + `\n... [${pathFiles.length - MAX_LIST_FILES} more files truncated]`,
          };
        }

        return {
          success: true,
          output: pathFiles.join('\n') || 'No files found matching the pattern.',
        };
      }

      if (files.length > MAX_LIST_FILES) {
        return {
          success: true,
          output: files.slice(0, MAX_LIST_FILES).join('\n') + `\n... [more files truncated]`,
        };
      }

      return { success: true, output: files.join('\n') };
    } catch (err: unknown) {
      const execErr = err as { message?: string };
      return {
        success: false,
        output: '',
        error: `Failed to list files: ${execErr.message ?? 'unknown error'}`,
      };
    }
  }

  // ── create_directory ───────────────────────────────────────────────────

  private async createDirectoryImpl(args: { path: string }): Promise<ToolResult> {
    this.sandbox.requireWrite();
    const absPath = this.sandbox.validatePath(args.path);

    await mkdir(absPath, { recursive: true });

    return {
      success: true,
      output: `Created directory: ${args.path}`,
    };
  }
}
