import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import chalk from 'chalk';
import type { GuardrailRule, GuardrailCheck, GuardrailViolation, GuardrailPreset, GuardrailFix } from '../types.js';

// Default guardrail rules
const DEFAULT_RULES: GuardrailRule[] = [
  {
    name: 'REQUIREMENTS.md structure',
    target: 'REQUIREMENTS.md',
    checks: [
      {
        type: 'section-exists', value: 'Original Requirement',
        message: 'Missing "0. Original Requirement" section',
        fix: { type: 'insert-section', description: 'Add ## Original Requirement section', patch: '## 0. Original Requirement\n\nTODO: Paste the original feature request or requirement here.\n', location: 'append' },
      },
      {
        type: 'section-exists', value: 'Summary',
        message: 'Missing "1. Summary" section',
        fix: { type: 'insert-section', description: 'Add ## Summary section', patch: '## 1. Summary\n\nTODO: Add a brief summary of the requirements.\n', location: 'append' },
      },
      {
        type: 'section-exists', value: 'Scope',
        message: 'Missing "2. Scope" section',
        fix: { type: 'insert-section', description: 'Add ## Scope section', patch: '## 2. Scope\n\nTODO: Define what is in and out of scope.\n', location: 'append' },
      },
      {
        type: 'section-exists', value: 'Functional Requirements',
        message: 'Missing "3. Functional Requirements" section',
        fix: { type: 'insert-section', description: 'Add ## Functional Requirements section', patch: '## 3. Functional Requirements\n\nTODO: List functional requirements with user stories.\n', location: 'append' },
      },
      {
        type: 'section-exists', value: 'Data Requirements',
        message: 'Missing "4. Data Requirements" section',
        fix: { type: 'insert-section', description: 'Add ## Data Requirements section', patch: '## 4. Data Requirements\n\nTODO: Define data models, storage, and data flow.\n', location: 'append' },
      },
      {
        type: 'section-exists', value: 'Non-Functional Requirements',
        message: 'Missing "6. Non-Functional Requirements" section',
        fix: { type: 'insert-section', description: 'Add ## Non-Functional Requirements section', patch: '## 6. Non-Functional Requirements\n\nTODO: Define performance, security, and scalability requirements.\n', location: 'append' },
      },
      { type: 'section-exists', value: 'Integration', message: 'Missing "7. Integration" section', severity: 'warning',
        fix: { type: 'insert-section', description: 'Add ## Integration section', patch: '## 7. Integration\n\nTODO: Describe external integrations and APIs.\n', location: 'append' },
      },
      { type: 'section-exists', value: 'Testing', message: 'Missing "8. Testing" section', severity: 'warning',
        fix: { type: 'insert-section', description: 'Add ## Testing section', patch: '## 8. Testing\n\nTODO: Define testing strategy and E2E scenarios.\n', location: 'append' },
      },
      { type: 'section-exists', value: 'Open Questions', message: 'Missing "10. Open Questions" section', severity: 'warning',
        fix: { type: 'insert-section', description: 'Add ## Open Questions section', patch: '## 10. Open Questions\n\nTODO: List unresolved questions and assumptions.\n', location: 'append' },
      },
      { type: 'pattern-match', value: 'As a .+ I want .+ So that', message: 'No user stories found (As a/I want/So that format)', severity: 'warning',
        fix: { type: 'insert-pattern', description: 'Add user story template', patch: '\nAs a [user] I want [feature] So that [benefit]\n\nGiven [context] When [action] Then [result]\n', location: 'after-section', afterSection: 'Functional Requirements' },
      },
      { type: 'pattern-match', value: 'Given .+ [Ww]hen .+ [Tt]hen', message: 'No Given/When/Then acceptance criteria found', severity: 'warning',
        fix: { type: 'insert-pattern', description: 'Add Given/When/Then template', patch: '\nGiven [precondition]\nWhen [action]\nThen [expected result]\n', location: 'after-section', afterSection: 'Functional Requirements' },
      },
      { type: 'pattern-match', value: 'E2E', message: 'No E2E scenarios in Testing section', severity: 'warning' },
      { type: 'min-length', value: '200', message: 'REQUIREMENTS.md is too short — likely incomplete', severity: 'warning',
        fix: { type: 'extend-content', description: 'Content is too short — expand sections', patch: '\n<!-- TODO: Expand this document. Minimum 200 characters expected. -->\n', location: 'append' },
      },
      { type: 'word-count', value: 'Functional Requirements:20', message: 'Functional Requirements section has too few words — needs more detail', severity: 'warning',
        fix: { type: 'extend-content', description: 'Expand Functional Requirements section', patch: '\n<!-- TODO: Add more detail to Functional Requirements (minimum 20 words). -->\n', location: 'after-section', afterSection: 'Functional Requirements' },
      },
    ],
  },
  {
    name: 'SPEC.md structure',
    target: 'SPEC.md',
    checks: [
      {
        type: 'section-exists', value: 'Overview',
        message: 'Missing "Overview" section',
        fix: { type: 'insert-section', description: 'Add ## Overview section', patch: '## Overview\n\nTODO: Provide a high-level overview of the system.\n', location: 'append' },
      },
      {
        type: 'section-exists', value: 'Requirements Summary',
        message: 'Missing "Requirements Summary" section',
        fix: { type: 'insert-section', description: 'Add ## Requirements Summary section', patch: '## Requirements Summary\n\nTODO: Summarize the key requirements from REQUIREMENTS.md.\n', location: 'append' },
      },
      {
        type: 'section-exists', value: 'Architecture',
        message: 'Missing architecture section',
        fix: { type: 'insert-section', description: 'Add ## Architecture section', patch: '## Architecture\n\nTODO: Add system architecture diagram and component descriptions.\n', location: 'append' },
      },
      {
        type: 'section-exists', value: 'Architecture Decision Records',
        message: 'Missing "Architecture Decision Records" section',
        fix: { type: 'insert-section', description: 'Add ## Architecture Decision Records section', patch: '## Architecture Decision Records\n\n### ADR-1: [Decision Title]\n\n**Status:** Proposed\n**Context:** TODO\n**Decision:** TODO\n**Consequences:** TODO\n', location: 'append' },
      },
      {
        type: 'section-exists', value: 'API',
        message: 'Missing API specification section',
        fix: { type: 'insert-section', description: 'Add ## API section', patch: '## API\n\nTODO: Define API endpoints, request/response schemas.\n', location: 'append' },
      },
      { type: 'section-exists', value: 'Data Model', message: 'Missing "Data Model" section', severity: 'warning',
        fix: { type: 'insert-section', description: 'Add ## Data Model section', patch: '## Data Model\n\nTODO: Define data models and relationships.\n', location: 'append' },
      },
      { type: 'section-exists', value: 'Performance Strategy', message: 'Missing "Performance Strategy" section', severity: 'warning',
        fix: { type: 'insert-section', description: 'Add ## Performance Strategy section', patch: '## Performance Strategy\n\nTODO: Define performance targets and optimization strategies.\n', location: 'append' },
      },
      {
        type: 'section-exists', value: 'Testing Strategy',
        message: 'Missing "Testing Strategy" section',
        fix: { type: 'insert-section', description: 'Add ## Testing Strategy section', patch: '## Testing Strategy\n\nTODO: Define unit, integration, and E2E testing approach.\n', location: 'append' },
      },
      {
        type: 'section-exists', value: 'Security',
        message: 'Missing "Security" section',
        fix: { type: 'insert-section', description: 'Add ## Security section', patch: '## Security\n\nTODO: Define authentication, authorization, and security considerations.\n', location: 'append' },
      },
      { type: 'section-exists', value: 'Implementation Checklist', message: 'Missing "Implementation Checklist" section', severity: 'warning',
        fix: { type: 'insert-section', description: 'Add ## Implementation Checklist section', patch: '## Implementation Checklist\n\n- [ ] TODO: Add implementation steps\n', location: 'append' },
      },
      { type: 'section-exists', value: 'File Structure', message: 'Missing "File Structure" section', severity: 'warning',
        fix: { type: 'insert-section', description: 'Add ## File Structure section', patch: '## File Structure\n\n```\nTODO: Add project file structure\n```\n', location: 'append' },
      },
      { type: 'section-exists', value: 'Open Questions', message: 'Missing "Open Questions" section', severity: 'warning',
        fix: { type: 'insert-section', description: 'Add ## Open Questions section', patch: '## Open Questions\n\nTODO: List unresolved questions.\n', location: 'append' },
      },
      { type: 'pattern-match', value: '```mermaid', message: 'No Mermaid diagrams found', severity: 'warning' },
      { type: 'pattern-match', value: 'ADR-\\d', message: 'No ADR entries found (ADR-1, ADR-2 pattern)', severity: 'warning',
        fix: { type: 'insert-pattern', description: 'Add ADR entry template', patch: '\n### ADR-1: [Decision Title]\n\n**Status:** Proposed\n**Context:** TODO\n**Decision:** TODO\n**Consequences:** TODO\n', location: 'after-section', afterSection: 'Architecture Decision Records' },
      },
      { type: 'min-length', value: '300', message: 'SPEC.md is too short — likely incomplete', severity: 'warning',
        fix: { type: 'extend-content', description: 'Content is too short — expand sections', patch: '\n<!-- TODO: Expand this document. Minimum 300 characters expected. -->\n', location: 'append' },
      },
      { type: 'word-count', value: 'Architecture:30', message: 'Architecture section needs more detail', severity: 'warning',
        fix: { type: 'extend-content', description: 'Expand Architecture section', patch: '\n<!-- TODO: Add more detail to Architecture (minimum 30 words). -->\n', location: 'after-section', afterSection: 'Architecture' },
      },
    ],
  },
  {
    name: 'TASKS.md structure',
    target: 'TASKS.md',
    checks: [
      { type: 'pattern-match', value: 'T\\d{3}|[A-Z]{2,4}-\\d{3}', message: 'No task IDs found (expected T001 or FND-001 pattern)',
        fix: { type: 'insert-pattern', description: 'Add task ID template', patch: '\n- [ ] FND-001: [Task description] `path/to/file.ts`\n  AC: [Acceptance criteria]\n  Depends on: none\n', location: 'append' },
      },
      { type: 'pattern-match', value: '\\[\\s*\\]', message: 'No pending tasks found (checkbox markers)',
        fix: { type: 'insert-pattern', description: 'Add task checkbox template', patch: '\n- [ ] TODO: Add tasks\n', location: 'append' },
      },
      { type: 'pattern-match', value: '\\[P\\]', message: 'No [P] parallel markers found — tasks should be marked for parallelization', severity: 'warning' },
      { type: 'pattern-match', value: '\\[US\\d', message: 'No [USn] user story labels found', severity: 'warning' },
      { type: 'pattern-match', value: 'AC:', message: 'No acceptance criteria found (AC: markers)', severity: 'warning' },
      { type: 'pattern-match', value: 'Depends on:', message: 'No dependency declarations found', severity: 'warning' },
      { type: 'section-exists', value: 'Dependencies & Execution Order', message: 'Missing "Dependencies & Execution Order" section', severity: 'warning',
        fix: { type: 'insert-section', description: 'Add ## Dependencies & Execution Order section', patch: '## Dependencies & Execution Order\n\nTODO: Define task dependencies and execution order.\n', location: 'append' },
      },
      { type: 'section-exists', value: 'Phase', message: 'No Phase sections found — tasks should be organized into phases',
        fix: { type: 'insert-section', description: 'Add ## Phase 1 section', patch: '## Phase 1: Foundation\n\nTODO: Add tasks for this phase.\n', location: 'append' },
      },
      { type: 'pattern-match', value: '`[^`]+\\.[a-z]{1,4}`', message: 'No file paths found — every task should reference a specific file', severity: 'warning' },
      { type: 'pattern-match', value: '\\[E2E\\]', message: 'No [E2E] test tasks found', severity: 'warning' },
      { type: 'pattern-match', value: 'e2e/.*\\.spec\\.ts', message: 'No E2E test file paths found', severity: 'warning' },
    ],
  },
  {
    name: 'TESTPLAN.md structure',
    target: 'TESTPLAN.md',
    checks: [
      {
        type: 'section-exists', value: 'Overview',
        message: 'Missing "Overview" section',
        fix: { type: 'insert-section', description: 'Add ## Overview section', patch: '## Overview\n\nTODO: Describe the test plan overview.\n', location: 'append' },
      },
      {
        type: 'section-exists', value: 'Test Strategy',
        message: 'Missing "Test Strategy" section',
        fix: { type: 'insert-section', description: 'Add ## Test Strategy section', patch: '## Test Strategy\n\nTODO: Define testing approach (unit, integration, E2E).\n', location: 'append' },
      },
      {
        type: 'section-exists', value: 'E2E Test Cases',
        message: 'Missing "E2E Test Cases" section',
        fix: { type: 'insert-section', description: 'Add ## E2E Test Cases section', patch: '## E2E Test Cases\n\n### TC-001: [Test Case Title]\n\n**Steps:**\n1. TODO\n\n**Expected:** TODO\n', location: 'append' },
      },
      { type: 'section-exists', value: 'Authentication', message: 'Missing "Authentication" section', severity: 'warning',
        fix: { type: 'insert-section', description: 'Add ## Authentication section', patch: '## Authentication\n\nTODO: Define authentication test scenarios.\n', location: 'append' },
      },
      { type: 'section-exists', value: 'Test Data', message: 'Missing "Test Data" section', severity: 'warning',
        fix: { type: 'insert-section', description: 'Add ## Test Data section', patch: '## Test Data\n\nTODO: Define test data requirements and fixtures.\n', location: 'append' },
      },
      { type: 'section-exists', value: 'Acceptance Criteria', message: 'Missing "Acceptance Criteria" section', severity: 'warning',
        fix: { type: 'insert-section', description: 'Add ## Acceptance Criteria section', patch: '## Acceptance Criteria\n\nTODO: Map acceptance criteria to test cases.\n', location: 'append' },
      },
      { type: 'pattern-match', value: 'TC-\\d{3}', message: 'No test case IDs found (TC-001 pattern)',
        fix: { type: 'insert-pattern', description: 'Add test case template', patch: '\n### TC-001: [Test Case Title]\n\n**Steps:**\n1. TODO\n\n**Expected:** TODO\n', location: 'after-section', afterSection: 'E2E Test Cases' },
      },
      { type: 'pattern-match', value: 'e2e/.*\\.spec\\.ts', message: 'No E2E test file paths found', severity: 'warning' },
    ],
  },
];

