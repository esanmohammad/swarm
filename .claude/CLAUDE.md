# CLAUDE.md

## Project Overview

Swarm is a CLI tool + web dashboard that orchestrates Claude Code sub-agents through a 4-stage development pipeline: Analyst → Architect → Lead → Engineer. It spawns `claude` CLI processes with specialized system prompts and tracks their output, cost, and status in real time.

## Repository Structure

npm workspaces monorepo with two packages:

- `packages/cli` — TypeScript CLI (Commander.js). Entry: `bin/swarm.ts`. Core: `src/core/`. Commands: `src/commands/`.
- `packages/dashboard` — React 19 + Vite + Tailwind CSS web UI. Connects to CLI via WebSocket.
- `prompts/` — 12 bundled persona system prompts (4 personas × 3 tech stacks: React, Node, Go).

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

- **AgentProcess** (`core/agent-process.ts`) — Wraps a single `claude` CLI process. Supports interactive, non-interactive, and resume modes. Parses stream-json (content at `msg.message.content[].text`, NOT `msg.content`).
- **AgentManager** (`core/agent-manager.ts`) — Manages multiple agents. `spawn()`, `kill()`, `sendInput()` (resumes session with user text), `waitForAgent()`.
- **Pipeline** (`core/pipeline.ts`) — Sequences the 4 stages. Each stage prompt includes **strict role boundaries** (analyst can't code, architect can't create tasks, etc.). `runBuild()` parses TASKS.md for parallel groups.
- **StateManager** (`core/state.ts`) — Persists `PipelineState` to `.swarm/state.json`. Debounced writes (100ms). `cleanupStaleAgents()` on dashboard startup removes finished/orphaned agents.
- **SwarmWsServer** (`core/ws-server.ts`) — WebSocket server on port 3847. Broadcasts state changes. Watches `state.json` with `fs.watch()` for cross-process updates. Handles commands: spawn, kill, send-input, get-state.
- **GuardrailsEngine** (`core/guardrails.ts`) — Validates artifacts. Check types: `section-exists`, `pattern-match`, `command`. Loads custom rules from `.swarm/guardrails.yaml`.
- **PromptLoader** (`prompts/loader.ts`) — Resolves persona + stack to prompt file. Search order: custom dir → bundled `prompts/` → `~/.claude/prompts/` → `~/.claude/prompt/`. Handles inconsistent filename casing.

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
