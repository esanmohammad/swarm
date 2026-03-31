# Swarm Product Checklist

> Prioritized feature list from critical safety fixes to growth features.
> Work through top-to-bottom. Each item is self-contained and actionable.

---

## Tier 0 — Safety & Security (Must Fix Before Any User)

- [x] **P0-01 — WebSocket Authentication**
  Add token-based auth to the WS server. Generate a random token on `swarm dashboard` startup, pass it to the served HTML, require it on every WS connection. Reject unauthenticated clients.
  _Files: `ws-server.ts`, `dashboard.ts`, `useWebSocket.ts`_

- [x] **P0-02 — Aggregate Budget Enforcement**
  Track cumulative cost across all agents in a pipeline run. When total exceeds `maxBudgetUsd`, kill all running agents and halt the pipeline. Make default budget non-null (e.g., $10).
  _Files: `cost-tracker.ts`, `agent-manager.ts`, `pipeline.ts`, `types.ts`_

- [x] **P0-03 — Atomic State Writes**
  Write state to `state.json.tmp` then `fs.renameSync()` to `state.json`. Add `process.on('exit')` last-resort flush. Add try/catch around write for disk-full handling.
  _Files: `state.ts`_

- [x] **P0-04 — Orphan Process Killer**
  On startup (`cleanupStaleAgents`), read PIDs from state.json and `process.kill(pid)` any still-running claude processes. Write a PID file for the swarm process itself.
  _Files: `state.ts`, `dashboard.ts`, `shared.ts`_

- [x] **P0-05 — MayDay Cost Guard**
  Before each fix iteration, check cumulative pipeline cost against a configurable threshold. Abort fix loop if exceeded. Add `maxFixBudgetUsd` to MayDay options.
  _Files: `pipeline.ts` (maydayFixLoop), `types.ts`, `ws-server.ts`_

- [x] **P0-06 — Remove Internal Tooling from Prompts**
  Strip all references to Naos design system, DTSL, `@dtsl/*`, `AGENTS.md`, `.module.less`, internal component libraries from all 15 prompt files. Make prompts generic and stack-appropriate.
  _Files: `prompts/*.md` (all 15 files)_

---

## Tier 1 — MVP Launch Requirements

- [x] **P1-01 — Zero-Config Entry Point**
  `swarm "build a login page"` should auto-detect stack, auto-init `.swarm/` if missing, and run MayDay. No manual `swarm init` required for the happy path.
  _Files: `bin/swarm.ts`, `commands/mayday.ts`, `core/config.ts`_

- [x] **P1-02 — Cost Estimation Before Run**
  Before starting a pipeline or MayDay, estimate cost based on stage count and model. Display "Estimated cost: ~$8-12. Proceed? [Y/n]" in CLI. Show estimate in dashboard prompt form.
  _Files: `pipeline.ts`, `commands/mayday.ts`, `TopBar.tsx`_

- [x] **P1-03 — Git Branch + Auto-Commit Per Stage**
  Create a feature branch on MayDay start (`swarm/feature-name`). Auto-commit after each stage completes with a descriptive message. User can review with `git log`/`git diff`.
  _Files: `pipeline.ts`, `commands/mayday.ts`_

- [x] **P1-04 — Progress Indicators**
  CLI: Show elapsed time, current agent tool use, and running cost during pipeline stages. Dashboard: Add elapsed timer per stage, current tool indicator, and stage-level progress bar.
  _Files: `pipeline.ts`, `TopBar.tsx`, `AgentCard.tsx`_

- [x] **P1-05 — Fix WCAG Color Contrast**
  Audit all `text-stone-500/600/700` usages. Replace with `text-stone-300/400` to meet 4.5:1 ratio on dark backgrounds. Fix placeholder colors. Bump minimum text size to 11px.
  _Files: `App.tsx`, `TopBar.tsx`, `AgentCard.tsx`, `OutputStream.tsx`, `CostPanel.tsx`_

