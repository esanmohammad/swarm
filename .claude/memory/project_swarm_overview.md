---
name: Swarm project overview
description: Architecture, tech stack, and current state of the Swarm CLI + Dashboard product for Claude agent orchestration
type: project
---

**Swarm** is a CLI tool + web dashboard that orchestrates Claude Code sub-agents through a 4-stage pipeline: Analyst → Architect → Lead → Engineer.

**Why:** User has a 4-persona prompt system (12 prompt files: 4 roles × 3 stacks) and wants a unified tool to orchestrate, visualize, and manage these agents with cost tracking and guardrails.

**How to apply:** This is the primary project in this repo. All work relates to building and improving this tool.

## Tech Stack
- **Monorepo**: npm workspaces (`packages/cli` + `packages/dashboard`)
- **CLI**: TypeScript, Commander.js, ws (WebSocket), chalk, ora
- **Dashboard**: React 19, Vite 6, Tailwind CSS 4, Lucide icons
- **Agent Runtime**: Spawns `claude` CLI processes with `-p --output-format stream-json --verbose`

## Architecture
- `AgentProcess` wraps a single `claude` child process, parses NDJSON stream
- `AgentManager` spawns/tracks/kills agents, wires events to state + cost
- `Pipeline` sequences stages (analyze/architect/plan/build), each spawning appropriate persona
- `SwarmWsServer` pushes real-time state to dashboard via WebSocket + watches `.swarm/state.json` for cross-process updates
- `GuardrailsEngine` validates artifacts (section-exists, pattern-match, command checks)

## Key Design Decisions
- Analyst/Architect/Lead run in **interactive mode** (2-step: bootstrap with `-p`, then `--resume` with inherited stdio) so user can answer questions
- Engineer runs in **non-interactive mode** (`-p --output-format stream-json`) for headless parallel execution
- Dashboard agents always non-interactive; user input sent via `sendInput()` which does `claude -p "<text>" --resume <session-id>`
- Stream-json format: content is at `msg.message.content[].text` (NOT `msg.content`)
- Default model: `opus`, default budget: no limit (null)
- Permission modes for dashboard: acceptEdits, auto, plan, bypassPermissions (no "ask" — can't work headless)

## Current State (2026-03-29)
- All core features implemented and building clean
- CLI alias: `swarm` → `node /Users/esanmohammad/prototyping/swarm/packages/cli/dist/bin/swarm.js`
- 12 persona prompts bundled in `prompts/` directory
- Dashboard serves from `packages/dashboard/dist/` via CLI's built-in HTTP server
- Known areas for improvement: dashboard agent input (resume flow), real-time output streaming reliability
