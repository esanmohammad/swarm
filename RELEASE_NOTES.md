# Hivemind v0.1.0 — Initial Release

**Describe a feature. Get working, tested code.**

Hivemind orchestrates Claude Code agents through a 5-stage pipeline — from requirements to passing tests — while you watch in a real-time web dashboard.

## Highlights

### Full Pipeline Automation
- Describe a feature in plain English and Hivemind handles the rest
- 5-stage pipeline: Requirements → Design → Tasks → Code → Test
- Stack-specific system prompts for React, Node, Go, Python, Rust, and Swift
- Parallel build agents for faster code generation
- Intelligent fix loop with per-failure targeting and regression detection

### Real-Time Web Dashboard
- Activity feed with keyboard navigation (arrow keys / j/k)
- Live agent output with markdown rendering
- GitHub-style diff viewer (unified + split view)
- Pipeline progress tracking ("step 2 of 5")
- Stop, Resume, Retry controls on all activities
- Command palette (Cmd+K)

### Quick Workflows
- `hivemind fix "bug description"` — Fix a bug directly
- `hivemind review` — Review local changes or a PR by link
- `hivemind spike "question"` — Quick codebase research
- `hivemind refactor "what to change"` — Restructure code
- `hivemind dashboard` — Open the web UI

### Workspace Tools
- **PR Reviews** — Review PRs by link, number, or scan all open PRs
- **Coding Conventions** — Auto-scan or manually define project patterns
- **Project Memory** — Persistent knowledge that survives across runs
- **Usage & Costs** — Deep analytics with token usage, activity breakdown, cost by stage

### Budget Management
- Set budget limits per run or globally
- Agents pause (not kill) when budget is reached
- Dashboard prompts to increase budget with quick $5/$10/$25/$50 buttons
- Model degradation: auto-switches to cheaper models at 80/90% budget

### Build Options
- **Model selection**: Opus, Sonnet, or Haiku per run
- **Lean mode**: Haiku for doc stages, saves ~60% on early pipeline steps
- **Figma URL**: Paste a design link for visual reference
- **Budget limit**: Set a dollar cap with approval flow

## Install

```bash
npm install -g hivemind-pipeline
```

Or run without installing:

```bash
npx hivemind-pipeline "add a login page"
```

## Requirements

- Node.js >= 18
- Claude Code CLI installed and authenticated

## Links

- [GitHub Repository](https://github.com/esanmohammad/swarm)
- [npm Package](https://www.npmjs.com/package/hivemind-pipeline)