- [x] **P1-06 — Session Persistence**
  Persist agent output and activity logs to `.swarm/logs/{agentId}.jsonl` on disk. Load on dashboard connect/refresh. Survive browser refresh without data loss.
  _Files: `agent-manager.ts`, `ws-server.ts`, `useWebSocket.ts`, `state.ts`_

- [x] **P1-07 — Onboarding Empty State**
  When dashboard has no agents: show a guided panel explaining the pipeline, what each stage does, expected artifacts, and a "Start with MayDay" CTA. Add tooltips to stage buttons.
  _Files: `App.tsx`, new component `EmptyState.tsx`_

- [x] **P1-08 — Pre-Flight Checks (`swarm doctor`)**
  New command that verifies: claude CLI installed and on PATH, claude authenticated, Node.js version, disk space, .swarm/ exists. Run automatically before first agent spawn.
  _Files: new `commands/doctor.ts`, `bin/swarm.ts`, `agent-manager.ts`_

- [x] **P1-09 — Stage Skipping / Selective Re-Run**
  Allow `swarm mayday --from build` to skip analyze/architect/plan if artifacts exist. Dashboard: allow clicking a specific stage to re-run only that stage. Validate prerequisite artifacts.
  _Files: `pipeline.ts`, `commands/mayday.ts`, `ws-server.ts`, `TopBar.tsx`_

- [x] **P1-10 — Idempotency Guards**
  Before spawning a stage agent, check if the stage is already running or complete. Prevent duplicate spawns from dashboard double-clicks. Add "stage already complete, re-run?" confirmation.
  _Files: `pipeline.ts`, `ws-server.ts`, `TopBar.tsx`_

---

## Tier 2 — Competitive Parity

- [ ] **P2-01 — PR Creation on Completion**
  After successful MayDay or build stage, auto-create a GitHub PR using `gh pr create`. Include pipeline summary (stages, cost, agents, test results) in PR body.
  _Files: `pipeline.ts`, new `core/git.ts` helper_

- [ ] **P2-02 — Diff Viewer in Dashboard**
  Show files changed per agent with inline diff view. Parse agent activity for Edit/Write tool calls, extract file paths and changes. Add a "Changes" tab alongside activity/raw output.
  _Files: new component `DiffViewer.tsx`, `OutputStream.tsx`_

- [x] **P2-03 — Additional Tech Stacks**
  Add Python, Rust, Swift, and a "custom" stack option. Create prompt templates for each. Allow user-defined prompt directories per stack.
  _Files: `types.ts` (TechStack), new `prompts/*.md`, `loader.ts`, `TopBar.tsx`, `SpawnDialog.tsx`_

- [x] **P2-04 — VS Code Extension**
  Extension that: shows pipeline status in sidebar, allows running stages from command palette, displays agent output in VS Code panel, opens diffs in editor.
  _Files: new `packages/vscode/` package_

- [ ] **P2-05 — MayDay Approval Gates**
  Add `--approve` flag to MayDay. Pauses after each stage and waits for user approval before proceeding. Dashboard shows approve/reject buttons. CLI prompts interactively.
  _Files: `pipeline.ts`, `types.ts` (MaydayState), `TopBar.tsx`, `ws-server.ts`_

- [ ] **P2-06 — Custom Pipeline Definitions**
  Allow `.swarm/pipeline.yaml` to define custom stages, personas, and flow. Support conditional stages, parallel groups, and custom prompts per stage.
  _Files: new `core/pipeline-loader.ts`, `pipeline.ts`, `types.ts`_

- [ ] **P2-07 — Pipeline History**
  Save completed pipeline runs to `.swarm/history/`. Each run gets a timestamped directory with artifacts, agent logs, and summary. Dashboard shows past runs list with cost/duration comparison.
  _Files: `pipeline.ts`, `state.ts`, new component `HistoryView.tsx`_

- [ ] **P2-08 — Keyboard Shortcuts**
  Add: `Cmd+N` spawn agent, `Up/Down` cycle agents, `Cmd+K` kill selected, `Cmd+Enter` run next stage, `Cmd+L` toggle log/raw view, `Esc` close dialogs.
  _Files: `App.tsx`, all dialog components_

