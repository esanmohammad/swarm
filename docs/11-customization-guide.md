# Customization Guide

How to extend Swarm with custom personas, tech stacks, guardrails, and plugins.

---

## Custom Personas

Create custom persona prompts that Swarm uses instead of the bundled ones.

### 1. Create the persona file

```bash
mkdir -p .swarm/personas
```

Create `.swarm/personas/my-engineer.yaml`:

```yaml
name: my-engineer
description: Senior engineer with security focus
persona: engineer
stacks: [react, node]  # Which stacks this persona applies to
prompt: |
  You are a senior software engineer with a strong security focus.

  When implementing features:
  - Always validate and sanitize user input
  - Use parameterized queries for database access
  - Apply the principle of least privilege
  - Add security-relevant comments explaining why

  You have full access to the codebase. Implement the tasks assigned to you
  following the architecture in SPEC.md and task list in TASKS.md.
```

### 2. Swarm auto-discovers it

Custom personas in `.swarm/personas/` take priority over bundled prompts. Swarm searches in this order:

1. `.swarm/personas/*.yaml` (project-level custom)
2. `prompts/` (bundled with Swarm)
3. `~/.claude/prompts/` (global custom)
4. `~/.claude/prompt/` (legacy path)

---

## Adding a Tech Stack

To add support for a new language/framework:

### 1. Create persona prompts

Create 5 prompt files in `.swarm/personas/` (one per stage):

```
.swarm/personas/
  analyst-java.yaml
  architect-java.yaml
  lead-java.yaml
  engineer-java.yaml
  tester-java.yaml
```

Each file follows the same YAML format shown above, with `stacks: [java]`.

### 2. Set the stack in config

```yaml
# .swarm/config.yaml
stack: custom
```

Or use `--stack custom` on the command line. Swarm will match your custom personas by name pattern.

---

## Guardrail Rules

Guardrails validate pipeline artifacts (REQUIREMENTS.md, SPEC.md, etc.) after each stage.

### Default guardrails

`swarm init` creates `.swarm/guardrails.yaml` with an example rule. Edit it to add your own:

```yaml
rules:
  # Ensure requirements have acceptance criteria
  - name: Requirements have acceptance criteria
    target: REQUIREMENTS.md
    checks:
      - type: section-exists
        value: Acceptance Criteria
        message: Missing acceptance criteria section
        severity: error

  # Ensure spec includes API design
  - name: API design documented
    target: SPEC.md
    checks:
      - type: section-exists
        value: API Design
        message: SPEC.md should document API endpoints
        severity: warning

  # Ensure tasks have IDs
  - name: Tasks have IDs
    target: TASKS.md
    checks:
      - type: pattern-match
        value: "[A-Z]{3}-\\d{3}"
        message: Tasks should have IDs like FND-001
        severity: error

  # Run a custom validation command
  - name: TypeScript compiles
    target: "*.ts"
    checks:
      - type: command
        value: npx tsc --noEmit
        message: TypeScript compilation failed
        severity: error

  # Minimum length check
  - name: Requirements are thorough
    target: REQUIREMENTS.md
    checks:
      - type: min-length
        value: 500
        message: Requirements seem too brief
        severity: warning
```

### Check types

| Type | What it does | Value |
|------|-------------|-------|
| `section-exists` | Checks for a markdown heading | Heading text (e.g., "Summary") |
| `pattern-match` | Regex match in file content | Regular expression |
| `command` | Runs a shell command, fails on non-zero exit | Shell command string |
| `min-length` | Minimum character count | Number |
| `word-count` | Minimum word count | Number |
| `required-patterns` | Multiple patterns that must all match | Array of regex strings |

### Severity levels

- `error` — Blocks the pipeline. Stage must be re-run.
- `warning` — Shown in dashboard but doesn't block.

---

## Plugins

Plugins can add custom pipeline stages and personas.

### 1. Create a plugin

```bash
swarm plugin init
# Creates .swarm/plugins/my-plugin.js
```

### 2. Plugin structure

```javascript
export default {
  name: 'my-plugin',
  version: '0.1.0',
  description: 'Security review stage',

  stages: [
    {
      name: 'security-review',
      after: 'architect',       // Run after architect stage
      persona: 'architect',     // Use architect persona
      artifact: 'SECURITY.md',  // Output file
      prompt: 'Review the architecture in SPEC.md for security vulnerabilities...',
    },
  ],

  personas: [
    {
      name: 'devops',
      stacks: ['node', 'react'],
      description: 'Infrastructure specialist',
      prompt: 'You are a DevOps engineer...',
    },
  ],
};
```

### 3. Register the plugin

```yaml
# .swarm/config.yaml
plugins:
  - './.swarm/plugins/my-plugin.js'
```

### 4. Verify

```bash
swarm plugin list
```

---

## Webhooks

Get notified when pipeline events happen.

```yaml
# .swarm/config.yaml
webhooks:
  # Slack notification
  - url: https://hooks.slack.com/services/T.../B.../xxx
    events: [stage-complete, pipeline-done, agent-error]
    format: slack

  # Discord notification
  - url: https://discord.com/api/webhooks/xxx/yyy
    events: [pipeline-done]
    format: discord

  # Generic HTTP POST (with HMAC signing)
  - url: https://your-server.com/webhook
    events: [stage-complete, pipeline-done, agent-error]
    format: generic
    secret: your-hmac-secret
```

### Available events

| Event | When it fires |
|-------|--------------|
| `agent-spawned` | New agent process started |
| `agent-done` | Agent completed successfully |
| `agent-error` | Agent failed or timed out |
| `stage-complete` | Pipeline stage finished |
| `pipeline-done` | Entire pipeline completed |

---

## Playwright E2E Testing

Configure how the test stage runs E2E tests.

```yaml
# .swarm/playwright.config.yaml
baseUrl: http://localhost:3000
testDir: e2e
authStorageState: .auth/storageState.json
globalSetupScript: e2e/global-setup.ts
```

The test persona generates Playwright tests based on TESTPLAN.md and runs them automatically. Failed tests trigger the fix loop (up to 5 iterations by default).