// Critical section names for 'lenient' preset (always error-level)
const CRITICAL_SECTIONS = new Set([
  'Original Requirement', 'Summary', 'Scope', 'Functional Requirements',
  'Overview', 'Architecture', 'Phase',
  'Test Strategy', 'E2E Test Cases',
]);

export class GuardrailsEngine {
  private rules: GuardrailRule[];
  private preset: GuardrailPreset;

  constructor(swarmDir?: string, preset: GuardrailPreset = 'standard') {
    this.preset = preset;
    this.rules = [...DEFAULT_RULES];

    // Load custom rules from .swarm/guardrails.yaml
    if (swarmDir) {
      const customPath = join(swarmDir, 'guardrails.yaml');
      if (existsSync(customPath)) {
        try {
          const raw = readFileSync(customPath, 'utf-8');
          const parsed = parseYaml(raw) as { rules?: GuardrailRule[] };
          if (parsed.rules) {
            this.rules.push(...parsed.rules);
          }
        } catch {
          // Ignore invalid YAML
        }
      }
    }

    // Apply preset severity overrides
    if (preset !== 'standard') {
      this.applyPreset(preset);
    }
  }

  private applyPreset(preset: GuardrailPreset): void {
    for (const rule of this.rules) {
      for (const check of rule.checks) {
        switch (preset) {
          case 'strict':
            check.severity = 'error';
            break;
          case 'lenient':
            if (check.type === 'section-exists' && CRITICAL_SECTIONS.has(check.value)) {
              check.severity = 'error';
            } else {
              check.severity = 'warning';
            }
            break;
          // 'off' is handled in evaluate — skip all checks
        }
      }
    }
  }

