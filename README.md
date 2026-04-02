# Swarm

**AI builds your feature while you watch.**

Swarm orchestrates multiple Claude Code agents through a 5-stage pipeline — analyze, architect, plan, build, test — to turn a feature request into working, tested code.

```
"Add JWT login with refresh tokens"
    ↓
  Analyze → Architect → Plan → Build → Test → Working Code
```

<!-- TODO: Add demo GIF here once recorded -->
<!-- ![Swarm Demo](assets/demo.gif) -->

## Quick Start

```bash
# 1. Install Claude Code CLI (if you don't have it)
npm install -g @anthropic-ai/claude-code

# 2. Install Swarm
npm install -g swarm-pipeline

# 3. Build a feature (that's it)
swarm "Add a login page with JWT authentication"
```

Swarm auto-detects your tech stack, runs all 5 stages, fixes failing tests, and commits the result.

> **First time?** Run `swarm doctor` to verify your environment is set up correctly.

## What Happens

| Stage | What it does | Output |
|-------|-------------|--------|
| **Analyze** | Gathers requirements, asks clarifying questions | REQUIREMENTS.md |
| **Architect** | Designs system architecture with ADRs | SPEC.md |
| **Plan** | Breaks work into parallelizable tasks | TASKS.md |
| **Build** | Engineers implement code (parallel agents) | Source code |
| **Test** | Generates and runs E2E tests, auto-fixes failures | TESTPLAN.md + passing tests |

Each stage uses a specialized AI persona with strict role boundaries — the analyst can't write code, the engineer can't redesign the architecture.

## Quick Workflows

Not everything needs the full 5-stage pipeline. These commands skip straight to what matters:

| Command | What it does | Default model | Typical cost |
|---------|-------------|---------------|-------------|
| `swarm fix "bug"` | Engineer fixes the bug, runs tests | config default | $1–3 |
| `swarm fix --issue 123` | Fetches GitHub issue, fixes it | config default | $1–3 |
| `swarm review` | Reviews current git changes | sonnet | $0.50–1 |
| `swarm review 456` | Reviews a GitHub PR | sonnet | $0.50–1 |
| `swarm simplify` | Scans changes for dead code, duplication, over-engineering | haiku | $0.20–0.50 |
| `swarm spike "question"` | Read-only codebase exploration | haiku | $0.10–0.30 |
| `swarm refactor "goal"` | Analyze scope → apply changes → verify tests | config default | $2–5 |
| `swarm ci "feature"` | Headless CI pipeline with JSON output + exit codes | config default | $3–10 |

All quick workflows are also available from the **dashboard** Launch view as one-click buttons.

## Smart Features

### Codebase Awareness
Swarm scans your project before each pipeline run — package.json, file tree, existing tests, git history — and injects this context into every stage. Stages know they're extending an existing codebase, not building from scratch.

### Strategy Escalation
When the fix loop gets stuck on the same failures, it automatically escalates through 4 strategies before giving up:
1. **Standard** — fix the failing code
2. **Broader context** — read more of the codebase, trace data flow
3. **Rewrite** — delete and rewrite the affected components from scratch
4. **Simplify** — reduce scope, stub features, get tests passing minimally

### Budget Degradation
Instead of killing all agents when budget runs low, Swarm automatically downgrades models:
- At **80% budget**: opus → sonnet
- At **90% budget**: all agents → haiku

### Blocking Guardrails
Artifact validation (REQUIREMENTS.md sections, SPEC.md structure, TASKS.md format) now **blocks** pipeline progression on errors. Bad artifacts trigger automatic retry instead of flowing downstream.

### Failure Reports
When a pipeline fails, Swarm saves `FAILURE-REPORT.md` with: stage-by-stage results, artifacts produced, fix loop history, last test output, and context-aware next steps.

### Parallel Test Execution
For stacks with multiple test frameworks (e.g., React: Vitest + Playwright), Swarm runs them in parallel with separate agents.

### Monorepo Support
Set `packages: ["packages/api", "packages/web"]` in config to scope all agent work to specific packages.

### LLM Quality Gate
Enable `llmQualityGate: true` in config to run haiku-based semantic quality evaluation after each stage (~$0.01/artifact). Blocks if blended score falls below threshold.

## What Does It Cost?

Swarm uses Claude API credits through the Claude Code CLI. Here's what to expect:

