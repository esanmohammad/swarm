# CLAUDE.md

## Project Overview

Swarm is a CLI tool + web dashboard that orchestrates Claude Code sub-agents through a 5-stage development pipeline: Analyst → Architect → Lead → Engineer → Tester. It spawns `claude` CLI processes with specialized system prompts and tracks their output, cost, and status in real time. Features include autonomous MayDay pipeline, intelligent fix loops, stack-aware test frameworks, quality scoring, webhooks, audit trail, multi-model per stage, custom personas, and multi-pipeline support.

## Repository Structure

npm workspaces monorepo with two packages:

- `packages/cli` — TypeScript CLI (Commander.js). Entry: `bin/swarm.ts`. Core: `src/core/`. Commands: `src/commands/`.
- `packages/dashboard` — React 19 + Vite + Tailwind CSS web UI. Connects to CLI via WebSocket.
- `prompts/` — Bundled persona system prompts (5 personas × 7 tech stacks: React, Node, Go, Python, Rust, Swift, custom).
- `docs/` — 10-document technical reference suite.
- `.github/actions/swarm/` — GitHub Action for CI/CD integration.

## Build & Run

```bash
npm install              # Install all workspace deps
npm run build            # Build both packages (CLI then dashboard)
npm run build:cli        # Build CLI only (tsc)
npm run build:dashboard  # Build dashboard only (tsc + vite build)
```

CLI binary: `packages/cli/dist/bin/swarm.js`. Alias: `swarm` in `~/.zshrc`.

## Architecture

### Agent Process Model

Two modes:

**Non-interactive (headless)**: `claude -p "<prompt>" --output-format stream-json --verbose --model <model> --session-id <uuid> --system-prompt "<persona>"`. Used for engineers and dashboard-spawned agents. Output parsed as NDJSON.

**Interactive (two-step)**:
1. Bootstrap: same as headless, captures first response
2. Resume: `claude --resume <session-id>` with `stdio: 'inherit'` — user converses in terminal
Used for analyst, architect, lead via CLI.

**Session resume (dashboard input)**: `claude -p "<user-text>" --output-format stream-json --verbose --resume <session-id>`. Used when dashboard user sends follow-up messages to agents.

### Key Abstractions

- **AgentProcess** (`core/agent-process.ts`) — Wraps a single `claude` CLI process. Supports interactive, non-interactive, and resume modes. Parses stream-json. Has inactivity watchdog (default 30min timeout).
- **AgentManager** (`core/agent-manager.ts`) — Manages multiple agents. `spawn()`, `kill()`, `sendInput()`, `waitForAgent()`. Output capped at 50KB ring-buffer per agent.
- **Pipeline** (`core/pipeline.ts`) — Sequences 5 stages with strict role boundaries. Features: stage retry (2 attempts), stack-aware test frameworks, structured test result parsing, intelligent fix loop (per-failure targeting, regression detection, fix history), multi-model per stage, quality scoring, webhooks.
- **StateManager** (`core/state.ts`) — Persists `PipelineState` to `.swarm/state.json`. Backup-before-write (`state.json.bak`), auto-recovery from backup. Multi-pipeline namespace support.
- **SwarmWsServer** (`core/ws-server.ts`) — WebSocket server. Broadcasts state changes. Token-based auth. Watches `state.json` with `fs.watch()`. Commands: spawn, kill, send-input, get-state, run-stage, run-mayday, mayday-approve/reject, get-history.
- **GuardrailsEngine** (`core/guardrails.ts`) — Validates artifacts. Check types: `section-exists`, `pattern-match`, `command`, `min-length`, `word-count`, `required-patterns`. Custom rules from `.swarm/guardrails.yaml`.
- **PromptLoader** (`prompts/loader.ts`) — Resolves persona + stack to prompt file. Supports custom personas from `.swarm/personas/*.yaml`. Search: custom personas → bundled `prompts/` → `~/.claude/prompts/` → `~/.claude/prompt/`.
- **WebhookManager** (`core/webhooks.ts`) — Fires HTTP POST on pipeline events. Supports Slack, Discord, generic formats. HMAC signing.
- **AuditLog** (`core/audit.ts`) — Structured event log to `.swarm/audit.jsonl`. Queryable via `swarm audit` CLI.
- **QualityScorer** (`core/quality.ts`) — Heuristic quality scoring for pipeline artifacts (0-100 per dimension).

### Shared Context

`commands/shared.ts` exports `createContext()` which wires up all managers + registers SIGINT/SIGTERM cleanup (kills all agents, stops WS server, flushes state).

### Data Flow

```
CLI Command → Pipeline → AgentManager.spawn() → AgentProcess (claude subprocess)
                                                      │
                                                      ├─ content events → agent.output + WS broadcast
                                                      ├─ result event → cost + state update
                                                      └─ exit event → error handling / done fallback

StateManager ──events──▶ SwarmWsServer ──WebSocket──▶ Dashboard (React)
                              ▲
                              │── fs.watch(state.json) for cross-process updates

Dashboard input box → WsCommand{send-input} → AgentManager.sendInput()
                                                → claude -p "<text>" --resume <session-id>
```

## Type System

CLI types: `packages/cli/src/types.ts`. Dashboard types: `packages/dashboard/src/types.ts` (mirrored copy).

Key types: `Agent` (includes `permissionMode`), `PipelineState`, `WsMessage`, `WsCommand` (spawn/kill/send-input/get-state), `SwarmConfig`, `GuardrailRule`, `PermissionMode`.

## Conventions

- ESM throughout (`"type": "module"`, `.js` import extensions)
- CLI commands: register function takes `Commander.Command`, adds subcommand with async action handler
- Action handler pattern: `requireSwarmDir()` + `loadConfig()` + `createContext()` → delegate to Pipeline or AgentManager
- Default model: `opus`. Default budget: `null` (no limit).
- Dashboard permission modes: `acceptEdits`, `auto`, `plan`, `bypassPermissions`. No "default/ask" — can't work headless.

## Persona System

| Persona | Prompt Pattern | Artifact | Role Boundary |
|---------|---------------|----------|---------------|
| analyst | `analyst-{stack}.md` | REQUIREMENTS.md | No architecture, no code, no tasks |
| architect | `Architect-{Stack}.md` | SPEC.md | No code, no task breakdown |
| lead | `Software-lead-{stack}.md` | TASKS.md | No code, no architecture redesign |
| engineer | `Software-engineer-{stack}.md` | Code | Full access |
| tester | `test-engineer-{stack}.md` | TESTPLAN.md | No source code changes, test plan only |

TASKS.md uses IDs like `FND-001`, `SVC-002` with parallel group markers. `Pipeline.parseTaskGroups()` extracts these.

## Testing Changes

```bash
npm run build:cli                        # After CLI changes
npm run build                            # After any changes
swarm --help                             # Verify CLI
swarm init && swarm status               # Smoke test
swarm dashboard                          # Test dashboard
```

## Known Gotchas

- `stream-json` requires `--verbose` flag in print mode
- Content path in stream-json: `msg.message.content[].text` (NOT `msg.content`)
- `--resume` works with `-p` for multi-turn headless conversations
- Dashboard path resolution: 4 levels of `..` from `dist/src/commands/` to reach `packages/dashboard/dist/`
- Interactive mode exit: 100ms fallback timeout marks agent as done if `result` event doesn't fire
- `cleanupStaleAgents()` runs on dashboard startup — clears all finished agents, marks orphaned running ones as error
- `fs.watch()` on state.json has 150ms debounce to avoid duplicate broadcasts
- `sendInput()` accumulates cost across turns (doesn't reset)
