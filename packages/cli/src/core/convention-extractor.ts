import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

/**
 * Extract project conventions by analyzing source code patterns.
 * Returns a structured markdown string suitable for LLM system prompts.
 */
export function extractConventions(cwd: string): string {
  const sections: string[] = [];

  // 1. Naming conventions
  const naming = analyzeNaming(cwd);
  if (naming) sections.push(naming);

  // 2. File structure patterns
  const structure = analyzeStructure(cwd);
  if (structure) sections.push(structure);

  // 3. Import patterns
  const imports = analyzeImports(cwd);
  if (imports) sections.push(imports);

  // 4. Test patterns
  const tests = analyzeTestPatterns(cwd);
  if (tests) sections.push(tests);

  // 5. Component/module patterns
  const components = analyzeComponentPatterns(cwd);
  if (components) sections.push(components);

  // 6. Error handling
  const errors = analyzeErrorPatterns(cwd);
  if (errors) sections.push(errors);

  // 7. Config & env patterns
  const config = analyzeConfigPatterns(cwd);
  if (config) sections.push(config);

  if (sections.length === 0) return '';

  return sections.join('\n\n');
}

/** Build an LLM-ready prompt from extracted conventions */
export function buildConventionPrompt(conventions: string): string {
  if (!conventions.trim()) return '';
  return [
    'PROJECT CONVENTIONS — Follow these patterns EXACTLY when writing code:',
    '',
    conventions,
    '',
    'When in doubt, match the style of existing code in the project.',
  ].join('\n');
}

// ── Analyzers ──────────────────────────────────────────────────────

function analyzeNaming(cwd: string): string | null {
  const files = collectSourceFiles(cwd, 3);
  if (files.length === 0) return null;

  const patterns: string[] = [];

  // File naming
  const kebab = files.filter(f => /^[a-z][a-z0-9-]+\.[a-z]+$/.test(basename(f)));
  const camel = files.filter(f => /^[a-z][a-zA-Z0-9]+\.[a-z]+$/.test(basename(f)));
  const pascal = files.filter(f => /^[A-Z][a-zA-Z0-9]+\.[a-z]+$/.test(basename(f)));

  if (kebab.length > camel.length && kebab.length > pascal.length) {
    patterns.push('- Files: **kebab-case** (e.g., `my-component.ts`)');
  } else if (pascal.length > camel.length) {
    patterns.push('- Files: **PascalCase** (e.g., `MyComponent.tsx`)');
  } else if (camel.length > 0) {
    patterns.push('- Files: **camelCase** (e.g., `myComponent.ts`)');
  }

  // Variable/function naming from source
  const sampleContent = readSampleFiles(cwd, files.slice(0, 10));
  const snakeVars = (sampleContent.match(/\b[a-z]+_[a-z]+\b/g) || []).length;
  const camelVars = (sampleContent.match(/\b[a-z]+[A-Z][a-z]+\b/g) || []).length;

  if (snakeVars > camelVars * 2) {
    patterns.push('- Variables/functions: **snake_case**');
  } else if (camelVars > snakeVars * 2) {
    patterns.push('- Variables/functions: **camelCase**');
  }

  // Type/interface naming
  if (sampleContent.includes('interface I') || sampleContent.match(/interface I[A-Z]/)) {
    patterns.push('- Interfaces: **I-prefixed** (e.g., `IUserService`)');
  } else if (sampleContent.match(/interface [A-Z][a-z]/)) {
    patterns.push('- Interfaces: **PascalCase, no prefix** (e.g., `UserService`)');
  }

  if (sampleContent.match(/type T[A-Z]/)) {
    patterns.push('- Types: **T-prefixed** (e.g., `TUserProps`)');
  }

  if (patterns.length === 0) return null;
  return `### Naming Conventions\n${patterns.join('\n')}`;
}

