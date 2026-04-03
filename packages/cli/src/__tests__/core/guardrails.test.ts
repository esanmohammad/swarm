import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { GuardrailsEngine } from '../../core/guardrails.js';
import { createTempSwarmDir, writeArtifact } from '../helpers/temp-dir.js';

describe('GuardrailsEngine', () => {
  let dir: string;
  let swarmDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempSwarmDir();
    dir = tmp.dir;
    swarmDir = tmp.swarmDir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('should detect missing artifact file', () => {
    const engine = new GuardrailsEngine();
    const violations = engine.evaluate(dir);
    // REQUIREMENTS.md doesn't exist, so should get file-exists violations
    const fileViolations = violations.filter(v => v.check === 'file-exists');
    expect(fileViolations.length).toBeGreaterThan(0);
    expect(fileViolations[0].severity).toBe('error');
  });

  it('should pass when all sections exist', () => {
    const content = [
      '# REQUIREMENTS',
      '## Original Requirement',
      'The user wants a login feature.',
      '## Summary',
      'A login feature for the app.',
      '## Scope',
      'Login page with email/password.',
      '## Functional Requirements',
      'As a user I want to login So that I can access the app.',
      'Given a valid email When I submit Then I should be logged in.',
      '## Data Requirements',
      'User table with email and password.',
      '## Non-Functional Requirements',
      'Response time < 200ms.',
      '## Integration',
      'OAuth2 integration.',
      '## Testing',
      'E2E tests for login flow.',
      '## Open Questions',
      'None at this time.',
    ].join('\n');
    writeArtifact(dir, 'REQUIREMENTS.md', content);

    const engine = new GuardrailsEngine();
    const violations = engine.evaluateArtifact(dir, 'REQUIREMENTS.md');
    const errors = violations.filter(v => v.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('should fail on missing required section (severity: error)', () => {
    // REQUIREMENTS.md without the "Summary" section
    const content = [
      '## Original Requirement',
      'The user wants a feature.',
      '## Scope',
      'Some scope.',
    ].join('\n');
    writeArtifact(dir, 'REQUIREMENTS.md', content);

    const engine = new GuardrailsEngine();
    const violations = engine.evaluateArtifact(dir, 'REQUIREMENTS.md');
    const summaryViolation = violations.find(v => v.message.includes('Summary'));
    expect(summaryViolation).toBeDefined();
    expect(summaryViolation!.severity).toBe('error');
  });

  it('should warn on missing optional section (severity: warning)', () => {
    // REQUIREMENTS.md with all required sections but missing "Integration" (which is a warning)
    const content = [
      '## Original Requirement',
      'Test requirement.',
      '## Summary',
      'Test summary.',
      '## Scope',
      'Test scope.',
      '## Functional Requirements',
      'Test requirements.',
      '## Data Requirements',
      'Test data.',
      '## Non-Functional Requirements',
      'Test NFR.',
    ].join('\n');
    writeArtifact(dir, 'REQUIREMENTS.md', content);

    const engine = new GuardrailsEngine();
    const violations = engine.evaluateArtifact(dir, 'REQUIREMENTS.md');
    const integrationWarn = violations.find(v => v.message.includes('Integration'));
    expect(integrationWarn).toBeDefined();
    expect(integrationWarn!.severity).toBe('warning');
  });

  it('should match regex pattern in content', () => {
    const content = [
      '## Original Requirement',
      'X',
      '## Summary',
      'X',
      '## Scope',
      'X',
      '## Functional Requirements',
      'As a user I want something So that it works.',
      'Given a valid input When I submit Then it passes.',
      '## Data Requirements',
      'X',
      '## Non-Functional Requirements',
      'X',
      '## Integration',
      'X',
      '## Testing',
      'E2E test coverage.',
      '## Open Questions',
      'None.',
    ].join('\n');
    writeArtifact(dir, 'REQUIREMENTS.md', content);

    const engine = new GuardrailsEngine();
    const violations = engine.evaluateArtifact(dir, 'REQUIREMENTS.md');
    // The "As a ... I want ... So that" pattern should match
    const userStoryViolation = violations.find(v => v.message.includes('user stories'));
    expect(userStoryViolation).toBeUndefined();
  });

  it('should fail on missing regex pattern', () => {
    // REQUIREMENTS.md with all sections but no user stories
    const content = [
      '## Original Requirement',
      'Test.',
      '## Summary',
      'Test.',
      '## Scope',
      'Test.',
      '## Functional Requirements',
      'The system should do something.',
      '## Data Requirements',
      'Test.',
      '## Non-Functional Requirements',
      'Test.',
    ].join('\n');
    writeArtifact(dir, 'REQUIREMENTS.md', content);

    const engine = new GuardrailsEngine();
    const violations = engine.evaluateArtifact(dir, 'REQUIREMENTS.md');
    const patternViolation = violations.find(v => v.message.includes('user stories'));
    expect(patternViolation).toBeDefined();
  });

  it('should check min-length threshold', () => {
    // Very short REQUIREMENTS.md (below 200 chars)
    writeArtifact(dir, 'REQUIREMENTS.md', '## Summary\nShort.');

    const engine = new GuardrailsEngine();
    const violations = engine.evaluateArtifact(dir, 'REQUIREMENTS.md');
    const lenViolation = violations.find(v => v.check.startsWith('min-length'));
    expect(lenViolation).toBeDefined();
    expect(lenViolation!.severity).toBe('warning');
  });

  it('should check word-count per section', () => {
    // Functional Requirements with very few words
    const content = [
      '## Original Requirement',
      'Placeholder.',
      '## Summary',
      'Placeholder.',
      '## Scope',
      'Placeholder.',
      '## Functional Requirements',
      'Short.',
      '## Data Requirements',
      'Placeholder.',
      '## Non-Functional Requirements',
      'Placeholder.',
    ].join('\n');
    writeArtifact(dir, 'REQUIREMENTS.md', content);

    const engine = new GuardrailsEngine();
    const violations = engine.evaluateArtifact(dir, 'REQUIREMENTS.md');
    const wordViolation = violations.find(v => v.check.startsWith('word-count'));
    expect(wordViolation).toBeDefined();
    expect(wordViolation!.severity).toBe('warning');
  });

  it('should check required-patterns (all must match)', () => {
    const engine = new GuardrailsEngine();
    // Build a custom rule with required-patterns
    const customSwarmDir = join(dir, '.swarm-custom');
    mkdirSync(customSwarmDir, { recursive: true });
    writeFileSync(join(customSwarmDir, 'guardrails.yaml'), `
rules:
  - name: "custom check"
    target: "TEST.md"
    checks:
      - type: required-patterns
        value: "Hello,World,Goodbye"
        message: "Missing required patterns"
        severity: error
`);

    const customEngine = new GuardrailsEngine(customSwarmDir);
    // TEST.md with only some patterns
    writeArtifact(dir, 'TEST.md', 'Hello World');
    const violations = customEngine.evaluateArtifact(dir, 'TEST.md');
    const rpViolation = violations.find(v => v.check.startsWith('required-patterns'));
    expect(rpViolation).toBeDefined();
    expect(rpViolation!.message).toContain('Missing required patterns');
  });

  it('should load custom rules from guardrails.yaml', () => {
    writeFileSync(join(swarmDir, 'guardrails.yaml'), `
rules:
  - name: "custom rule"
    target: "CUSTOM.md"
    checks:
      - type: section-exists
        value: "Custom Section"
        message: "Missing custom section"
`);

    const engine = new GuardrailsEngine(swarmDir);
    const rules = engine.getRules();
    const customRule = rules.find(r => r.name === 'custom rule');
    expect(customRule).toBeDefined();
    expect(customRule!.target).toBe('CUSTOM.md');
  });

  it('should evaluateArtifact only for the specified artifact', () => {
    writeArtifact(dir, 'REQUIREMENTS.md', '## Summary\nShort file.');
    writeArtifact(dir, 'SPEC.md', '## Overview\nShort spec.');

    const engine = new GuardrailsEngine();
    // Only evaluate SPEC.md — should not include REQUIREMENTS.md violations
    const violations = engine.evaluateArtifact(dir, 'SPEC.md');
    const reqViolations = violations.filter(v => v.file.includes('REQUIREMENTS'));
    expect(reqViolations).toHaveLength(0);
    // Should have SPEC.md violations
    const specViolations = violations.filter(v => v.file.includes('SPEC'));
    expect(specViolations.length).toBeGreaterThan(0);
  });

  it('should handle command check type', () => {
    const customDir = join(dir, '.swarm-cmd');
    mkdirSync(customDir, { recursive: true });
    writeFileSync(join(customDir, 'guardrails.yaml'), `
rules:
  - name: "command check"
    target: "TEST.md"
    checks:
      - type: command
        value: "exit 1"
        message: "Command failed"
        severity: error
`);

    writeArtifact(dir, 'TEST.md', 'Some content');
    const engine = new GuardrailsEngine(customDir);
    const violations = engine.evaluateArtifact(dir, 'TEST.md');
    const cmdViolation = violations.find(v => v.check.startsWith('command'));
    expect(cmdViolation).toBeDefined();
    expect(cmdViolation!.severity).toBe('error');
  });
});
