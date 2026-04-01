import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import type { GuardrailRule, GuardrailCheck, GuardrailViolation } from '../types.js';

// Default guardrail rules
const DEFAULT_RULES: GuardrailRule[] = [
  {
    name: 'REQUIREMENTS.md structure',
    target: 'REQUIREMENTS.md',
    checks: [
      { type: 'section-exists', value: 'Original Requirement', message: 'Missing "0. Original Requirement" section' },
      { type: 'section-exists', value: 'Summary', message: 'Missing "1. Summary" section' },
      { type: 'section-exists', value: 'Scope', message: 'Missing "2. Scope" section' },
      { type: 'section-exists', value: 'Functional Requirements', message: 'Missing "3. Functional Requirements" section' },
      { type: 'section-exists', value: 'Data Requirements', message: 'Missing "4. Data Requirements" section' },
      { type: 'section-exists', value: 'Non-Functional Requirements', message: 'Missing "6. Non-Functional Requirements" section' },
      { type: 'section-exists', value: 'Integration', message: 'Missing "7. Integration" section', severity: 'warning' },
      { type: 'section-exists', value: 'Testing', message: 'Missing "8. Testing" section', severity: 'warning' },
      { type: 'section-exists', value: 'Open Questions', message: 'Missing "10. Open Questions" section', severity: 'warning' },
      { type: 'pattern-match', value: 'As a .+ I want .+ So that', message: 'No user stories found (As a/I want/So that format)', severity: 'warning' },
      { type: 'pattern-match', value: 'Given .+ [Ww]hen .+ [Tt]hen', message: 'No Given/When/Then acceptance criteria found', severity: 'warning' },
      { type: 'pattern-match', value: 'E2E', message: 'No E2E scenarios in Testing section', severity: 'warning' },
      { type: 'min-length', value: '200', message: 'REQUIREMENTS.md is too short — likely incomplete', severity: 'warning' },
      { type: 'word-count', value: 'Functional Requirements:20', message: 'Functional Requirements section has too few words — needs more detail', severity: 'warning' },
    ],
  },
  {
    name: 'SPEC.md structure',
    target: 'SPEC.md',
    checks: [
      { type: 'section-exists', value: 'Overview', message: 'Missing "Overview" section' },
      { type: 'section-exists', value: 'Requirements Summary', message: 'Missing "Requirements Summary" section' },
      { type: 'section-exists', value: 'Architecture', message: 'Missing architecture section' },
      { type: 'section-exists', value: 'Architecture Decision Records', message: 'Missing "Architecture Decision Records" section' },
      { type: 'section-exists', value: 'API', message: 'Missing API specification section' },
      { type: 'section-exists', value: 'Data Model', message: 'Missing "Data Model" section', severity: 'warning' },
      { type: 'section-exists', value: 'Performance Strategy', message: 'Missing "Performance Strategy" section', severity: 'warning' },
      { type: 'section-exists', value: 'Testing Strategy', message: 'Missing "Testing Strategy" section' },
      { type: 'section-exists', value: 'Security', message: 'Missing "Security" section' },
      { type: 'section-exists', value: 'Implementation Checklist', message: 'Missing "Implementation Checklist" section', severity: 'warning' },
      { type: 'section-exists', value: 'File Structure', message: 'Missing "File Structure" section', severity: 'warning' },
      { type: 'section-exists', value: 'Open Questions', message: 'Missing "Open Questions" section', severity: 'warning' },
      { type: 'pattern-match', value: '```mermaid', message: 'No Mermaid diagrams found', severity: 'warning' },
      { type: 'pattern-match', value: 'ADR-\\d', message: 'No ADR entries found (ADR-1, ADR-2 pattern)', severity: 'warning' },
      { type: 'min-length', value: '300', message: 'SPEC.md is too short — likely incomplete', severity: 'warning' },
      { type: 'word-count', value: 'Architecture:30', message: 'Architecture section needs more detail', severity: 'warning' },
    ],
  },
  {
    name: 'TASKS.md structure',
    target: 'TASKS.md',
    checks: [
      { type: 'pattern-match', value: 'T\\d{3}|[A-Z]{2,4}-\\d{3}', message: 'No task IDs found (expected T001 or FND-001 pattern)' },
      { type: 'pattern-match', value: '\\[\\s*\\]', message: 'No pending tasks found (checkbox markers)' },
      { type: 'pattern-match', value: '\\[P\\]', message: 'No [P] parallel markers found — tasks should be marked for parallelization', severity: 'warning' },
      { type: 'pattern-match', value: '\\[US\\d', message: 'No [USn] user story labels found', severity: 'warning' },
      { type: 'pattern-match', value: 'AC:', message: 'No acceptance criteria found (AC: markers)', severity: 'warning' },
      { type: 'pattern-match', value: 'Depends on:', message: 'No dependency declarations found', severity: 'warning' },
      { type: 'section-exists', value: 'Dependencies & Execution Order', message: 'Missing "Dependencies & Execution Order" section', severity: 'warning' },
      { type: 'section-exists', value: 'Phase', message: 'No Phase sections found — tasks should be organized into phases' },
      { type: 'pattern-match', value: '`[^`]+\\.[a-z]{1,4}`', message: 'No file paths found — every task should reference a specific file', severity: 'warning' },
      { type: 'pattern-match', value: '\\[E2E\\]', message: 'No [E2E] test tasks found', severity: 'warning' },
      { type: 'pattern-match', value: 'e2e/.*\\.spec\\.ts', message: 'No E2E test file paths found', severity: 'warning' },
    ],
  },
  {
    name: 'TESTPLAN.md structure',
    target: 'TESTPLAN.md',
    checks: [
      { type: 'section-exists', value: 'Overview', message: 'Missing "Overview" section' },
      { type: 'section-exists', value: 'Test Strategy', message: 'Missing "Test Strategy" section' },
      { type: 'section-exists', value: 'E2E Test Cases', message: 'Missing "E2E Test Cases" section' },
      { type: 'section-exists', value: 'Authentication', message: 'Missing "Authentication" section', severity: 'warning' },
      { type: 'section-exists', value: 'Test Data', message: 'Missing "Test Data" section', severity: 'warning' },
      { type: 'section-exists', value: 'Acceptance Criteria', message: 'Missing "Acceptance Criteria" section', severity: 'warning' },
      { type: 'pattern-match', value: 'TC-\\d{3}', message: 'No test case IDs found (TC-001 pattern)' },
      { type: 'pattern-match', value: 'e2e/.*\\.spec\\.ts', message: 'No E2E test file paths found', severity: 'warning' },
    ],
  },
];

export class GuardrailsEngine {
  private rules: GuardrailRule[];

  constructor(swarmDir?: string) {
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
  }

  evaluate(cwd: string): GuardrailViolation[] {
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
          };
        }
        return null;
      }

      default:
        return null;
    }
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  getRules(): GuardrailRule[] {
    return this.rules;
  }
}
