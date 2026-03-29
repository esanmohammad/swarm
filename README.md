# Swarm

CLI tool + web dashboard for orchestrating Claude Code sub-agents through a structured software development pipeline.

Swarm coordinates four AI personas — Analyst, Architect, Lead, and Engineer — to transform a feature request into working code, with real-time cost tracking, parallel agent execution, and quality guardrails.

## How It Works

```
Feature Request
    │
    ▼
┌─────────┐    ┌───────────┐    ┌────────┐    ┌───────────┐
│ Analyst  │───▶│ Architect │───▶│  Lead  │───▶│ Engineer  │
│(interact)│    │(interact) │    │(interact)│   │ (×N auto) │
└─────────┘    └───────────┘    └────────┘    └───────────┘
REQUIREMENTS.md   SPEC.md        TASKS.md      Working Code
```

Each stage spawns a Claude agent with a specialized system prompt and **strict role boundaries** — analysts only produce requirements, architects only produce specs, leads only produce tasks, and only engineers write code.

Analyst, Architect, and Lead run in **interactive mode** so you can answer clarifying questions. Engineers run headless in parallel.

## Quick Start

```bash
# Install dependencies
npm install

# Build both CLI and dashboard
npm run build

# Set up alias (add to ~/.zshrc or ~/.bashrc)
alias swarm="node /path/to/swarm/packages/cli/dist/bin/swarm.js"

# Initialize a project
swarm init --stack react --name my-feature

# Run the pipeline — each step is interactive
swarm analyze "Add JWT authentication with refresh tokens"
swarm architect
swarm plan

# Engineers run headless in parallel
swarm build --parallel 3

# Validate outputs against guardrails
swarm evaluate

# Open the real-time dashboard
swarm dashboard
```

## Commands

### Pipeline Commands

| Command | Description | Mode | Output |
|---------|-------------|------|--------|
| `swarm init` | Initialize `.swarm/` config directory | - | config.yaml, guardrails.yaml |
| `swarm analyze <request>` | Run Analyst persona | Interactive | REQUIREMENTS.md |
| `swarm architect` | Run Architect persona | Interactive | SPEC.md |
| `swarm plan` | Run Lead persona | Interactive | TASKS.md |
| `swarm build` | Run Engineer persona(s) | Headless | Implementation code |
| `swarm evaluate` | Validate artifacts against guardrails | - | Pass/fail report |

### Agent Management

| Command | Description |
|---------|-------------|
| `swarm agent spawn <name> --persona <type> --stack <stack>` | Spawn a named agent |
| `swarm agent list` | List all agents with status and cost |
| `swarm agent kill <name-or-id>` | Stop a running agent |

### Monitoring

| Command | Description |
|---------|-------------|
| `swarm status` | Print pipeline state, agents, and costs to terminal |
| `swarm dashboard` | Open web dashboard in browser |

### Command Options

```bash
# Init — defaults: opus model, no budget limit
swarm init --stack react|node|go --model opus|sonnet|haiku --budget 0 --name my-project

# All pipeline commands accept --model and --stack overrides
swarm analyze "Add dark mode" --model sonnet --stack node
swarm architect --model haiku
swarm build --parallel 3 --task FND-001

# Read feature request from file
swarm analyze --file feature-request.txt

# Run pipeline steps non-interactively (single-shot, no questions)
swarm analyze "Add auth" --no-interactive
swarm architect --no-interactive
swarm plan --no-interactive
```

## Interactive Mode

By default, `analyze`, `architect`, and `plan` run interactively:

1. **Bootstrap**: Sends your prompt via `claude -p` with the persona's system prompt
2. **Resume**: Opens an interactive Claude session (`claude --resume <session-id>`) so you can answer questions
3. **Output**: The agent produces its artifact (REQUIREMENTS.md, SPEC.md, or TASKS.md) and exits

Each agent has **strict role boundaries** enforced in the prompt:
- Analyst: only asks questions and writes REQUIREMENTS.md — no code, no architecture
- Architect: only designs and writes SPEC.md — no tasks, no code
- Lead: only breaks down tasks and writes TASKS.md — no code, no architecture changes
- Engineer: implements code from TASKS.md — the only persona that writes code

Use `--no-interactive` to skip the conversation and run single-shot.

## Dashboard

The web dashboard provides real-time visibility into your agent swarm.

**Top metrics bar**: stage status indicators, running/done/failed agent counts, total cost, token usage, API duration, produced artifacts, guardrail violation count.

**Sidebar**: cost breakdown by persona, agent cards with status, cost, tokens, duration, model, and permission mode.

**Output area**: live terminal-style viewer for selected agent output with an **input box** to send follow-up messages. When an agent asks a question or you need to provide input, type in the input box and hit Enter — the message resumes the agent's session via `claude --resume`.

**Spawn dialog**: create agents from the browser with persona, stack, model, prompt, and permission mode selection.

**Kill confirmation**: killing an agent shows a confirmation modal before sending SIGTERM.

**Permission modes** (per agent, set at spawn):
| Mode | Description |
|------|-------------|
| Accept Edits | Auto-approve file edits, prompt for bash/shell |
| Auto | Auto-approve all safe actions |
| Plan Only | Read-only — explore but don't modify |
| Bypass All | Skip all permission checks |

Start the dashboard:

```bash
swarm dashboard          # Opens browser at http://localhost:3848
swarm dashboard --no-open  # Start server without opening browser
```

