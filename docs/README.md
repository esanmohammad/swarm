# Swarm Technical Documentation

> **Swarm** — A CLI tool + web dashboard that orchestrates Claude Code sub-agents through a multi-stage development pipeline.

---

## Documentation Index

| # | Document | Description |
|---|----------|-------------|
| 01 | [Architecture Overview](./01-architecture-overview.md) | System architecture, core abstractions, data flow diagrams, tech stack, configuration |
| 02 | [Agent Process Model](./02-agent-process-model.md) | How agents are spawned, stream-JSON parsing, interactive/non-interactive modes, sub-agent tracking, lifecycle state machine |
| 03 | [Pipeline Orchestration](./03-pipeline-orchestration.md) | 5-stage pipeline flow, persona enforcement, task parsing, artifact chain, permission modes |
| 04 | [CLI Commands](./04-cli-commands.md) | All 11 commands with options, internal execution flows, sequence diagrams |
| 05 | [Dashboard & WebSocket](./05-dashboard-and-websocket.md) | React components, layout, WebSocket protocol, real-time sync, message types |
| 06 | [MayDay Autonomous Pipeline](./06-mayday-autonomous-pipeline.md) | Autonomous end-to-end pipeline, fix-retest loop, cross-session resume, user input system |
| 07 | [State Management](./07-state-management.md) | Persistence, debounced writes, cross-process sync, cost tracking, cleanup |
| 08 | [Persona & Prompt System](./08-persona-and-prompt-system.md) | 5 personas, prompt resolution, system enforcement, tool restrictions, guardrails |
| 09 | [Product Analysis — Internal Audit](./09-product-analysis.md) | Known UX gaps, improvement roadmap, technical debt tracking |
| 10 | [Testing, Resilience & Tier 3 Features](./10-testing-resilience-and-tier3.md) | Agent timeout, stage retry, structured test parsing, stack-aware frameworks, fix loop intelligence, multi-model, webhooks, audit trail, custom personas, GitHub Action, quality scoring, multi-pipeline |
| 11 | [Customization Guide](./11-customization-guide.md) | Custom personas, new tech stacks, guardrail rules, plugins, webhooks, Playwright config |
| -- | [Troubleshooting](./TROUBLESHOOTING.md) | Common problems and fixes, cost management, getting help |

---

## Quick Start

```bash
npm install -g swarm-pipeline   # Install
swarm "Add a login page"        # Build a feature
swarm dashboard                 # Launch web UI
```

## How to Read These Docs

- **New to the project?** Start with [01 - Architecture Overview](./01-architecture-overview.md) for the big picture
- **Want to customize Swarm?** Read [11 - Customization Guide](./11-customization-guide.md)
- **Having problems?** Check [Troubleshooting](./TROUBLESHOOTING.md)
- **Understanding agent execution?** Read [02 - Agent Process Model](./02-agent-process-model.md) then [03 - Pipeline Orchestration](./03-pipeline-orchestration.md)
- **Working on the CLI?** See [04 - CLI Commands](./04-cli-commands.md) for all command flows
- **Working on the dashboard?** See [05 - Dashboard & WebSocket](./05-dashboard-and-websocket.md)
- **Understanding MayDay?** See [06 - MayDay Autonomous Pipeline](./06-mayday-autonomous-pipeline.md)
- **Debugging state issues?** See [07 - State Management](./07-state-management.md)
- **Modifying prompts?** See [08 - Persona & Prompt System](./08-persona-and-prompt-system.md)
- **New features (testing, webhooks, quality, etc.)?** See [10 - Testing, Resilience & Tier 3](./10-testing-resilience-and-tier3.md)

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│                    User / Developer                      │
├──────────────────────┬──────────────────────────────────┤
│     CLI (Terminal)   │        Dashboard (Browser)        │
│   swarm <command>    │     React 19 + Tailwind CSS       │
├──────────────────────┴──────────────────────────────────┤
│                  WebSocket (port 3847)                    │
├─────────────────────────────────────────────────────────┤
│                    Core Engine                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │ Pipeline │ │  Agent   │ │  State   │ │ Guardrails│  │
│  │          │ │ Manager  │ │ Manager  │ │  Engine   │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │
├─────────────────────────────────────────────────────────┤
│              Claude CLI Subprocesses                      │
│  ┌─────────┐ ┌──────────┐ ┌────────┐ ┌──────────────┐  │
│  │ Analyst │ │Architect │ │  Lead  │ │  Engineer(s) │  │
│  └─────────┘ └──────────┘ └────────┘ └──────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Pipeline Flow

```
Feature Request
      │
      ▼
  ┌────────┐     ┌───────────┐     ┌────────┐     ┌───────┐     ┌──────┐
  │Analyze │────▶│ Architect │────▶│  Plan  │────▶│ Build │────▶│ Test │
  └────────┘     └───────────┘     └────────┘     └───────┘     └──────┘
      │               │                │              │             │
      ▼               ▼                ▼              ▼             ▼
 REQUIREMENTS.md   SPEC.md        TASKS.md         Code      Test Results
```

> All diagrams in these docs use [Mermaid](https://mermaid.js.org/) syntax — viewable directly on GitHub or any Mermaid-compatible renderer.
