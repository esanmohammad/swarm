import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import type { Persona, TechStack } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Bundled prompts shipped with the repo (prompts/ at project root)
// From dist/src/prompts/ → 5 levels up to repo root: dist/src/prompts → dist/src → dist → packages/cli → packages → swarm
const BUNDLED_PROMPTS_DIR = resolve(__dirname, '..', '..', '..', '..', '..', 'prompts');

// Maps persona + stack to possible filenames (handles inconsistent casing)
const PROMPT_FILENAME_MAP: Record<Persona, (stack: TechStack) => string[]> = {
  analyst: (stack) => [`analyst-${stack}.md`],
  architect: (stack) => {
    const cap = stack.charAt(0).toUpperCase() + stack.slice(1);
    return [`Architect-${cap}.md`, `architect-${stack}.md`];
  },
  lead: (stack) => [`Software-lead-${stack}.md`, `software-lead-${stack}.md`],
  engineer: (stack) => [`Software-engineer-${stack}.md`, `software-engineer-${stack}.md`],
  tester: (stack) => [`test-engineer-${stack}.md`, `Test-engineer-${stack}.md`],
};

// Directories to search for prompts, in priority order:
// 1. Bundled prompts in repo (prompts/) — these have enforced structure templates
// 2. Custom dir from config (if set and not "bundled")
// 3. ~/.claude/prompts/ (user-level fallback)
// 4. ~/.claude/prompt/ (legacy location)
// Bundled prompts are searched first because they contain mandatory output structure
// enforcement that user-level prompts may not have.
// For "custom" stack: skip bundled prompts, only search user dirs.
function getSearchDirs(customDir?: string, stack?: TechStack): string[] {
  const dirs: string[] = [];
  // "custom" stack skips bundled prompts — user must provide their own
  if (stack !== 'custom') {
    dirs.push(BUNDLED_PROMPTS_DIR);
  }
  if (customDir && customDir !== 'bundled') {
    dirs.push(resolve(customDir.replace('~', homedir())));
  }
  dirs.push(join(homedir(), '.claude', 'prompts'));
  dirs.push(join(homedir(), '.claude', 'prompt'));
  return dirs;
}

/** Custom persona definition from .swarm/personas/{name}.yaml */
export interface CustomPersonaDefinition {
  name: string;
  /** System prompt — can be inline or a path to a .md file */
  prompt: string;
  /** Expected output artifact filename (e.g., "ANALYSIS.md") */
  artifact?: string;
  /** Tools the persona is allowed to use */
  allowedTools?: string[];
  /** Tools the persona is NOT allowed to use */
  disallowedTools?: string[];
  /** Description shown in dashboard spawn dialog */
  description?: string;
}

export class PromptLoader {
  private customDir?: string;
  private swarmDir?: string;
  private customPersonas = new Map<string, CustomPersonaDefinition>();

  constructor(customDir?: string, swarmDir?: string) {
    this.customDir = customDir;
    this.swarmDir = swarmDir;
    if (swarmDir) this.loadCustomPersonas(swarmDir);
  }

  /** Load custom persona definitions from .swarm/personas/ */
  private loadCustomPersonas(swarmDir: string): void {
    const personasDir = join(swarmDir, 'personas');
    if (!existsSync(personasDir)) return;

    try {
      const files = readdirSync(personasDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
      for (const file of files) {
        try {
          const raw = readFileSync(join(personasDir, file), 'utf-8');
          const def = parseYaml(raw) as CustomPersonaDefinition;
          if (def.name && def.prompt) {
            // If prompt is a file path, resolve and read it
            if (def.prompt.endsWith('.md') && existsSync(join(personasDir, def.prompt))) {
              def.prompt = readFileSync(join(personasDir, def.prompt), 'utf-8');
            }
            this.customPersonas.set(def.name, def);
          }
        } catch { /* skip malformed YAML */ }
      }
    } catch { /* personas dir unreadable */ }
  }

  /** Get a custom persona definition by name */
  getCustomPersona(name: string): CustomPersonaDefinition | undefined {
    return this.customPersonas.get(name);
  }

  /** List all loaded custom personas */
  listCustomPersonas(): CustomPersonaDefinition[] {
    return Array.from(this.customPersonas.values());
  }

  private getSearchDirsForStack(stack: TechStack): string[] {
    return getSearchDirs(this.customDir, stack);
  }

  async load(persona: Persona | string, stack: TechStack): Promise<string> {
    // Check custom personas first
    const custom = this.customPersonas.get(persona);
    if (custom) return custom.prompt;

    const filenameFn = PROMPT_FILENAME_MAP[persona as Persona];
    if (!filenameFn) {
      throw new Error(`Unknown persona "${persona}". Available: ${Object.keys(PROMPT_FILENAME_MAP).join(', ')}, or define a custom persona in .swarm/personas/`);
    }
    const filenames = filenameFn(stack);
    const searchDirs = this.getSearchDirsForStack(stack);

    for (const dir of searchDirs) {
      for (const filename of filenames) {
        const fullPath = join(dir, filename);
        if (existsSync(fullPath)) {
          return readFileSync(fullPath, 'utf-8');
        }
      }
    }

    const searchedPaths = searchDirs.map((d) => filenames.map((f) => join(d, f))).flat().join(', ');
    if (stack === 'custom') {
      throw new Error(
        `Prompt file not found for persona="${persona}" stack="custom". ` +
        `Custom stack requires user-provided prompts. Place prompt files in your promptsDir, ~/.claude/prompts/, or ~/.claude/prompt/. ` +
        `Expected filenames: ${filenames.join(', ')}. Searched: ${searchedPaths}`,
      );
    }

    throw new Error(
      `Prompt file not found for persona="${persona}" stack="${stack}". ` +
      `Searched: ${searchedPaths}`,
    );
  }

  resolve(persona: Persona, stack: TechStack): string | null {
    const filenames = PROMPT_FILENAME_MAP[persona](stack);
    const searchDirs = this.getSearchDirsForStack(stack);

    for (const dir of searchDirs) {
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
    const personas: Persona[] = ['analyst', 'architect', 'lead', 'engineer', 'tester'];
    const stacks: TechStack[] = ['react', 'node', 'go', 'python', 'rust', 'swift', 'custom'];

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