  evaluate(cwd: string): GuardrailViolation[] {
    if (this.preset === 'off') return [];

    const violations: GuardrailViolation[] = [];

    for (const rule of this.rules) {
      const filePath = join(cwd, rule.target);

      if (!existsSync(filePath)) {
        violations.push({
          rule: rule.name,
          check: 'file-exists',
          file: filePath,
          message: `Artifact not found: ${rule.target}. Run the corresponding pipeline stage first.`,
          severity: 'error',
        });
        continue;
      }

      const content = readFileSync(filePath, 'utf-8');

      for (const check of rule.checks) {
        const violation = this.runCheck(check, content, filePath, rule.name);
        if (violation) {
          violations.push(violation);
        }
      }
    }

    return violations;
  }

  /** Evaluate guardrails for a single artifact file. Returns only violations for that artifact. */
  evaluateArtifact(cwd: string, artifact: string): GuardrailViolation[] {
    if (this.preset === 'off') return [];

    const violations: GuardrailViolation[] = [];
    const matchingRules = this.rules.filter(r => r.target === artifact);

    if (matchingRules.length === 0) {
      return violations;
    }

    for (const rule of matchingRules) {
      const filePath = join(cwd, rule.target);

      if (!existsSync(filePath)) {
        violations.push({
          rule: rule.name,
          check: 'file-exists',
          file: filePath,
          message: `Artifact not found: ${rule.target}. Run the corresponding pipeline stage first.`,
          severity: 'error',
        });
        continue;
      }

      const content = readFileSync(filePath, 'utf-8');
      for (const check of rule.checks) {
        const violation = this.runCheck(check, content, filePath, rule.name);
        if (violation) {
          violations.push(violation);
        }
      }
    }

    return violations;
  }

