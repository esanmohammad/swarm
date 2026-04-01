# Changelog

## 0.1.0 (Unreleased)

### Features
- 5-stage pipeline: Analyze → Architect → Plan → Build → Test
- `swarm "feature request"` — zero-config full pipeline execution
- MayDay autonomous mode with intelligent fix loop
- Web dashboard with 4 views: Launch, Pipeline, Results, History
- Real-time cost tracking and budget controls
- 30 persona system prompts across 6 tech stacks
- Stage retry with 2 attempts on failure
- Parallel engineer agents for build stage
- Guardrails engine for artifact validation
- Auto-detect tech stack from project files
- Claude CLI dependency check with install guidance
- `swarm doctor` pre-flight health checks

### Defaults
- Model: Sonnet (cost-effective default)
- Budget: $5 per pipeline run
- Parallel agents: 3 during build