| Run Type | Typical Cost | Notes |
|----------|-------------|-------|
| Single stage (analyze/architect/plan) | $0.50 – $2.00 | Quick, focused work |
| Full pipeline (all 5 stages) | $3.00 – $8.00 | Depends on feature complexity |
| Full pipeline + fix iterations | $5.00 – $15.00 | Auto-fixing test failures adds cost |

**Cost controls:**
- Default budget: **$5 per pipeline** (override with `--budget`)
- **Lean mode** (`--lean`): haiku for docs stages, default model for engineer — saves ~70%
- **Smart mode** (`--smart`): sonnet for docs, opus for engineer — best quality/cost balance
- Per-stage cost tracking in dashboard and CLI output
- Budget degradation: auto-downgrades models at 80%/90% instead of killing agents
- If you hit the budget cap, the pipeline stops — no surprise charges

```yaml
# .swarm/config.yaml — per-stage model overrides to save money
models:
  analyst: haiku        # ~$0.25 per run
  architect: sonnet     # ~$0.75 per run
  engineer: opus        # ~$2.00 per run (where quality matters most)
```

## Dashboard

```bash
swarm dashboard
```

Opens a web UI where you can:
- **Launch builds** from a simple "What do you want to build?" input
- **Quick actions** — Fix, Spike, Review, Refactor, Simplify buttons for fast workflows
- **Watch progress** through each pipeline stage in real-time with per-stage cost display
- **Lean mode toggle** — save ~70% on pipeline costs with one click
- **View results** — file diffs, test outcomes, cost breakdown
- **Browse history** of past runs
- **Spawn individual agents** with custom personas
- **Fix GitHub issues** — type `#123` in the Fix action to auto-fetch issue context

<!-- TODO: Add dashboard screenshot -->
<!-- ![Dashboard](assets/dashboard.png) -->

## Commands

```bash
# The main command — runs the full pipeline
swarm "your feature request"

# Quick workflows (no pipeline overhead)
swarm fix "login button not working"    # Direct bug fix → engineer → tests
swarm fix --issue 123                   # Fix a GitHub issue (fetches via gh CLI)
swarm review                            # Code review current git changes
swarm review 456                        # Review a GitHub PR
swarm simplify                          # Clean up changed code (dead code, duplication)
swarm spike "how does auth work here?"  # Quick read-only codebase exploration
swarm refactor "extract auth service"   # Analyze scope → apply changes → run tests

# Pipeline stages (interactive mode)
swarm analyze "Add dark mode"     # → REQUIREMENTS.md
swarm architect                    # → SPEC.md
swarm plan                         # → TASKS.md
swarm build --parallel 3           # → Code
swarm test                         # → Tests

# CI mode (headless, JSON output, exit codes)
swarm ci "feature" --json --budget 10 --timeout 30

# Utilities
swarm status                       # Show pipeline state and costs
swarm dashboard                    # Open web UI
swarm doctor                       # Check your environment
swarm init --stack react           # Manual project setup

# Multi-pipeline
swarm pipeline create <name>       # Create isolated pipeline
swarm pipeline list                # List all pipelines
swarm pipeline switch <name>       # Switch active pipeline
swarm pipeline delete <name>       # Delete pipeline and worktree
```

### Options

```bash
swarm "feature" --model opus       # Use Opus (default: Sonnet)
swarm "feature" --budget 15        # Set budget to $15 (default: $5)
swarm "feature" --budget none      # No budget limit
swarm mayday --lean                # Lean mode: haiku for docs, default for engineer (~70% cheaper)
swarm mayday --smart               # Smart mode: sonnet for docs, opus for engineer
swarm mayday --from build          # Resume from a specific stage
swarm mayday --approve             # Require approval between stages
swarm mayday --figma <url>         # Include Figma designs
```

### Multi-Pipeline Management

Run multiple pipelines in parallel, each in its own git worktree for full isolation:

```bash
swarm pipeline create auth-feature  # Create pipeline with isolated worktree
swarm pipeline create api-refactor  # Create another
swarm pipeline list                 # Show all pipelines with status and cost
swarm pipeline switch auth-feature  # Switch active pipeline
swarm pipeline delete api-refactor  # Clean up worktree and state
```

Each non-default pipeline gets its own git branch (`pipeline/{name}`) and worktree, so agents in different pipelines never conflict on files. When creating a pipeline, existing artifacts (REQUIREMENTS.md, SPEC.md, etc.) are copied to the new worktree.

