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

## What Does It Cost?

Swarm uses Claude API credits through the Claude Code CLI. Here's what to expect:

| Run Type | Typical Cost | Notes |
|----------|-------------|-------|
| Single stage (analyze/architect/plan) | $0.50 – $2.00 | Quick, focused work |
| Full pipeline (all 5 stages) | $3.00 – $8.00 | Depends on feature complexity |
| Full pipeline + fix iterations | $5.00 – $15.00 | Auto-fixing test failures adds cost |

**Cost controls:**
- Default budget: **$5 per pipeline** (override with `--budget`)
- Use cheaper models for early stages: `haiku` for analyst, `sonnet` for architect, `opus` for engineer
- Run `swarm status` anytime to see current spend
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
- **Watch progress** through each pipeline stage in real-time
- **View results** — file diffs, test outcomes, cost breakdown
- **Browse history** of past runs
- **Spawn individual agents** with custom personas

<!-- TODO: Add dashboard screenshot -->
<!-- ![Dashboard](assets/dashboard.png) -->

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

The dashboard includes a **pipeline selector** dropdown (top-left header) to switch between pipelines and a **Compare** button for side-by-side stage comparison.

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
| Agent seems stuck | Agents have a 30-minute inactivity timeout. Run `swarm agent kill <name>` to force stop |

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
