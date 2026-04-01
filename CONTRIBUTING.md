# Contributing to Swarm

Thanks for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/esanmohammad/swarm
cd swarm
npm install
npm run build
```

### Project Structure

```
packages/
  cli/           — TypeScript CLI (Commander.js)
    bin/         — Entry point (swarm.ts)
    src/
      commands/  — CLI command handlers
      core/      — Pipeline, agent manager, state, WebSocket server
  dashboard/     — React 19 + Vite + Tailwind web UI
    src/
      views/     — Full-screen page layouts
      components/— Reusable UI components
      hooks/     — WebSocket connection, state sync
prompts/         — Persona system prompts (5 personas x 7 tech stacks)
docs/            — Technical reference documentation (10 docs)
```

### Building

```bash
npm run build            # Build everything
npm run build:cli        # CLI only
npm run build:dashboard  # Dashboard only
```

### Running in Development

```bash
npm run dev              # CLI via tsx (auto-reload)
npm run dev:dashboard    # Dashboard via Vite HMR
```

### Testing Changes

After making changes, verify they work:

```bash
npm run build:cli        # Rebuild CLI
swarm doctor             # Verify environment is healthy
swarm init               # Initialize a test project (creates .swarm/)
swarm status             # Confirm pipeline state loads
swarm dashboard          # Test the web UI opens
```

For pipeline changes, test with a real feature request:

```bash
swarm analyze "Add a hello world endpoint" --no-interactive
```

## Architecture Overview

Before diving into the code, read [docs/01-architecture-overview.md](docs/01-architecture-overview.md) for the big picture.

Key docs for contributors:

| Area | Doc |
|------|-----|
| How agents spawn and run | [02 - Agent Process Model](docs/02-agent-process-model.md) |
| Pipeline stage flow | [03 - Pipeline Orchestration](docs/03-pipeline-orchestration.md) |
| CLI command handlers | [04 - CLI Commands](docs/04-cli-commands.md) |
| Dashboard components & WebSocket | [05 - Dashboard & WebSocket](docs/05-dashboard-and-websocket.md) |
| MayDay autonomous pipeline | [06 - MayDay Autonomous Pipeline](docs/06-mayday-autonomous-pipeline.md) |
| State persistence | [07 - State Management](docs/07-state-management.md) |
| Prompt system & personas | [08 - Persona & Prompt System](docs/08-persona-and-prompt-system.md) |
| Webhooks, audit, quality scoring | [10 - Testing & Tier 3 Features](docs/10-testing-resilience-and-tier3.md) |

## Conventions

- **ESM throughout** — `"type": "module"`, `.js` import extensions even for TypeScript
- **TypeScript strict mode** — no `any` unless absolutely necessary
- CLI types: `packages/cli/src/types.ts`
- Dashboard types: `packages/dashboard/src/types.ts` (mirrored copy — keep in sync)
- CLI commands follow the pattern: `requireSwarmDir()` + `loadConfig()` + `createContext()` → delegate to Pipeline or AgentManager

## Contribution Ideas

Looking for something to work on? Here are areas that need help:

- **Accessibility** — The dashboard needs ARIA labels, keyboard navigation, and screen reader support
- **Responsive design** — Dashboard currently only works on desktop
- **Tests** — The project needs unit and integration tests for core modules
- **New tech stacks** — Add persona prompts for Java, C#, Ruby, or other languages
- **Documentation** — Examples, tutorials, and troubleshooting guides
- **Error messages** — Make error recovery guidance more helpful for beginners

## Submitting Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm run build` to verify everything compiles
4. Open a PR with a clear description of what and why

## Reporting Issues

File issues at [github.com/esanmohammad/swarm/issues](https://github.com/esanmohammad/swarm/issues).

Include:
- What you expected vs. what happened
- Your Node.js version (`node --version`)
- Your Claude CLI version (`claude --version`)
- Output of `swarm doctor`
- Relevant error output