Pipelines can also be managed directly from the **dashboard**:
- **Pipeline selector** dropdown (top-left header) to switch between pipelines
- **"New pipeline"** button at the bottom of the dropdown to create pipelines from the UI
- **Delete** button (trash icon) on each non-default pipeline in the dropdown
- **Compare** button in the header for side-by-side stage comparison across pipelines

### Pipeline Resume

Pipelines persist across restarts. If a pipeline is interrupted (crash, Ctrl+C, budget kill):

- Completed stages are **preserved** — they won't re-run
- Interrupted stages keep their Claude session ID for **automatic resume**
- `swarm mayday --resume` picks up from exactly where it left off
- Sessions older than 24 hours fall through to a fresh start with context summaries from prior stages

The dashboard shows a **Resume** button on errored stages that have a saved session.

### Advanced Commands

These are available but hidden from `--help` by default. Run `swarm --help --all` to see them.

```bash
swarm agent spawn <name>           # Spawn a standalone agent
swarm agent list                   # List all agents
swarm agent kill <name>            # Stop an agent
swarm evaluate                     # Run guardrail checks on artifacts
swarm audit                        # View structured event log
swarm recover                      # Restore from state backup
swarm plugin list                  # Show installed plugins
swarm telemetry [on|off|reset]     # Manage local usage stats
```

## Configuration

`swarm init` creates `.swarm/config.yaml`:

```yaml
projectName: my-project
stack: react              # react | node | go | python | rust | swift
model: sonnet             # sonnet | opus | haiku
maxBudgetUsd: 5           # Per-pipeline budget (null = no limit)
```

<details>
<summary>Full configuration reference</summary>

```yaml
projectName: my-project
stack: react
model: sonnet

# Per-stage model overrides (save money on early stages)
models:
  analyst: haiku
  architect: sonnet
  lead: sonnet
  engineer: opus
  tester: sonnet

maxBudgetUsd: 5
promptsDir: bundled        # 'bundled' or path to custom prompts

# Networking (auto-derived from project name to avoid collisions)
wsPort: 3847
dashboardPort: 3848

# Permission modes for Claude CLI
permissions:
  permissionMode: default  # default | acceptEdits | bypassPermissions | plan | auto

# E2E testing
playwright:
  baseUrl: http://localhost:3000
  testDir: e2e

# Webhooks (Slack, Discord, or generic HTTP)
webhooks:
  - url: https://hooks.slack.com/services/...
    events: [stage-complete, pipeline-done]
    format: slack

# Monorepo — scope agent work to specific packages
packages:
  - packages/api
  - packages/web

# LLM quality gate (optional, ~$0.01/artifact)
llmQualityGate: false
llmQualityThreshold: 60

# Custom plugins
plugins:
  - './plugins/custom.js'
```

</details>

## Defaults

- **Model**: Sonnet (good balance of speed and quality)
- **Budget**: $5 per pipeline run (override with `--budget`)
- **Stack**: Auto-detected from package.json, go.mod, etc.
- **Parallel agents**: 3 engineers during build stage

## Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org/)
- **Claude Code CLI** — installed and authenticated

```bash
# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Verify it's working (this will prompt for authentication if needed)
claude --version
```

> **Don't have an Anthropic account?** Sign up at [console.anthropic.com](https://console.anthropic.com). You'll need API credits to use Swarm.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `command not found: swarm` | Run `npm install -g swarm-pipeline` again, or use `npx swarm-pipeline` |
| `command not found: claude` | Run `npm install -g @anthropic-ai/claude-code` |
| `No .swarm/ directory found` | Run `swarm init` in your project, or just run `swarm "feature"` (auto-inits) |
| Pipeline stops mid-run | Check `swarm status` for cost/budget. Increase with `--budget` |
| Dashboard won't open | Port may be in use. Check `swarm doctor` or change `dashboardPort` in `.swarm/config.yaml` |
| `state.json` corrupted | Run `swarm recover` to restore from backup |
| Agent seems stuck | Agents have a 10-minute inactivity timeout (60 min during Bash commands). Run `swarm agent kill <name>` to force stop |

Run `swarm doctor` for a full environment health check — it verifies Node.js, Claude CLI, disk space, and project setup.

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

See [CONTRIBUTING.md](CONTRIBUTING.md) for details. Architecture docs are in [docs/](docs/).

## License

MIT
