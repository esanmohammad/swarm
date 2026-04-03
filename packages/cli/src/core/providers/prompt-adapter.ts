/**
 * Prompt Adaptation Layer
 *
 * Adapts persona system prompts based on target model capabilities.
 * - Tier 3 (Claude CLI): No changes
 * - Tier 2 (API + tools): Remap tool names, strip Claude-specific features
 * - Tier 1 (text-only): Strip all tool refs, add output format instructions
 */

import type { CapabilityTier } from './types.js';

export interface PromptAdaptation {
  systemPrompt: string;
  /** Prepended to the user prompt (e.g., file contents for text-only mode) */
  userPromptPrefix?: string;
}

export interface PromptAdaptOptions {
  /** Provider identifier: 'openai', 'google', 'ollama', 'anthropic', etc. */
  modelProvider?: string;
  /** For Tier 1: inline relevant file contents into the prompt context */
  injectFileContents?: Record<string, string>;
}

/** Claude Code tool name -> Swarm/generic tool name mapping */
const TOOL_NAME_MAP: Record<string, string> = {
  'Read': 'read_file',
  'Edit': 'edit_file',
  'Write': 'write_file',
  'Bash': 'run_command',
  'Grep': 'search_files',
  'Glob': 'list_files',
  'Agent': 'spawn_agent',
  'WebSearch': 'web_search',
  'WebFetch': 'web_fetch',
  'NotebookEdit': 'notebook_edit',
};

/** Patterns that reference Claude Code-specific features */
const CLAUDE_SPECIFIC_PATTERNS = [
  /You are (?:powered by )?Claude Code[^.]*\./gi,
  /Claude Code's? (?:built-in )?(?:tools?|commands?|capabilities)[^.]*\./gi,
  /(?:MCP|Model Context Protocol)[^.]*\./gi,
  /permission mode[s]?[^.]*\./gi,
  /sub-?agents?[^.]*spawning[^.]*\./gi,
  /--(?:permission-mode|allowedTools|disallowedTools)[^.\n]*/gi,
  /`claude`\s+CLI[^.]*\./gi,
];

/** Persona-specific output format instructions for text-only mode */
const PERSONA_OUTPUT_INSTRUCTIONS: Record<string, string> = {
  analyst: [
    'OUTPUT FORMAT:',
    'You must produce a complete markdown document titled "REQUIREMENTS.md".',
    'Structure it with clear sections: Overview, Functional Requirements, Non-Functional Requirements,',
    'User Stories, Acceptance Criteria, and Constraints.',
    'Use numbered requirements (e.g., FR-001, NFR-001) for traceability.',
    'Do NOT include architecture decisions, code, or task breakdowns.',
  ].join('\n'),

  architect: [
    'OUTPUT FORMAT:',
    'You must produce a complete markdown document titled "SPEC.md".',
    'Structure it with: System Overview, Architecture Diagram (ASCII/Mermaid), Component Design,',
    'Data Models, API Contracts, Technology Choices with Rationale, and Security Considerations.',
    'Do NOT include implementation code or task breakdowns.',
  ].join('\n'),

  lead: [
    'OUTPUT FORMAT:',
    'You must produce a complete markdown document titled "TASKS.md".',
    'Structure tasks with IDs (e.g., FND-001, SVC-002) and include:',
    'Task ID, Description, Acceptance Criteria, Dependencies, and Estimated Complexity.',
    'Group tasks by parallel execution groups where independent tasks can run simultaneously.',
    'Mark parallel groups with "## Parallel Group N" headers.',
    'Do NOT include actual implementation code or redesign the architecture.',
  ].join('\n'),

  engineer: [
    'OUTPUT FORMAT:',
    'Implement the code changes as described. For each file you create or modify,',
    'output the complete file content wrapped in a code block with the file path as a header.',
    'Example:',
    '### path/to/file.ts',
    '```typescript',
    '// file content here',
    '```',
    'Ensure all code is production-quality with proper error handling.',
  ].join('\n'),

  tester: [
    'OUTPUT FORMAT:',
    'You must produce a complete markdown document titled "TESTPLAN.md".',
    'Structure it with: Test Strategy, Unit Tests, Integration Tests, E2E Tests,',
    'Edge Cases, Performance Tests, and Test Data Requirements.',
    'For each test, include: Test ID, Description, Steps, Expected Result, and Priority.',
    'Do NOT include or modify source code — test plan documentation only.',
  ].join('\n'),
};

