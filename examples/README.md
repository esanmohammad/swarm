# Examples

Sample configurations and feature requests to get started with Swarm.

## Quick Examples

### Basic — Build a feature with defaults

```bash
swarm "Add a contact form with email validation"
```

Uses auto-detected stack, Sonnet model, $5 budget. That's it.

### Budget-conscious — Use cheap models for early stages

```bash
swarm init --model haiku --budget 3
swarm "Add a dark mode toggle"
```

Or configure per-stage models:

```bash
cp examples/config-budget.yaml .swarm/config.yaml
swarm "Add user profile page"
```

### Quality-focused — Use Opus with high budget

```bash
swarm "Implement OAuth2 with Google and GitHub providers" --model opus --budget 20
```

### Stage-by-stage — Review each artifact before proceeding

```bash
swarm analyze "Add real-time notifications"
# Read REQUIREMENTS.md, make sure it's right
swarm architect
# Read SPEC.md, verify the design
swarm plan
# Read TASKS.md, check task breakdown
swarm build --parallel 3
swarm test
```

### With Figma designs

```bash
swarm "Build the settings page" --figma "https://figma.com/design/abc123/Settings"
```

## Sample Configurations

### `config-budget.yaml` — Minimize cost

```yaml
projectName: my-project
stack: react
model: haiku
models:
  analyst: haiku
  architect: haiku
  lead: haiku
  engineer: sonnet
  tester: haiku
maxBudgetUsd: 3
```

### `config-quality.yaml` — Maximize quality

```yaml
projectName: my-project
stack: react
model: opus
models:
  analyst: sonnet
  architect: opus
  lead: opus
  engineer: opus
  tester: sonnet
maxBudgetUsd: 25
```

### `config-with-webhooks.yaml` — Slack notifications

```yaml
projectName: my-project
stack: node
model: sonnet
maxBudgetUsd: 10
webhooks:
  - url: https://hooks.slack.com/services/YOUR/WEBHOOK/URL
    events: [stage-complete, pipeline-done, agent-error]
    format: slack
```

## Sample Feature Requests

Good feature requests are specific and describe the desired behavior:

```bash
# Good — specific, clear scope
swarm "Add a search bar to the header that filters products by name and category"

# Good — includes acceptance criteria
swarm "Add JWT authentication with login/signup pages, refresh token rotation, and a protected /dashboard route"

# Good — references existing code
swarm "Refactor the UserService to use the repository pattern, moving all SQL queries out of the service layer"

# Bad — too vague
swarm "make it better"

# Bad — too broad
swarm "build an entire e-commerce platform"
```

## Sample Guardrails

See `guardrails-strict.yaml` for a comprehensive guardrail configuration:

```yaml
rules:
  - name: Requirements completeness
    target: REQUIREMENTS.md
    checks:
      - type: section-exists
        value: Summary
        severity: error
      - type: section-exists
        value: Acceptance Criteria
        severity: error
      - type: min-length
        value: 500
        severity: warning
        message: Requirements seem too brief

  - name: Architecture decisions documented
    target: SPEC.md
    checks:
      - type: section-exists
        value: Architecture Decision Records
        severity: warning
      - type: pattern-match
        value: "## ADR-\\d+"
        severity: warning
        message: Spec should include numbered ADRs

  - name: Tasks have proper IDs
    target: TASKS.md
    checks:
      - type: pattern-match
        value: "[A-Z]{3}-\\d{3}"
        severity: error
        message: Tasks must have IDs like FND-001
```