- [x] **P2-09 — Browser Notifications**
  Send browser notification when: agent finishes, agent errors, pipeline completes, guardrail violation, MayDay fix iteration starts. Respect notification permissions.
  _Files: `useWebSocket.ts`, `App.tsx`_

- [x] **P2-10 — Log Export & Copy**
  Add "Copy output" and "Export log" buttons to OutputStream. Export as `.txt` (raw) or `.json` (structured activities). Copy selected agent output to clipboard.
  _Files: `OutputStream.tsx`_

---

## Tier 3 — Growth & Enterprise

- [ ] **P3-01 — Multi-User Dashboard with Auth**
  Add login (email/password or OAuth). Track which user initiated each action. Show user avatars on agent cards. Require auth for WS commands.
  _Files: `ws-server.ts`, `dashboard.ts`, new auth module, dashboard login page_

- [ ] **P3-02 — GitHub Action**
  Publish `swarm-action` that runs MayDay on issue creation or PR comment. Posts results as PR comment. Supports matrix builds (multiple stacks).
  _Files: new `.github/actions/swarm/` or separate repo_

- [ ] **P3-03 — Webhooks on Completion**
  Fire configurable webhooks when: stage completes, pipeline finishes, agent errors, budget threshold hit. Support Slack, Discord, and generic HTTP POST.
  _Files: new `core/webhooks.ts`, `types.ts` (SwarmConfig), `pipeline.ts`_

- [ ] **P3-04 — Feature Isolation (Multi-Pipeline)**
  Support multiple concurrent pipelines per project. Each pipeline gets its own state, artifacts directory, and git branch. Dashboard shows pipeline selector.
  _Files: `state.ts`, `pipeline.ts`, `types.ts`, `App.tsx`, `TopBar.tsx`_

- [ ] **P3-05 — Persistent Audit Trail**
  Write structured logs to `.swarm/audit.jsonl`. Each entry: timestamp, user, action, agentId, cost, files changed. Queryable via `swarm audit` CLI command.
  _Files: new `core/audit.ts`, `agent-manager.ts`, `ws-server.ts`, new `commands/audit.ts`_

- [ ] **P3-06 — Multi-Model Per Stage**
  Configure model per persona in `.swarm/config.yaml` (e.g., Haiku for analyst, Sonnet for architect, Opus for engineer). Dashboard shows model per agent.
  _Files: `types.ts` (SwarmConfig), `pipeline.ts`, `config.ts`_

- [ ] **P3-07 — Plugin System for Custom Personas**
  Allow `.swarm/personas/` directory with custom persona definitions (prompt + tool restrictions + artifact expectations). Register custom personas in config.
  _Files: `types.ts`, `loader.ts`, `pipeline.ts`, `SpawnDialog.tsx`_

- [ ] **P3-08 — Quality Scoring**
  Beyond structural guardrails — evaluate artifact quality using a secondary LLM call. Score requirements completeness, spec consistency, test coverage. Show scores in dashboard.
  _Files: `guardrails.ts`, new `core/quality.ts`, `TopBar.tsx`_

- [ ] **P3-09 — Multi-Repo Support**
  Allow MayDay to operate across multiple repos (e.g., frontend + backend). Coordinate agents across directories. Unified dashboard view.
  _Files: `pipeline.ts`, `state.ts`, `types.ts`, `config.ts`_

- [ ] **P3-10 — RBAC / SSO / Compliance**
  Role-based access control (admin, developer, viewer). SSO integration (Google, GitHub, SAML). Compliance mode: signed commits, approval-required stages, data retention policies.
  _Files: new `core/auth/` module, enterprise feature set_

---

## Progress Tracker

| Tier | Total | Done | Remaining |
|------|-------|------|-----------|
| Tier 0 — Safety | 6 | 6 | 0 |
| Tier 1 — MVP | 10 | 10 | 0 |
| Tier 2 — Competitive | 10 | 4 | 6 |
| Tier 3 — Growth | 10 | 0 | 10 |
| **Total** | **36** | **20** | **16** |