export class PromptAdapter {
  /**
   * Adapt a persona system prompt for a given capability tier.
   */
  adapt(systemPrompt: string, tier: CapabilityTier, options?: PromptAdaptOptions): PromptAdaptation {
    switch (tier) {
      case 3:
        // Claude CLI — no changes needed
        return { systemPrompt };

      case 2:
        return this.adaptForToolCalling(systemPrompt, options);

      case 1:
        return this.adaptForTextOnly(systemPrompt, options);

      default:
        return { systemPrompt };
    }
  }

  // ---------------------------------------------------------------------------
  // Tier 2: API + tools
  // ---------------------------------------------------------------------------

  private adaptForToolCalling(systemPrompt: string, options?: PromptAdaptOptions): PromptAdaptation {
    let adapted = systemPrompt;

    // Replace Claude tool names with Swarm tool names
    adapted = this.replaceToolNames(adapted);

    // Strip Claude Code-specific references
    adapted = this.stripClaudeToolReferences(adapted);

    // Add Swarm tool usage hints
    adapted = this.addSwarmToolHints(adapted);

    // Add model-specific instructions if provider is known
    if (options?.modelProvider) {
      adapted = this.addModelHints(adapted, options.modelProvider);
    }

    return { systemPrompt: adapted };
  }

  // ---------------------------------------------------------------------------
  // Tier 1: text-only
  // ---------------------------------------------------------------------------

  private adaptForTextOnly(systemPrompt: string, options?: PromptAdaptOptions): PromptAdaptation {
    let adapted = systemPrompt;

    // Strip ALL tool references — text-only models can't use tools
    adapted = this.stripAllToolReferences(adapted);

    // Strip Claude-specific references
    adapted = this.stripClaudeToolReferences(adapted);

    // Detect persona from prompt content and add output format instructions
    const persona = this.detectPersona(adapted);
    if (persona) {
      adapted = this.addOutputFormatInstructions(adapted, persona);
    }

    // Add model-specific instructions
    if (options?.modelProvider) {
      adapted = this.addModelHints(adapted, options.modelProvider);
    }

    // Build user prompt prefix with injected file contents
    let userPromptPrefix: string | undefined;
    if (options?.injectFileContents && Object.keys(options.injectFileContents).length > 0) {
      const parts = ['Here are the relevant project files for context:\n'];
      for (const [filePath, content] of Object.entries(options.injectFileContents)) {
        parts.push(`### ${filePath}\n\`\`\`\n${content}\n\`\`\`\n`);
      }
      parts.push('---\n');
      userPromptPrefix = parts.join('\n');
    }

    return { systemPrompt: adapted, userPromptPrefix };
  }

  // ---------------------------------------------------------------------------
  // Tool name replacement
  // ---------------------------------------------------------------------------

  /** Replace Claude Code tool names with Swarm/generic tool names */
  private replaceToolNames(prompt: string): string {
    let result = prompt;
    for (const [claudeName, swarmName] of Object.entries(TOOL_NAME_MAP)) {
      // Match tool name in backticks, after "the", or as standalone word in tool context
      const patterns = [
        new RegExp(`\`${claudeName}\``, 'g'),
        new RegExp(`\\bthe ${claudeName} tool\\b`, 'gi'),
        new RegExp(`\\buse ${claudeName}\\b`, 'gi'),
        new RegExp(`\\b${claudeName} tool\\b`, 'gi'),
      ];
      for (const pattern of patterns) {
        result = result.replace(pattern, (match) => {
          // Preserve casing style
          if (match.startsWith('`')) return `\`${swarmName}\``;
          if (match.toLowerCase().startsWith('the ')) return `the ${swarmName} tool`;
          if (match.toLowerCase().startsWith('use ')) return `use ${swarmName}`;
          return `${swarmName} tool`;
        });
      }
    }
    return result;
  }

  /** Strip references to Claude Code-specific features */
  private stripClaudeToolReferences(prompt: string): string {
    let result = prompt;
    for (const pattern of CLAUDE_SPECIFIC_PATTERNS) {
      result = result.replace(pattern, '');
    }
    // Clean up resulting double-newlines
    result = result.replace(/\n{3,}/g, '\n\n');
    return result;
  }

