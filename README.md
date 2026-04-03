# Swarm

**One command. 5 AI agents. Complete features.**

Swarm orchestrates multiple Claude Code agents through a production-grade pipeline to turn feature requests into tested, committed code. Each agent has a specialized role with strict boundaries — just like a real engineering team.

```
"Add JWT login with refresh tokens"
    |
    v
  Analyst    --> REQUIREMENTS.md    (gathers requirements, asks questions)
  Architect  --> SPEC.md            (designs system, writes ADRs)
  Lead       --> TASKS.md           (breaks work into parallel tasks)
  Engineer   --> Source code         (implements features)
  Tester     --> TESTPLAN.md        (writes + runs tests, auto-fixes failures)
    |
    v
  Working code, tests passing, PR ready
```

## Quick Start

```bash
# 1. Prerequisites
npm install -g @anthropic-ai/claude-code

# 2. Install Swarm
npm install -g swarm-pipeline

# 3. Verify setup
swarm doctor

# 4. Build a feature
swarm "Add a login page with JWT authentication"
```

Swarm auto-detects your tech stack, runs all 5 stages, fixes failing tests, and commits the result.

## Features (v0.1)

### Full Pipeline

| Command | What it does |
|---------|-------------|
| `swarm "feature request"` | Full 5-stage pipeline end-to-end |
| `swarm analyze` | Run analyst — gather requirements |
| `swarm architect` | Run architect — design system |
| `swarm plan` | Run lead — break into tasks |
| `swarm build` | Run engineer(s) — implement code |
| `swarm test` | Run tester — generate + run tests |

### Quick Workflows

| Command | What it does | Typical cost |
|---------|-------------|-------------|
| `swarm fix "bug description"` | Fix a bug, run tests | $1-3 |
| `swarm fix --issue 123` | Fetch GitHub issue, fix it | $1-3 |
| `swarm review` | Review staged/unstaged changes | $0.50-1 |
| `swarm review 456` | Review a GitHub PR | $0.50-1 |
| `swarm pr --reviewers --risk` | Smart PR with risk scores + reviewers | $0.10-0.30 |
| `swarm refactor "extract auth"` | Analyze scope, refactor, verify | $2-5 |
| `swarm spike "how does auth work?"` | Read-only codebase exploration | $0.10-0.30 |
| `swarm test-gen` | Generate tests for untested code | $1-5 |
| `swarm learn` | Extract project conventions | free |

### DevOps

| Command | What it does |
|---------|-------------|
| `swarm init` | Initialize `.swarm/` with auto-detected stack |
| `swarm doctor` | Verify environment (Node, Claude CLI, API key) |
| `swarm check` | Validate artifacts against guardrail rules |
| `swarm status` | Show pipeline state and agent status |
| `swarm stats` | Cost analytics and performance trends |
| `swarm memory` | Manage cross-run learning (what worked, what failed) |
| `swarm dashboard` | Real-time web UI for monitoring agents |

## How It Works

### Role Boundaries

Each persona has strict tool restrictions. This prevents AI hallucinations from propagating across stages:

| Persona | Can Do | Cannot Do |
|---------|--------|-----------|
| Analyst | Read code, ask questions | Write code, design architecture |
| Architect | Design systems, write ADRs | Write code, assign tasks |
| Lead | Break work into tasks | Write code, redesign architecture |
| Engineer | Full implementation access | Redesign architecture |
| Tester | Write tests, run test suite | Modify source code |

### Artifacts

Every stage produces a validated, reviewable document:

- **REQUIREMENTS.md** — User stories, acceptance criteria, scope
- **SPEC.md** — Architecture diagrams (Mermaid), ADRs, API specs
- **TASKS.md** — Parallelizable tasks with IDs, dependencies, file paths
- **TESTPLAN.md** — Test cases with IDs, assertions, target files

### Guardrails

Artifacts are validated before the pipeline advances. If validation fails, the stage retries automatically.

```bash
swarm check

  REQUIREMENTS.md
    ✓  section-exists    Original Requirement
    ✓  section-exists    Functional Requirements
    ✗  pattern-match     No user stories found
       Fix: Add "As a [user] I want [feature] So that [benefit]"

  SPEC.md
    ✓  section-exists    Architecture
    ✗  pattern-match     No Mermaid diagrams found
       Fix: Add a ```mermaid block in Architecture section

  2 artifacts · 12 passed · 2 errors
  Run swarm check --fix to auto-fix
```

Configure strictness in `.swarm/guardrails.yaml`:

```yaml
preset: standard   # strict | standard | lenient | off
rules:
  REQUIREMENTS.md:
    user-stories: warning
  SPEC.md:
    mermaid-diagrams: off