  private runCheck(
    check: GuardrailCheck,
    content: string,
    filePath: string,
    ruleName: string,
  ): GuardrailViolation | null {
    switch (check.type) {
      case 'section-exists': {
        const pattern = new RegExp(`^#{1,4}\\s+.*${this.escapeRegex(check.value)}`, 'mi');
        if (!pattern.test(content)) {
          return {
            rule: ruleName,
            check: `section-exists: ${check.value}`,
            file: filePath,
            message: check.message,
            severity: check.severity ?? 'error',
            fix: check.fix,
          };
        }
        return null;
      }

      case 'pattern-match': {
        const pattern = new RegExp(check.value, 'm');
        if (!pattern.test(content)) {
          return {
            rule: ruleName,
            check: `pattern-match: ${check.value}`,
            file: filePath,
            message: check.message,
            severity: check.severity ?? 'error',
            fix: check.fix,
          };
        }
        return null;
      }

      case 'command': {
        try {
          execSync(check.value, { cwd: filePath, stdio: 'pipe', timeout: 30000 });
          return null;
        } catch {
          return {
            rule: ruleName,
            check: `command: ${check.value}`,
            file: filePath,
            message: check.message,
            severity: check.severity ?? 'error',
            fix: check.fix,
          };
        }
      }

      case 'min-length': {
        // value is the minimum character count (e.g., "50")
        const minLen = parseInt(check.value, 10);
        if (isNaN(minLen)) return null;
        if (content.trim().length < minLen) {
          return {
            rule: ruleName,
            check: `min-length: ${check.value}`,
            file: filePath,
            message: check.message || `Content too short (${content.trim().length} < ${minLen} chars)`,
            severity: check.severity ?? 'warning',
            fix: check.fix,
          };
        }
        return null;
      }

      case 'word-count': {
        // value format: "sectionName:minWords" e.g., "Functional Requirements:20"
        const [sectionName, minWordsStr] = check.value.split(':');
        const minWords = parseInt(minWordsStr, 10);
        if (!sectionName || isNaN(minWords)) return null;

        // Extract section content between this heading and the next
        const sectionPattern = new RegExp(
          `^#{1,4}\\s+.*${this.escapeRegex(sectionName)}.*$([\\s\\S]*?)(?=^#{1,4}\\s|$)`,
          'mi',
        );
        const sectionMatch = content.match(sectionPattern);
        const sectionContent = sectionMatch?.[1] ?? '';
        const wordCount = sectionContent.trim().split(/\s+/).filter(Boolean).length;

        if (wordCount < minWords) {
          return {
            rule: ruleName,
            check: `word-count: ${check.value}`,
            file: filePath,
            message: check.message || `Section "${sectionName}" has only ${wordCount} words (min: ${minWords})`,
            severity: check.severity ?? 'warning',
            fix: check.fix,
          };
        }
        return null;
      }

      case 'required-patterns': {
        // value is comma-separated patterns that ALL must match
        // e.g., "Given,When,Then" or "ADR-\\d,```mermaid"
        const patterns = check.value.split(',').map(p => p.trim());
        const missing = patterns.filter(p => {
          try {
            return !new RegExp(p, 'm').test(content);
          } catch {
            return false;
          }
        });

        if (missing.length > 0) {
          return {
            rule: ruleName,
            check: `required-patterns: ${check.value}`,
            file: filePath,
            message: check.message || `Missing required patterns: ${missing.join(', ')}`,
            severity: check.severity ?? 'warning',
            fix: check.fix,
          };
        }
        return null;
      }

      default:
        return null;
    }
  }

