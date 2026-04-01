# Swarm

**AI builds your feature while you watch.**

Swarm orchestrates multiple Claude Code agents through a 5-stage pipeline — analyze, architect, plan, build, test — to turn a feature request into working, tested code.

```
"Add JWT login with refresh tokens"
    ↓
  Analyze → Architect → Plan → Build → Test → Working Code
```

## Quick Start

```bash
# Install
npm install -g swarm-pipeline

# Build a feature (that's it)
swarm "Add a login page with JWT authentication"
```

Swarm auto-detects your tech stack, runs all 5 stages, fixes failing tests, and commits the result.

## What Happens

| Stage | What it does | Output |
|-------|-------------|--------|
| **Analyze** | Gathers requirements, asks clarifying questions | REQUIREMENTS.md |
| **Architect** | Designs system architecture with ADRs | SPEC.md |
| **Plan** | Breaks work into parallelizable tasks | TASKS.md |
| **Build** | Engineers implement code (parallel agents) | Source code |
| **Test** | Generates and runs E2E tests, auto-fixes failures | TESTPLAN.md + passing tests |

Each stage uses a specialized AI persona with strict role boundaries — the analyst can't write code, the engineer can't redesign the architecture.

## Dashboard

```bash
swarm dashboard
```

Opens a web UI where you can:
- **Launch builds** from a simple "What do you want to build?" input
- **Watch progress** through each pipeline stage in real-time
- **View results** — file diffs, test outcomes, cost breakdown
- **Browse history** of past runs

## Commands

```bash
# The main command — runs the full pipeline
swarm "your feature request"

# Or run stages individually (interactive mode)
swarm analyze "Add dark mode"     # → REQUIREMENTS.md
swarm architect                    # → SPEC.md
swarm plan                         # → TASKS.md
swarm build --parallel 3           # → Code
swarm test                         # → Tests

# Utilities
swarm status                       # Show pipeline state and costs
swarm dashboard                    # Open web UI
swarm doctor                       # Check your environment
swarm init --stack react           # Manual project setup
```

### Options

```bash
swarm "feature" --model opus       # Use Opus (default: Sonnet)
swarm "feature" --budget 15        # Set budget to $15 (default: $5)
swarm "feature" --budget none      # No budget limit
swarm mayday --from build          # Resume from a specific stage
swarm mayday --approve             # Require approval between stages
swarm mayday --figma <url>         # Include Figma designs
```

## Configuration

`swarm init` creates `.swarm/config.yaml`:

```yaml
projectName: my-project
stack: react              # react | node | go | python | rust | swift
model: sonnet             # sonnet | opus | haiku
maxBudgetUsd: 5           # Per-pipeline budget (null = no limit)
```

## Defaults

- **Model**: Sonnet (good balance of speed and quality)
- **Budget**: $5 per pipeline run (override with `--budget`)
- **Stack**: Auto-detected from package.json, go.mod, etc.
- **Parallel agents**: 3 engineers during build stage

## Prerequisites

- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`npm install -g @anthropic-ai/claude-code`)

## Why Swarm vs. Claude Code Directly?

| | Single Claude session | Swarm pipeline |
|---|---|---|
| **Approach** | One agent does everything | 5 specialized agents with role boundaries |
| **Requirements** | Skipped or ad-hoc | Structured REQUIREMENTS.md with acceptance criteria |
| **Architecture** | Implicit | Explicit SPEC.md with ADRs and diagrams |
| **Task planning** | None | Parallelizable task groups with dependencies |
| **Testing** | Often forgotten | Automatic E2E test generation and execution |
| **Fix loop** | Manual | Auto-detects failures, targets fixes, detects regressions |
| **Cost tracking** | Hidden | Real-time per-stage cost breakdown |

## Development

```bash
git clone https://github.com/esanmohammad/swarm
cd swarm
npm install
npm run build
npm run dev              # CLI dev mode
npm run dev:dashboard    # Dashboard dev mode with HMR
```

## License

MIT