```

### Intelligent Fix Loop

When tests fail, Swarm doesn't just retry — it targets specific failures:

1. Parse test output to identify individual failures
2. Feed each failure to the engineer with context
3. Detect regressions (new failures introduced by fixes)
4. Track fix history to avoid repeated attempts
5. Respect budget limits and max iterations

### Dashboard

```bash
swarm dashboard
# Opens http://localhost:3000
```

Real-time monitoring of all agents:
- Live output streaming
- Cost and token tracking per persona
- Stage progression with status indicators
- Spawn/kill agents on demand
- Dark mode

## Configuration

```bash
swarm init
```

Creates `.swarm/config.yaml`:

```yaml
stack: react              # auto-detected: react | node | python | go | rust
model: opus               # opus | sonnet | haiku
budget: 20                # max dollars per run (null = unlimited)
testFramework: vitest     # vitest | jest | playwright | pytest
```

### Custom Personas

Create `.swarm/personas/my-analyst.yaml`:

```yaml
name: Security Analyst
role: analyst
stack: react
model: sonnet
systemPrompt: |
  You are a senior security analyst at a fintech company.
  Focus on: authentication, authorization, data encryption, compliance.
```

## Cost & Performance

| Feature size | Time | Cost |
|-------------|------|------|
| Small (1-2 files) | 3-5 min | $2-5 |
| Medium (3-8 files) | 5-10 min | $5-15 |
| Complex (9+ files) | 10-20 min | $15-40 |

```bash
swarm stats                          # View cost history
swarm "feature" --budget 10          # Fail if over $10
swarm "feature" --lean               # Use haiku for docs, opus for code
```

## Architecture

```
CLI Command
  → Pipeline (sequences 5 stages with role boundaries)
    → AgentManager (spawns/tracks multiple agents)
      → AgentProcess (wraps claude CLI subprocess, parses stream-json)

StateManager ──events──> WebSocket Server ──> Dashboard (React)
```

Key design decisions:
- **Subprocess isolation** — each agent is a separate `claude` CLI process
- **Stream-json parsing** — real-time output from NDJSON streams
- **State persistence** — `.swarm/state.json` with backup/recovery
- **Ring-buffer output** — 50KB cap per agent prevents memory issues
- **Inactivity watchdog** — kills stuck agents after configurable timeout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for deep dives.

## Coming Soon (v0.2+)

Swarm v0.1 ships 19 commands. 60+ more are in development:

- **Autopilot** — Watch GitHub issues, auto-create PRs
- **Incident Response** — Diagnose + fix production bugs
- **Health Monitoring** — Track codebase quality over time
- **Risk Scoring** — Identify high-risk changes before merge
- **Multi-Repo** — Coordinate features across repositories
- **Security Scanner** — OWASP static analysis + AI semantic review
- **Supply Chain** — Verify dependencies before install
- **Team Coordination** — Multi-developer awareness + conflict prevention
- **Architecture Review** — Detect circular deps, god modules, coupling hotspots
- **Roadmap Planning** — Multi-phase project plans with critical path analysis

Run `swarm --help --all` to see the full command list.

## Troubleshooting

```bash
# Environment issues
swarm doctor

# Agent stuck as "running"
swarm status --clear

# Tests keep failing
swarm test --verbose
swarm test --fix

# Dashboard won't connect
swarm dashboard --port 3001 --verbose

# Cost concerns
swarm stats
swarm "feature" --budget 5 --dry-run
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

```bash
git clone https://github.com/anthropics/swarm.git
cd swarm
npm install
npm run build
npm test
```

## FAQ

**Does Swarm replace engineers?**
No. Think of it like having junior engineers for initial implementation. You review, approve architecture, and make decisions.

**How much does it cost?**
Swarm is free and open-source. You pay for Claude API usage. Typical feature: $2-15.

**What tech stacks are supported?**
React, Node, Python, Go, Rust, Swift, and custom. Auto-detected from your project.

**Can I use a different LLM?**
Currently Claude Code only. Multi-LLM support is coming in v0.2.

**Is it production-ready?**
v0.1 is solid for well-scoped features in mature codebases. Always review AI-generated code before merging.

## License

See [LICENSE](LICENSE) for details.

## Acknowledgments

- Built on [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) by Anthropic
- Inspired by [Aider](https://aider.chat), [MetaGPT](https://github.com/geekan/MetaGPT), and [CrewAI](https://github.com/joaomdmoura/crewAI)
