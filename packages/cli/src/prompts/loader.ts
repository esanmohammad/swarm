import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import type { Persona, TechStack } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Bundled prompts shipped with the repo (prompts/ at project root)
const BUNDLED_PROMPTS_DIR = resolve(__dirname, '..', '..', '..', '..', 'prompts');

// Maps persona + stack to possible filenames (handles inconsistent casing)
const PROMPT_FILENAME_MAP: Record<Persona, (stack: TechStack) => string[]> = {
  analyst: (stack) => [`analyst-${stack}.md`],
  architect: (stack) => {
    const cap = stack.charAt(0).toUpperCase() + stack.slice(1);
    return [`Architect-${cap}.md`, `architect-${stack}.md`];
  },
  lead: (stack) => [`Software-lead-${stack}.md`, `software-lead-${stack}.md`],
  engineer: (stack) => [`Software-engineer-${stack}.md`, `software-engineer-${stack}.md`],
};

// Directories to search for prompts, in priority order:
// 1. Custom dir from config (if set)
// 2. Bundled prompts in repo (prompts/)
// 3. ~/.claude/prompts/ (user-level)
// 4. ~/.claude/prompt/ (architect prompts legacy location)
function getSearchDirs(customDir?: string): string[] {
  const dirs: string[] = [];
  if (customDir) {
    dirs.push(resolve(customDir.replace('~', homedir())));
  }
  dirs.push(BUNDLED_PROMPTS_DIR);
  dirs.push(join(homedir(), '.claude', 'prompts'));
  dirs.push(join(homedir(), '.claude', 'prompt'));
  return dirs;
}

export class PromptLoader {
  private searchDirs: string[];

  constructor(customDir?: string) {
    this.searchDirs = getSearchDirs(customDir);
  }

  async load(persona: Persona, stack: TechStack): Promise<string> {
    const filenames = PROMPT_FILENAME_MAP[persona](stack);

    for (const dir of this.searchDirs) {
      for (const filename of filenames) {
        const fullPath = join(dir, filename);
        if (existsSync(fullPath)) {
          return readFileSync(fullPath, 'utf-8');
        }
      }
    }

    throw new Error(
      `Prompt file not found for persona="${persona}" stack="${stack}". ` +
      `Searched: ${this.searchDirs.map((d) => filenames.map((f) => join(d, f))).flat().join(', ')}`,
    );
  }

  resolve(persona: Persona, stack: TechStack): string | null {
    const filenames = PROMPT_FILENAME_MAP[persona](stack);

    for (const dir of this.searchDirs) {
      for (const filename of filenames) {
        const fullPath = join(dir, filename);
        if (existsSync(fullPath)) {
          return fullPath;
        }
      }
    }
    return null;
  }

  listAvailable(): Array<{ persona: Persona; stack: TechStack; path: string }> {
    const results: Array<{ persona: Persona; stack: TechStack; path: string }> = [];
    const personas: Persona[] = ['analyst', 'architect', 'lead', 'engineer'];
    const stacks: TechStack[] = ['react', 'node', 'go'];

    for (const persona of personas) {
      for (const stack of stacks) {
        const path = this.resolve(persona, stack);
        if (path) {
          results.push({ persona, stack, path });
        }
      }
    }
    return results;
  }
}