Default ports: Dashboard on `:3848`, WebSocket on `:3847`.

The dashboard watches `.swarm/state.json` for changes, so agents run from other terminals (e.g. `swarm analyze` in terminal 2) update the dashboard in real-time.

## Project Structure

```
swarm/
├── package.json                 # npm workspaces monorepo
├── prompts/                     # Bundled persona system prompts (12 files)
│   ├── analyst-{react,node,go}.md
│   ├── Architect-{React,Node,Go}.md
│   ├── Software-lead-{react,node,go}.md
│   └── Software-engineer-{react,node,go}.md
├── packages/
│   ├── cli/                     # CLI package
│   │   ├── bin/swarm.ts         # Entry point
│   │   └── src/
│   │       ├── types.ts         # Shared type definitions
│   │       ├── commands/        # CLI command handlers (init, analyze, architect,
│   │       │                    #   plan, build, evaluate, status, agent, dashboard)
│   │       ├── core/
│   │       │   ├── agent-process.ts  # Claude CLI process wrapper (interactive + headless)
│   │       │   ├── agent-manager.ts  # Agent lifecycle, spawn/kill/sendInput
│   │       │   ├── pipeline.ts       # Stage sequencing with role boundaries
│   │       │   ├── ws-server.ts      # WebSocket + state.json file watcher
│   │       │   ├── guardrails.ts     # Artifact validation engine
│   │       │   ├── cost-tracker.ts   # Cost aggregation
│   │       │   ├── state.ts          # State persistence + stale cleanup
│   │       │   └── config.ts         # Config loading
│   │       └── prompts/
│   │           └── loader.ts         # Prompt file resolution (bundled + ~/.claude/)
│   └── dashboard/               # React web dashboard
│       ├── index.html
│       ├── vite.config.ts
│       └── src/
│           ├── App.tsx
│           ├── hooks/useWebSocket.ts
│           └── components/
│               ├── TopBar.tsx          # Stage indicators + live metrics
│               ├── AgentCard.tsx       # Per-agent status with permission badge
│               ├── CostPanel.tsx       # Cost breakdown
│               ├── OutputStream.tsx    # Live output + input box
│               ├── GuardrailAlerts.tsx # Violation display
│               ├── SpawnDialog.tsx     # Spawn form with permission mode
│               └── KillConfirmDialog.tsx # Kill confirmation modal
└── .swarm/                      # Created by `swarm init` (per-project)
    ├── config.yaml
    ├── guardrails.yaml
    ├── state.json               # Pipeline state (gitignored)
    └── logs/                    # Agent logs (gitignored)
```

## Configuration

`swarm init` creates `.swarm/config.yaml`:

```yaml
projectName: my-project
stack: react          # react | node | go
model: opus           # opus | sonnet | haiku
maxBudgetUsd: null    # null = no limit, or number
promptsDir: ~/.claude/prompts
wsPort: 3847
dashboardPort: 3848
permissions:
  permissionMode: default
```

## Guardrails

Built-in guardrail rules validate:

| Artifact | Checks |
|----------|--------|
| REQUIREMENTS.md | Has "Functional Requirements", "Scope", "Non-Functional Requirements" sections |
| SPEC.md | Has architecture section, Mermaid diagrams, ADRs, API contracts |
| TASKS.md | Task IDs (FND-001 pattern), checkboxes, acceptance criteria, dependency declarations |

Add custom rules in `.swarm/guardrails.yaml`:

```yaml
rules:
  - name: "Custom check"
    target: "REQUIREMENTS.md"
    checks:
      - type: section-exists
        value: "Data Requirements"
        message: "Must include data requirements"
        severity: error
      - type: pattern-match
        value: "interface\\s+\\w+"
        message: "Should include TypeScript interfaces"
        severity: warning
      - type: command
        value: "npm run lint"
        message: "Code must pass linting"
```

## Personas

Each persona has system prompts for three tech stacks (React, Node.js, Go), stored in `prompts/`.

| Persona | Role | Boundaries | Prompt Files |
|---------|------|-----------|-------------|
| **Analyst** | Clarify requirements → REQUIREMENTS.md | No architecture, no code, no tasks | `analyst-{stack}.md` |
| **Architect** | Design architecture → SPEC.md | No code, no task breakdown | `Architect-{Stack}.md` |
| **Lead** | Break into tasks → TASKS.md | No code, no architecture redesign | `Software-lead-{stack}.md` |
| **Engineer** | Implement code from TASKS.md | Full access — only persona that writes code | `Software-engineer-{stack}.md` |

The prompt loader searches in order: custom dir from config → bundled `prompts/` → `~/.claude/prompts/` → `~/.claude/prompt/`.

## Tech Stack

- **CLI**: TypeScript, Node.js, Commander.js, ws (WebSocket)
- **Dashboard**: React 19, Vite 6, Tailwind CSS 4, Lucide icons
- **Agent Runtime**: Claude CLI (`claude -p --output-format stream-json --verbose`)

## Prerequisites

- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Active Anthropic API subscription (agents consume API credits)

## Development

```bash
npm install             # Install dependencies
npm run build           # Build everything
npm run build:cli       # Build CLI only
npm run build:dashboard # Build dashboard only
npm run dev             # Dev mode (CLI with tsx)
npm run dev:dashboard   # Dev mode (dashboard with Vite HMR)
```
