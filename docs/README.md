# Swarm Technical Documentation

> **Swarm** — A CLI tool + web dashboard that orchestrates Claude Code sub-agents through a multi-stage development pipeline.

---

## Documentation Index

| # | Document | Description |
|---|----------|-------------|
| 01 | [Architecture Overview](./01-architecture-overview.md) | System architecture, core abstractions, data flow diagrams, tech stack, configuration |
| 02 | [Agent Process Model](./02-agent-process-model.md) | How agents are spawned, stream-JSON parsing, interactive/non-interactive modes, sub-agent tracking, lifecycle state machine |
| 03 | [Pipeline Orchestration](./03-pipeline-orchestration.md) | 5-stage pipeline flow, persona enforcement, task parsing, artifact chain, permission modes |
| 04 | [CLI Commands](./04-cli-commands.md) | Core commands with options, internal execution flows, sequence diagrams |
| 05 | [Dashboard & WebSocket](./05-dashboard-and-websocket.md) | React components, layout, WebSocket protocol, real-time sync, message types |
| 06 | [MayDay Autonomous Pipeline](./06-mayday-autonomous-pipeline.md) | Autonomous end-to-end pipeline, fix-retest loop, cross-session resume, user input system |
| 07 | [State Management](./07-state-management.md) | Persistence, debounced writes, cross-process sync, cost tracking, cleanup |
| 08 | [Persona & Prompt System](./08-persona-and-prompt-system.md) | 5 personas, prompt resolution, system enforcement, tool restrictions, guardrails |
| 09 | [Product Analysis — Internal Audit](./09-product-analysis.md) | Known UX gaps, improvement roadmap, technical debt tracking |
| 10 | [Testing, Resilience & Tier 3 Features](./10-testing-resilience-and-tier3.md) | Agent timeout, stage retry, structured test parsing, stack-aware frameworks, fix loop intelligence, multi-model, webhooks, audit trail, custom personas, GitHub Action, quality scoring, multi-pipeline |
| 11 | [Customization Guide](./11-customization-guide.md) | Custom personas, new tech stacks, guardrail rules, plugins, webhooks, Playwright config |
| 12 | [Quick Workflows](./12-quick-workflows.md) | fix, spike, review, refactor, simplify, ci — single-purpose AI workflows |
| 13 | [Intelligence and Memory](./13-intelligence-and-memory.md) | learn, memory, explain, stats, watch, babysit-prs — codebase awareness and continuous monitoring |
| 14 | [Deployment and Infrastructure](./14-deployment-and-infrastructure.md) | deploy, migrate, server — AI-driven deployment, database migrations, job server |
| 15 | [Autopilot and Automation](./15-autopilot-and-automation.md) | autopilot, test-gen, deps, risk, incident, pr, health, benchmark, pm, multi-repo — hands-free engineering |
| 16 | [Security Suite](./16-security-suite.md) | secure, secrets, supply-chain, sandbox, prompt-guard, fingerprint, monitor — full security toolchain |
| 17 | [Autonomous Employee](./17-autonomous-employee.md) | inbox, standup, journal, scope, context, pair, delegate, report, team, retro — Wave 3 AI teammate |
| 18 | [Autonomous Engineering Organization](./18-autonomous-organization.md) | own, architect-review, onboard, mentor, roadmap, system, slo, evolve, forecast, compliance — Wave 4 org-level AI |
| 19 | [Product-Aware Intelligence](./19-product-aware-intelligence.md) | observe, experiment, improve, optimize, impact, fleet, contract, simulate, teach — Wave 5 engineering leader |
| 20 | [Autonomous Engineering Company](./20-autonomous-engineering-company.md) | negotiate, specialize, govern, empathize, allocate, compete, spawn-capability, federate — Wave 6 CTO-level AI |
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
- **Working on the CLI?** See [04 - CLI Commands](./04-cli-commands.md) for core command flows
- **Working on the dashboard?** See [05 - Dashboard & WebSocket](./05-dashboard-and-websocket.md)
- **Understanding MayDay?** See [06 - MayDay Autonomous Pipeline](./06-mayday-autonomous-pipeline.md)
- **Debugging state issues?** See [07 - State Management](./07-state-management.md)
- **Modifying prompts?** See [08 - Persona & Prompt System](./08-persona-and-prompt-system.md)
- **New features (testing, webhooks, quality, etc.)?** See [10 - Testing, Resilience & Tier 3](./10-testing-resilience-and-tier3.md)
- **Using quick workflows (fix, spike, review…)?** See [12 - Quick Workflows](./12-quick-workflows.md)
- **Using intelligence features (learn, memory, explain…)?** See [13 - Intelligence and Memory](./13-intelligence-and-memory.md)
- **Using deploy, migrate, or server?** See [14 - Deployment and Infrastructure](./14-deployment-and-infrastructure.md)
- **Using autopilot or automation commands?** See [15 - Autopilot and Automation](./15-autopilot-and-automation.md)
- **Using security commands?** See [16 - Security Suite](./16-security-suite.md)
- **Using Wave 3 employee features?** See [17 - Autonomous Employee](./17-autonomous-employee.md)
- **Using Wave 4 organization features?** See [18 - Autonomous Engineering Organization](./18-autonomous-organization.md)
- **Using Wave 5 product-aware features (observe, experiment, optimize…)?** See [19 - Product-Aware Intelligence](./19-product-aware-intelligence.md)
- **Using Wave 6 CTO-level features (negotiate, govern, specialize…)?** See [20 - Autonomous Engineering Company](./20-autonomous-engineering-company.md)

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