function analyzeStructure(cwd: string): string | null {
  const patterns: string[] = [];

  // Detect organization style
  const srcDir = join(cwd, 'src');
  if (existsSync(srcDir)) {
    const srcEntries = safeReadDir(srcDir);

    // Feature-based vs layer-based
    const featureDirs = ['features', 'modules', 'domains', 'pages'];
    const layerDirs = ['components', 'services', 'utils', 'hooks', 'models', 'controllers', 'routes'];

    const hasFeature = featureDirs.some(d => srcEntries.includes(d));
    const hasLayers = layerDirs.filter(d => srcEntries.includes(d)).length;

    if (hasFeature) {
      patterns.push('- Organization: **feature-based** (features/modules directories)');
    } else if (hasLayers >= 3) {
      patterns.push('- Organization: **layer-based** (components/, services/, utils/, etc.)');
    }

    // Barrel exports
    const indexFiles = srcEntries.filter(e => e === 'index.ts' || e === 'index.js');
    if (indexFiles.length > 0) {
      patterns.push('- Uses **barrel exports** (index.ts re-exports)');
    }

    // Co-located tests
    const hasTestDirs = srcEntries.includes('__tests__') || srcEntries.includes('tests');
    const hasColocatedTests = collectSourceFiles(srcDir, 2).some(f => /\.(test|spec)\.(ts|tsx|js)$/.test(f));

    if (hasColocatedTests && !hasTestDirs) {
      patterns.push('- Tests: **co-located** with source files');
    } else if (hasTestDirs) {
      patterns.push('- Tests: **separate directory** (__tests__/ or tests/)');
    }
  }

  // Root test directory
  const rootTestDirs = ['test', 'tests', 'e2e', 'spec', '__tests__'];
  const foundTestDirs = rootTestDirs.filter(d => existsSync(join(cwd, d)));
  if (foundTestDirs.length > 0) {
    patterns.push(`- Root test directories: ${foundTestDirs.map(d => `\`${d}/\``).join(', ')}`);
  }

  if (patterns.length === 0) return null;
  return `### Project Structure\n${patterns.join('\n')}`;
}

