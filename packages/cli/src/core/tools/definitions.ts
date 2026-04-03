/**
 * Swarm Tool Definitions
 *
 * OpenAI function-calling format tool definitions for API-based models.
 * These tools give non-Claude models the ability to read/write files,
 * run commands, and search code within the project sandbox.
 */

import type { ToolDefinition } from '../providers/types.js';

export const SWARM_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read the contents of a file. Returns the file content with line numbers. Use startLine/endLine to read a specific range for large files.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to project root',
          },
          startLine: {
            type: 'number',
            description: 'Start reading from this line (1-indexed, inclusive)',
          },
          endLine: {
            type: 'number',
            description: 'Stop reading at this line (1-indexed, inclusive)',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Write content to a file. Creates the file if it does not exist, overwrites if it does. Parent directories are created automatically.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to project root',
          },
          content: {
            type: 'string',
            description: 'Full content to write to the file',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Replace a specific string in a file. The old_text must appear exactly once in the file (unique match required). Use this for surgical edits instead of rewriting entire files.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to project root',
          },
          old_text: {
            type: 'string',
            description: 'The exact text to find and replace (must be a unique match)',
          },
          new_text: {
            type: 'string',
            description: 'The replacement text',
          },
        },
        required: ['path', 'old_text', 'new_text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Execute a shell command and return stdout/stderr. Commands run in /bin/sh. Use cwd to change the working directory. Long-running commands will be terminated after the timeout.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute',
          },
          cwd: {
            type: 'string',
            description: 'Working directory for the command (relative to project root)',
          },
          timeout: {
            type: 'number',
            description: 'Maximum execution time in milliseconds (default: 30000)',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description:
        'Search file contents using a regex pattern (like grep). Returns matching lines with file paths and line numbers. Searches recursively from the given path.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Regex pattern to search for in file contents',
          },
          path: {
            type: 'string',
            description: 'Directory to search in, relative to project root (default: project root)',
          },
          glob: {
            type: 'string',
            description: 'File glob pattern to filter which files to search (e.g. "*.ts", "**/*.js")',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description:
        'List files matching a glob pattern. Returns file paths relative to the project root, sorted alphabetically. Use this to explore the project structure.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern to match files (e.g. "src/**/*.ts", "*.json", "**/*")',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_directory',
      description:
        'Create a directory, including any necessary parent directories.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path relative to project root',
          },
        },
        required: ['path'],
      },
    },
  },
];
