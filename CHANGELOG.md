# Changelog

All notable changes to this project will be documented in this file.

## 0.1.0 (Unreleased)

First public release.

### Features

**Core Pipeline**
- 5-stage pipeline: Analyze → Architect → Plan → Build → Test
- `swarm "feature request"` — zero-config full pipeline execution
- Auto-detect tech stack from project files (package.json, go.mod, etc.)
- Parallel engineer agents for the build stage (default: 3)
- Stage retry with 2 attempts on failure
- Per-stage model overrides (use haiku for cheap stages, opus for critical ones)

**MayDay Autonomous Mode**
- `swarm mayday` — end-to-end autonomous pipeline with intelligent fix loop
- Structured test result parsing with per-failure targeting
- Regression detection across fix iterations
- Cross-session resume (`--resume`)
- Optional approval gates between stages (`--approve`)
- Figma design integration (`--figma <url>`)

**Dashboard**
- Web UI with 4 views: Launch, Pipeline, Results, History
- Real-time agent output streaming via WebSocket
- Activity log with tool call visualization
- File diff viewer for code changes
- Spawn and manage individual agents
- Cost tracking per agent and per pipeline

**CLI**
- `swarm doctor` — pre-flight environment health checks
- `swarm status` — pipeline state, agent status, and cost summary
- `swarm audit` — structured event log with filtering
- `swarm evaluate` — guardrail validation for artifacts
- `swarm recover` — restore state from backup
- `swarm agent spawn/list/kill` — standalone agent management

**Personas & Prompts**
- 30 persona system prompts across 7 tech stacks (React, Node, Go, Python, Rust, Swift, custom)
- Custom personas from `.swarm/personas/*.yaml`
- Strict role boundaries per persona

**Infrastructure**
- Real-time cost tracking with budget caps
- Guardrails engine for artifact validation
- Webhook notifications (Slack, Discord, generic HTTP)
- Structured audit trail (`.swarm/audit.jsonl`)
- Quality scoring for pipeline artifacts
- Plugin system for custom stages and personas
- GitHub Action for CI/CD integration
- Multi-pipeline namespace support

### Defaults

- Model: Sonnet (cost-effective default)
- Budget: $5 per pipeline run
- Parallel agents: 3 during build
- Inactivity timeout: 30 minutes per agent