function analyzeImports(cwd: string): string | null {
  const files = collectSourceFiles(cwd, 3);
  const content = readSampleFiles(cwd, files.slice(0, 15));
  if (!content) return null;

  const patterns: string[] = [];

  // Path aliases
  if (content.includes("from '@/") || content.includes("from '~/")) {
    const alias = content.includes("from '@/") ? '@/' : '~/';
    patterns.push(`- Path alias: \`${alias}\` for project root imports`);
  }

  // ESM vs CJS
  const esmImports = (content.match(/^import\s/gm) || []).length;
  const cjsRequires = (content.match(/require\(/g) || []).length;

  if (esmImports > cjsRequires * 3) {
    patterns.push('- Module system: **ESM** (`import/export`)');
  } else if (cjsRequires > esmImports * 3) {
    patterns.push('- Module system: **CommonJS** (`require/module.exports`)');
  }

  // .js extensions in imports
  if (content.match(/from\s+'[^']+\.js'/)) {
    patterns.push('- Import extensions: **explicit .js** in import paths');
  }

  // Type-only imports
  if (content.match(/import\s+type\s/)) {
    patterns.push('- Uses **type-only imports** (`import type { ... }`)');
  }

  if (patterns.length === 0) return null;
  return `### Import Patterns\n${patterns.join('\n')}`;
}

function analyzeTestPatterns(cwd: string): string | null {
  const testFiles = collectTestFiles(cwd, 3);
  if (testFiles.length === 0) return null;

  const patterns: string[] = [];
  const content = readSampleFiles(cwd, testFiles.slice(0, 8));

  // Test file naming
  const specFiles = testFiles.filter(f => f.includes('.spec.'));
  const testNameFiles = testFiles.filter(f => f.includes('.test.'));
  if (specFiles.length > testNameFiles.length) {
    patterns.push('- Test files: **`*.spec.ts`** pattern');
  } else if (testNameFiles.length > 0) {
    patterns.push('- Test files: **`*.test.ts`** pattern');
  }

  // Framework detection
  if (content.includes("from 'vitest'") || content.includes('from "vitest"')) {
    patterns.push('- Framework: **Vitest**');
  } else if (content.includes("from '@jest'") || content.includes("from 'jest'") || content.includes('jest.')) {
    patterns.push('- Framework: **Jest**');
  }

  if (content.includes("from '@playwright/test'")) {
    patterns.push('- E2E: **Playwright**');
  }

  if (content.includes('@testing-library')) {
    patterns.push('- DOM testing: **Testing Library**');
  }

  // Test style
  if (content.match(/describe\s*\(/)) {
    patterns.push('- Style: **describe/it blocks** (BDD)');
  }

  if (content.match(/test\s*\(/)) {
    patterns.push('- Style: **test() blocks**');
  }

  // Assertion style
  if (content.includes('.toBe(') || content.includes('.toEqual(')) {
    patterns.push('- Assertions: **expect().toX()** (Jest/Vitest)');
  }

  if (patterns.length === 0) return null;
  return `### Testing Conventions\n${patterns.join('\n')}`;
}

function analyzeComponentPatterns(cwd: string): string | null {
  const files = collectSourceFiles(cwd, 3);
  const content = readSampleFiles(cwd, files.filter(f => /\.(tsx|jsx)$/.test(f)).slice(0, 10));
  if (!content) return null;

  const patterns: string[] = [];

  // Functional vs class components
  const funcComponents = (content.match(/(?:export\s+(?:default\s+)?function|const\s+\w+\s*[=:]\s*(?:\([^)]*\)\s*=>|React\.FC))/g) || []).length;
  const classComponents = (content.match(/class\s+\w+\s+extends\s+(?:React\.)?Component/g) || []).length;

  if (funcComponents > 0 && classComponents === 0) {
    patterns.push('- Components: **functional only** (no class components)');
  } else if (classComponents > funcComponents) {
    patterns.push('- Components: **class-based**');
  }

  // Hook patterns
  if (content.includes('useState')) patterns.push('- State: **useState** hooks');
  if (content.includes('useReducer')) patterns.push('- Complex state: **useReducer**');
  if (content.includes('useContext')) patterns.push('- Shared state: **React Context**');

  // Styling
  if (content.includes('className=') && content.match(/className="[^"]*\b(flex|grid|p-|m-|text-|bg-)/)) {
    patterns.push('- Styling: **Tailwind CSS** (utility classes)');
  } else if (content.match(/styled\.|css`/)) {
    patterns.push('- Styling: **CSS-in-JS** (styled-components/emotion)');
  } else if (content.includes('.module.css') || content.includes('.module.scss')) {
    patterns.push('- Styling: **CSS Modules**');
  }

  // Props typing
  if (content.match(/:\s*React\.FC</)) {
    patterns.push('- Props: **React.FC<Props>** typing');
  } else if (content.match(/\(\s*\{\s*\w+\s*\}\s*:\s*\w+Props\s*\)/)) {
    patterns.push('- Props: **destructured with Props interface**');
  }

  if (patterns.length === 0) return null;
  return `### Component Patterns\n${patterns.join('\n')}`;
}

function analyzeErrorPatterns(cwd: string): string | null {
  const files = collectSourceFiles(cwd, 3);
  const content = readSampleFiles(cwd, files.slice(0, 15));
  if (!content) return null;

  const patterns: string[] = [];

  if (content.match(/class\s+\w+Error\s+extends\s+Error/)) {
    patterns.push('- Uses **custom error classes** (extends Error)');
  }

  if (content.match(/Result<|Ok\(|Err\(/)) {
    patterns.push('- Uses **Result type** pattern for error handling');
  }

  if (content.match(/\.catch\(\s*\(\s*\w+\s*\)\s*=>/)) {
    patterns.push('- Promise errors: **.catch() chains**');
  }

  if (content.match(/try\s*\{[\s\S]{10,200}catch/)) {
    patterns.push('- Uses **try/catch blocks**');
  }

  if (patterns.length === 0) return null;
  return `### Error Handling\n${patterns.join('\n')}`;
}

function analyzeConfigPatterns(cwd: string): string | null {
  const patterns: string[] = [];

  if (existsSync(join(cwd, '.env')) || existsSync(join(cwd, '.env.local'))) {
    patterns.push('- Environment: **.env files** for configuration');
  }

  if (existsSync(join(cwd, 'tsconfig.json'))) {
    patterns.push('- Language: **TypeScript**');
    try {
      const tsconfig = JSON.parse(readFileSync(join(cwd, 'tsconfig.json'), 'utf-8'));
      if (tsconfig.compilerOptions?.strict) patterns.push('- TypeScript: **strict mode** enabled');
      if (tsconfig.compilerOptions?.paths) patterns.push('- TypeScript: **path aliases** configured');
    } catch { /* ignore */ }
  }

  if (existsSync(join(cwd, '.eslintrc.js')) || existsSync(join(cwd, '.eslintrc.json')) || existsSync(join(cwd, 'eslint.config.js'))) {
    patterns.push('- Linting: **ESLint** configured');
  }

  if (existsSync(join(cwd, '.prettierrc')) || existsSync(join(cwd, '.prettierrc.json'))) {
    patterns.push('- Formatting: **Prettier** configured');
  }

  if (existsSync(join(cwd, 'biome.json'))) {
    patterns.push('- Linting/Formatting: **Biome**');
  }

  if (patterns.length === 0) return null;
  return `### Config & Tooling\n${patterns.join('\n')}`;
}

// ── Helpers ──────────────────────────────────────────────────────

const IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', '.swarm', '.next',
  '__pycache__', '.venv', 'venv', 'target', '.build', 'coverage',
  '.cache', '.turbo', '.nuxt',
]);

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.go', '.py', '.rs', '.swift']);

function basename(path: string): string {
  return path.split('/').pop() || path;
}

function safeReadDir(dir: string): string[] {
  try { return readdirSync(dir); } catch { return []; }
}

function collectSourceFiles(dir: string, maxDepth: number, depth = 0): string[] {
  if (depth >= maxDepth) return [];
  const results: string[] = [];
  for (const entry of safeReadDir(dir)) {
    if (IGNORE.has(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    try {
      if (statSync(full).isDirectory()) {
        results.push(...collectSourceFiles(full, maxDepth, depth + 1));
      } else if (SOURCE_EXTS.has(extname(entry))) {
        results.push(full);
      }
    } catch { /* skip */ }
  }
  return results;
}

function collectTestFiles(dir: string, maxDepth: number, depth = 0): string[] {
  if (depth >= maxDepth) return [];
  const results: string[] = [];
  for (const entry of safeReadDir(dir)) {
    if (IGNORE.has(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    try {
      if (statSync(full).isDirectory()) {
        results.push(...collectTestFiles(full, maxDepth, depth + 1));
      } else if (/\.(test|spec)\.(ts|tsx|js|jsx)$|_test\.go$|test_.*\.py$/.test(entry)) {
        results.push(full);
      }
    } catch { /* skip */ }
  }
  return results;
}

function readSampleFiles(cwd: string, files: string[]): string {
  const chunks: string[] = [];
  let totalLen = 0;
  const maxLen = 50000;
  for (const f of files) {
    if (totalLen >= maxLen) break;
    try {
      const content = readFileSync(f, 'utf-8');
      const slice = content.slice(0, 5000);
      chunks.push(slice);
      totalLen += slice.length;
    } catch { /* skip */ }
  }
  return chunks.join('\n');
}