  /** Strip ALL tool references (for text-only models) */
  private stripAllToolReferences(prompt: string): string {
    let result = prompt;

    // Remove tool usage instruction blocks
    result = result.replace(/(?:^|\n)#+\s*(?:Tools?|Available Tools|Tool Usage)[^\n]*(?:\n(?!#).*?)*/gim, '');

    // Remove individual tool references
    for (const toolName of Object.keys(TOOL_NAME_MAP)) {
      result = result.replace(new RegExp(`\\b(?:use|call|invoke|run)\\s+(?:the\\s+)?${toolName}(?:\\s+tool)?\\b[^.]*\\.?`, 'gi'), '');
    }

    // Remove "you have access to tools" type sentences
    result = result.replace(/you (?:have access to|can use|should use) (?:the following )?tools?[^.]*\./gi, '');
    result = result.replace(/(?:available )?tools?:\s*(?:`[^`]+`(?:,\s*)?)+/gi, '');

    // Clean up whitespace
    result = result.replace(/\n{3,}/g, '\n\n');
    return result.trim();
  }

  // ---------------------------------------------------------------------------
  // Model-specific hints
  // ---------------------------------------------------------------------------

  /** Add model-specific instructions to improve output quality */
  private addModelHints(prompt: string, provider: string): string {
    const hints: string[] = [];

    switch (provider.toLowerCase()) {
      case 'openai':
        hints.push(
          'STYLE GUIDANCE: Be concise and direct. Avoid preamble.',
          'Structure your response clearly with headers and bullet points where appropriate.',
        );
        break;

      case 'google':
      case 'gemini':
        hints.push(
          'STYLE GUIDANCE: Use well-structured sections with clear headers.',
          'Prefer numbered lists for sequential items and bullet points for unordered items.',
          'Include a brief summary at the start of your response.',
        );
        break;

      case 'ollama':
      case 'llama':
      case 'local':
        hints.push(
          'STYLE GUIDANCE: Follow the output format instructions exactly.',
          'Use proper markdown formatting with headers (##), lists, and code blocks.',
          'Be thorough but stay within the scope of your role.',
          'Do not add conversational filler — output only the requested document.',
        );
        break;

      case 'deepseek':
        hints.push(
          'STYLE GUIDANCE: Emphasize technical accuracy and code-focused responses.',
          'When discussing implementations, prefer concrete code examples.',
          'Structure responses with clear technical sections.',
        );
        break;

      // anthropic (API mode) and unknown providers get no extra hints
      default:
        break;
    }

    if (hints.length > 0) {
      return prompt + '\n\n' + hints.join('\n');
    }
    return prompt;
  }

  // ---------------------------------------------------------------------------
  // Output format instructions
  // ---------------------------------------------------------------------------

  /** Add output format instructions based on persona */
  private addOutputFormatInstructions(prompt: string, persona: string): string {
    const instructions = PERSONA_OUTPUT_INSTRUCTIONS[persona];
    if (!instructions) return prompt;
    return prompt + '\n\n' + instructions;
  }

  // ---------------------------------------------------------------------------
  // Swarm tool hints (for Tier 2)
  // ---------------------------------------------------------------------------

  private addSwarmToolHints(prompt: string): string {
    const hints = [
      '',
      'TOOL USAGE NOTES:',
      '- `read_file`: Read a file from disk. Params: { path: string, offset?: number, limit?: number }',
      '- `edit_file`: Make targeted edits to a file. Params: { path: string, old_text: string, new_text: string }',
      '- `write_file`: Create or overwrite a file. Params: { path: string, content: string }',
      '- `run_command`: Execute a shell command. Params: { command: string, cwd?: string }',
      '- `search_files`: Search file contents with regex. Params: { pattern: string, path?: string, glob?: string }',
      '- `list_files`: Find files by glob pattern. Params: { pattern: string, path?: string }',
    ].join('\n');

    return prompt + hints;
  }

  // ---------------------------------------------------------------------------
  // Persona detection
  // ---------------------------------------------------------------------------

  /** Detect the persona from prompt content */
  private detectPersona(prompt: string): string | null {
    const lower = prompt.toLowerCase();
    if (lower.includes('requirements') && lower.includes('analyst')) return 'analyst';
    if (lower.includes('architect') && (lower.includes('spec') || lower.includes('design'))) return 'architect';
    if (lower.includes('lead') && lower.includes('task')) return 'lead';
    if (lower.includes('test') && (lower.includes('tester') || lower.includes('test plan'))) return 'tester';
    if (lower.includes('engineer') && lower.includes('implement')) return 'engineer';

    // Fallback: check for persona markers in the prompt
    if (lower.includes('requirements.md')) return 'analyst';
    if (lower.includes('spec.md')) return 'architect';
    if (lower.includes('tasks.md')) return 'lead';
    if (lower.includes('testplan.md')) return 'tester';

    return null;
  }
}
