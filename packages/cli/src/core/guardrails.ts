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
      { type: 'section-exists', value: 'Functional Requirements', message: 'Missing "Functional Requirements" section' },
      { type: 'section-exists', value: 'Scope', message: 'Missing "Scope" section' },
      { type: 'section-exists', value: 'Non-Functional Requirements', message: 'Missing "Non-Functional Requirements" section', severity: 'warning' },
    ],
  },
  {
    name: 'SPEC.md structure',
    target: 'SPEC.md',
    checks: [
      { type: 'section-exists', value: 'Architecture', message: 'Missing architecture section' },
      { type: 'pattern-match', value: '```mermaid', message: 'No Mermaid diagrams found', severity: 'warning' },
      { type: 'section-exists', value: 'ADR', message: 'Missing Architecture Decision Records', severity: 'warning' },
      { type: 'section-exists', value: 'API', message: 'Missing API contracts section', severity: 'warning' },
    ],
  },
  {
    name: 'TASKS.md structure',
    target: 'TASKS.md',
    checks: [
      { type: 'pattern-match', value: '[A-Z]{2,4}-\\d{3}', message: 'No task IDs found (expected pattern like FND-001)' },
      { type: 'pattern-match', value: '\\[\\s*\\]', message: 'No pending tasks found (checkbox markers)' },
      { type: 'pattern-match', value: 'Acceptance Criteria|AC\\d', message: 'No acceptance criteria found', severity: 'warning' },
      { type: 'pattern-match', value: 'Depends on|depends-on', message: 'No dependency declarations found', severity: 'warning' },
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
        // Skip rules for files that don't exist yet
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