  /**
   * Apply auto-fixes for all fixable violations.
   * Reads artifact files, inserts missing sections/patterns, writes back.
   */
  applyFixes(cwd: string, violations: GuardrailViolation[]): { fixed: number; skipped: number } {
    let fixed = 0;
    let skipped = 0;

    // Group violations by file
    const byFile = new Map<string, GuardrailViolation[]>();
    for (const v of violations) {
      if (!v.fix) {
        skipped++;
        continue;
      }
      const existing = byFile.get(v.file) ?? [];
      existing.push(v);
      byFile.set(v.file, existing);
    }

    for (const [filePath, fileViolations] of byFile) {
      if (!existsSync(filePath)) {
        // File doesn't exist — skip file-exists violations (can't fix)
        skipped += fileViolations.length;
        continue;
      }

      let content = readFileSync(filePath, 'utf-8');

      for (const v of fileViolations) {
        const fix = v.fix!;

        switch (fix.type) {
          case 'insert-section': {
            if (fix.location === 'append') {
              content = content.trimEnd() + '\n\n' + fix.patch;
              fixed++;
            } else if (fix.location === 'after-section' && fix.afterSection) {
              content = this.insertAfterSection(content, fix.afterSection, fix.patch);
              fixed++;
            } else {
              skipped++;
            }
            break;
          }

          case 'insert-pattern': {
            if (fix.location === 'after-section' && fix.afterSection) {
              content = this.insertAfterSection(content, fix.afterSection, fix.patch);
              fixed++;
            } else if (fix.location === 'append') {
              content = content.trimEnd() + '\n' + fix.patch;
              fixed++;
            } else {
              skipped++;
            }
            break;
          }

          case 'extend-content': {
            if (fix.location === 'after-section' && fix.afterSection) {
              content = this.insertAfterSection(content, fix.afterSection, fix.patch);
              fixed++;
            } else {
              // append
              content = content.trimEnd() + '\n' + fix.patch;
              fixed++;
            }
            break;
          }

          default:
            skipped++;
        }
      }

      writeFileSync(filePath, content, 'utf-8');
    }

    return { fixed, skipped };
  }

  /**
   * Insert content after a matching markdown section heading.
   * Finds the section heading and appends content right after the heading line
   * (before the next section or at the end of the section's content).
   */
  private insertAfterSection(content: string, sectionName: string, patch: string): string {
    const lines = content.split('\n');
    const headingPattern = new RegExp(`^#{1,4}\\s+.*${this.escapeRegex(sectionName)}`, 'i');

    for (let i = 0; i < lines.length; i++) {
      if (headingPattern.test(lines[i])) {
        // Find the end of this section (next heading or EOF)
        let insertAt = lines.length;
        for (let j = i + 1; j < lines.length; j++) {
          if (/^#{1,4}\s/.test(lines[j])) {
            insertAt = j;
            break;
          }
        }
        // Insert before the next heading
        const patchLines = patch.split('\n');
        lines.splice(insertAt, 0, ...patchLines);
        return lines.join('\n');
      }
    }

    // Section not found — append at end
    return content.trimEnd() + '\n' + patch;
  }

  /**
   * Format a pretty CLI report of violations, grouped by file.
   * Uses chalk for colors and ESLint-style output.
   */
  formatReport(violations: GuardrailViolation[], cwd: string): string {
    if (violations.length === 0) {
      return chalk.green('\n  \u2713 All guardrail checks passed\n');
    }

    const lines: string[] = [''];

    // Group by file
    const byFile = new Map<string, GuardrailViolation[]>();
    for (const v of violations) {
      const existing = byFile.get(v.file) ?? [];
      existing.push(v);
      byFile.set(v.file, existing);
    }

    for (const [filePath, fileViolations] of byFile) {
      const relPath = relative(cwd, filePath) || filePath;
      lines.push(chalk.underline(relPath));

      for (const v of fileViolations) {
        const icon = v.severity === 'error' ? chalk.red('\u2717') : chalk.yellow('\u26A0');
        const severity = v.severity === 'error'
          ? chalk.red('error')
          : chalk.yellow('warning');
        const fixHint = v.fix
          ? chalk.dim(` (fixable: ${v.fix.description})`)
          : '';
        lines.push(`  ${icon} ${severity}  ${v.message}${fixHint}`);
      }

      lines.push('');
    }

    // Summary
    const errors = violations.filter(v => v.severity === 'error').length;
    const warnings = violations.filter(v => v.severity === 'warning').length;
    const fixable = violations.filter(v => v.fix).length;

    const parts: string[] = [];
    if (errors > 0) parts.push(chalk.red(`${errors} error${errors !== 1 ? 's' : ''}`));
    if (warnings > 0) parts.push(chalk.yellow(`${warnings} warning${warnings !== 1 ? 's' : ''}`));
    if (fixable > 0) parts.push(chalk.cyan(`${fixable} fixable with --fix`));

    lines.push(`  ${parts.join(', ')}`);
    lines.push('');

    return lines.join('\n');
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  getRules(): GuardrailRule[] {
    return this.rules;
  }

  getPreset(): GuardrailPreset {
    return this.preset;
  }
}
