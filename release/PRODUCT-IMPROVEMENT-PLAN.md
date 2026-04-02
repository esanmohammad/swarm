# Swarm Product Improvement Plan

> Based on a brutal critical analysis of the product's real-world engineering utility.
> Organized by impact. Each section is an independent workstream with concrete tasks.

---

## Executive Summary

Swarm is technically well-built but solves a narrow problem (greenfield waterfall) with an inflexible model. These improvements target the three biggest gaps: **versatility** (handle real engineering work beyond greenfield), **autonomy** (smarter failure recovery), and **real-world integration** (fit into how engineers actually work).

**Current scores:**
| Dimension | Score | Target |
|-----------|-------|--------|
| Versatility | 4/10 | 7/10 |
| Autonomy | 5/10 | 7/10 |
| Real-life utility | 5/10 | 8/10 |

---

## Workstream 1: Break the Waterfall — Flexible Pipeline Modes

**Problem:** The rigid 5-stage waterfall doesn't fit 80% of real engineering work (bug fixes, refactoring, incremental features on existing codebases). Engineers are forced into a process that doesn't match their problem.

### 1.1 — Add Pipeline Presets (High Impact) ✅ DONE
- [x] **`swarm fix "bug description"`** — Skip analyst/architect/lead. Spawn engineer with bug context → run tests → fix loop. This is the #1 missing workflow.
- [x] **`swarm refactor "what to change"`** — Analyst (scope analysis) → Engineer (refactor) → Tester. Skip architect/lead.
- [x] **`swarm spike "question"`** — Single engineer agent, no artifacts, no pipeline. Just explore and report back. Cheapest mode.
- [x] **`swarm review`** — Read current git diff or PR, produce code review. No pipeline stages.
- [x] **`swarm simplify`** — Like Claude Code's `/simplify`. Scans recent changes (staged + unstaged), reviews for code reuse, quality, efficiency, duplication, and over-engineering. Spawns a single analyst agent that reads the diff, identifies issues, then hands off to an engineer agent that applies fixes. No pipeline stages — just scan → report → fix.
  - [x] Detect changed files via `git diff HEAD` + `git diff --cached`
  - [x] Analyst agent reviews changes for: dead code, unnecessary abstractions, duplicated logic, inconsistent patterns, over-engineered solutions, missing reuse of existing utilities
  - [ ] Produces structured `SIMPLIFY-REPORT.md`: findings list with severity, file, line range, suggestion
  - [x] Engineer agent auto-applies fixes for high-confidence items (reuse existing helpers, remove dead code, flatten unnecessary abstractions)
  - [ ] Low-confidence items presented to user for approval before applying
  - [x] `--dry-run` flag: report only, no changes
  - [x] `--scope <path>` flag: limit to specific directory/file
  - [x] Default model: haiku (cheap — this is a fast feedback loop, not a deep analysis)
  - [x] Integrates with fix loop: if simplification breaks tests, auto-revert that specific change
- [x] Register presets in `src/commands/` as first-class commands, not YAML config
- [x] Each preset defines: which stages to run, what artifacts to expect, default model, default budget
- [x] **Dashboard integration** — All 5 presets available as quick-action buttons in LaunchView + WsCommand handlers in ws-server

### 1.2 — Backward Context Flow (Medium Impact) ✅ DONE
- [x] When a stage fails, failure reason is recorded in `stageFailureContext` map
- [x] Downstream stages receive failure context via `backwardContext` prepended to prompts
- [x] Architect and Plan stages receive "Prior Failure Context" section with all recorded failures
- [x] `runStageWithRetry` records failure messages for backward flow on each attempt
- [x] `--from <stage>` already exists in mayday

### 1.3 — Existing Codebase Awareness (High Impact) ✅ DONE
- [x] Before pipeline starts, run a codebase scan: file tree, package.json/go.mod/requirements.txt, key patterns, existing tests, git info
- [x] Feed scan results as context to ALL stages (analyst, architect, plan, build)
- [x] Analyst prompt prepended: "This is an EXISTING project. Do NOT start from scratch. Extend the current codebase." + scan
- [x] Architect prompt prepended: "Do NOT redesign existing architecture. Extend it." + scan
- [x] Plan prompt prepended: "Reference existing files when assigning task file paths." + scan
- [x] Created `codebase-scanner.ts` — scans package info, file tree (2 levels), test files, git branch + recent commits
- [x] Cached per pipeline run (scanned once, reused across stages)

### 1.4 — Custom Pipeline Definitions (Low Impact, Nice-to-Have) ✅ ALREADY EXISTS
- [x] `.swarm/pipeline.yaml` — already loaded by `pipeline-loader.ts`
- [x] Custom stage sequences with `dependsOn`, `condition`, `parallel` fields
- [x] `runCustomPipeline()` executes custom definitions with dependency resolution
- [x] Validates duplicate names, unknown personas, circular dependencies
- [x] Conditions support `file-exists:FILENAME` for conditional skipping

---

## Workstream 2: Smarter Autonomy — Fix the Fix Loop

**Problem:** MayDay aborts after 3 stuck iterations with no escalation. 30-minute timeouts kill long tasks. Budget exhaustion is catastrophic. The "autonomous" mode gives up too easily.

### 2.1 — Strategy Escalation (High Impact) ✅ DONE
- [x] After 2 stuck iterations with same failures, escalate strategy before aborting:
  - **Strategy 1 (default):** Fix the failing code
  - **Strategy 2 (broader-context, stuckCount≥2):** Read more codebase, trace data flow, check imports
  - **Strategy 3 (rewrite, stuckCount≥3):** Comprehensive rewrite of failing components from scratch
  - **Strategy 4 (simplify, stuckCount≥4):** Reduce scope, stub features, get tests passing minimally
- [x] Track which strategy was used per iteration in fix history (approach field)
- [x] Only abort after ALL strategies exhausted (stuckCount≥5, not 3)
- [x] Strategy-specific prompt instructions in buildFixPrompt()
- [ ] Add `--max-strategies` flag (default: 4)

### 2.2 — Graceful Degradation on Budget (Medium Impact) ✅ DONE
- [x] When 80% of budget consumed, downgrade opus → sonnet automatically
- [x] When 90% consumed, switch ALL agents to haiku
- [x] CostTracker emits `budget-warning` events at 80% and 90% thresholds
- [x] Pipeline listens and modifies `config.model` + `config.models` dynamically
- [x] Added `getRemaining()` and `getUsageRatio()` to CostTracker
- [ ] When 100% hit, save state cleanly (not kill all agents immediately)
- [ ] `swarm mayday --resume` picks up from exact pause point with new budget

### 2.3 — Adaptive Timeouts (Medium Impact) ✅ DONE
- [x] Reduced default inactivity timeout from 30 min to 10 min (faster failure detection)
- [x] Bash tool_use events extend watchdog to 60 min (covers long test suites/builds)
- [x] Added `resetWatchdogExtended(durationMs)` method to AgentProcess
- [x] Every stdout/stderr output still resets to base timeout (existing behavior)
- [ ] Separate timeouts for "stuck in a loop" (output but no progress)

### 2.4 — Session Persistence Beyond 24 Hours (Low Impact)
- [ ] Save full agent context to disk (not just session ID)
- [ ] Resume uses context replay instead of Claude session resume
- [ ] Removes the 24-hour session expiry limitation
- [ ] Trade-off: higher token cost on resume (replaying context)

### 2.5 — Partial Results on Failure (High Impact) ✅ DONE
- [x] When MayDay aborts, produce a `FAILURE-REPORT.md` with:
  - [x] What was attempted (stage-by-stage summary)
  - [x] What succeeded (artifacts produced, tests that pass)
  - [x] What failed (exact errors, test failures, stuck iterations)
  - [x] Suggested manual next steps (context-aware: stuck vs budget vs max iterations)
- [x] Save all produced artifacts even on failure (don't discard partial work)
- [x] FAILURE-REPORT.md generated on: pipeline error catch, fix budget exhausted, stuck detection, max iterations reached
- [ ] `swarm status --verbose` shows the failure report inline

---

## Workstream 3: Parallel Engineering — Stop Being Sequential

**Problem:** Build stage runs one engineer agent per task group sequentially. 10 independent tasks take 10x longer than necessary.

### 3.1 — First-Class Parallel Task Execution (High Impact) — ALREADY EXISTS
_Investigation revealed parallel execution already works:_
- [x] Parse TASKS.md `[P]` markers into parallel execution groups (`parseSpecKitTasks()`)
- [x] Spawn N engineer agents simultaneously via `Promise.all()` within batches
- [x] Wait for all via `Promise.allSettled()` before next batch
- [x] Default: max 3 parallel agents (configurable via `--parallel N`)
- [x] Orchestrator + sub-engineer pattern with phase reports
- [ ] Each agent gets its own git worktree for true isolation (stretch goal)
- [ ] Dashboard shows parallel agents side-by-side with individual progress

### 3.2 — Parallel Test Execution (Medium Impact) ✅ DONE
- [x] When stack has multiple frameworks (e.g., React: Vitest + Playwright), spawn one agent per framework via `Promise.all()`
- [x] Wait for all via `Promise.allSettled()` before proceeding
- [x] Single-framework stacks use original sequential behavior
- [x] Cost tracked across all parallel runners

---

## Workstream 4: Output & Observability — Stop Flying Blind

**Problem:** 50KB output cap loses context. 2KB in state is useless. No per-stage cost breakdown. No cost alerts.

### 4.1 — Increase Output Caps (High Impact, Easy) ✅ DONE
- [x] Raise in-memory output buffer from 50KB to 500KB
- [x] Raise state.json output cap from 2KB to 20KB
- [x] Raise activity cap from 200 to 1000 per agent
- [ ] Add `--verbose-output` flag for unlimited (at cost of memory)
- [ ] Dashboard: lazy-load older activities from JSONL logs on scroll

### 4.2 — Per-Stage Cost Tracking (Medium Impact) ✅ DONE
- [x] Track cost per stage via `stageCost` field in StageState (delta from totalCost)
- [x] Dashboard shows per-stage cost next to elapsed time in pipeline stepper
- [x] Persisted in state.json per stage for history
- [x] CI mode (`--json`) outputs per-stage costs
- [ ] Results view shows cost breakdown chart
- [ ] History view compares cost efficiency across runs

### 4.3 — Real-Time Cost Alerts (Medium Impact) ✅ DONE (via budget degradation)
- [x] CostTracker emits `budget-warning` at 80% and 90% of budget
- [x] At 80%: auto-downgrade from opus → sonnet
- [x] At 90%: auto-downgrade all agents to haiku
- [x] Pipeline logs budget warnings to console
- [ ] Dashboard shows amber/red cost indicator with trend
- [ ] Browser notification for budget alerts

### 4.4 — Searchable Full Logs in Dashboard (Low Impact)
- [ ] Dashboard can request full JSONL logs for any agent (not just 50KB buffer)
- [ ] Add `get-full-logs` WebSocket command
- [ ] Paginated log viewer with search across all agents
- [ ] Export full logs as single file

---

## Workstream 5: Guardrails That Actually Gate

**Problem:** Guardrail violations are warnings that don't block. Bad artifacts flow downstream and compound errors.

### 5.1 — Blocking Guardrails (High Impact, Easy) ✅ DONE
- [x] Add `severity: error | warning` to guardrail rules (already existed in types)
- [x] `error` severity violations block pipeline progression (throws in finishStage → triggers runStageWithRetry)
- [x] On block: re-run the stage with violation feedback appended to prompt (via retry mechanism)
- [x] Max 2 guardrail retries before escalating to user (existing runStageWithRetry maxAttempts=2)
- [x] Default rules: section-exists = error, word-count = warning, pattern-match = error (existing defaults)
- [x] Added `evaluateArtifact()` method to GuardrailsEngine for per-artifact evaluation
- [x] Violations persisted to state for dashboard visibility

### 5.2 — LLM-Powered Quality Gate (Medium Impact) ✅ DONE
- [x] After each stage, optionally run haiku to evaluate artifact quality (enabled via `llmQualityGate: true` in config)
- [x] Uses existing `scoreLLM()` method in QualityScorer (haiku, ~$0.01/artifact, 60s timeout)
- [x] Blended scoring: 40% heuristic + 60% LLM for final score
- [x] Block if blended score < threshold (configurable via `llmQualityThreshold`, default 60/100)
- [x] Catches semantic problems that regex guardrails miss
- [x] Non-critical: LLM eval failures fall back to heuristic only

---

## Workstream 6: Real-World Integration

**Problem:** Swarm exists in isolation. No IDE, no CI/CD, no ticket tracker, no PR workflow integration.

### 6.1 — `swarm review` Command (High Impact) ✅ DONE (implemented in 1.1)
- [x] `swarm review` — review staged changes or current branch diff
- [x] `swarm review --pr 123` — review a GitHub PR (uses `gh` CLI)
- [x] Spawns engineer agent with code review prompt
- [x] Produces structured review: summary, concerns, suggestions, approval recommendation
- [x] Posts review as PR comment if `--post` flag used

### 6.2 — `swarm fix --issue 456` (High Impact) ✅ DONE
- [x] Reads issue from GitHub (`gh issue view 456 --json title,body,labels,comments`)
- [x] Feeds issue title + body + last 5 comments + labels as context
- [x] Skips requirements/architect stages — goes straight to engineer
- [x] Dashboard support: typing `#123` in fix preset auto-detects as issue number
- [x] WS handler supports `issue` field in `run-fix` command
- [ ] After fix, creates PR linked to issue (future: auto-link via `gh pr create --body "Fixes #456"`)

### 6.3 — CI Pipeline Mode (Medium Impact) ✅ DONE
- [x] `swarm ci` — headless mode designed for CI/CD
- [x] JSON output to stdout via `--json` flag
- [x] Exit code reflects pipeline outcome (0 = pass, 1 = test failures, 2 = error/timeout)
- [x] Supports `--timeout` for CI job limits (default 30 min)
- [x] Supports `--lean`, `--from`, `--budget`, `--parallel` flags
- [x] Git disabled by default in CI mode
- [ ] GitHub Action updated to use `swarm ci` instead of full pipeline

### 6.4 — Monorepo Support (Medium Impact) ✅ DONE
- [x] `SwarmConfig.packages` field: `packages: ["packages/api", "packages/web"]`
- [x] Codebase scanner scans per-package deps and injects "Only modify code within these packages" guidance
- [x] All stage prompts receive monorepo context via codebase scanner
- [ ] Parallel pipelines across packages (reuse multi-pipeline infrastructure — stretch goal)

---

## Workstream 7: Cost Efficiency — Make It Affordable

**Problem:** $20-80 per feature is too expensive for regular use. Most of that cost is in verbose analyst/architect stages that produce docs nobody reads.

### 7.1 — Lean Mode (High Impact) ✅ DONE
- [x] `swarm mayday --lean "feature"` — uses haiku for analyst/architect/lead/tester, keeps engineer on default model
- [x] Estimated cost: $3-8 instead of $20-50
- [x] Dashboard: lean mode toggle button in LaunchView with dynamic cost estimate
- [x] WsCommand + ws-server support for lean mode via dashboard
- [ ] Lean mode produces shorter artifacts (500-word cap on requirements, 300-word cap on spec)
- [ ] Default for `swarm fix` and `swarm spike`

### 7.2 — Smart Model Selection (Medium Impact) ✅ DONE
- [x] `swarm mayday --smart` — sonnet for docs stages, opus for engineer (best quality/cost balance)
- [x] `swarm fix` and `swarm spike` already default to haiku (cheap) and config model respectively
- [x] Budget degradation auto-downgrades models at 80%/90% thresholds (see 2.2)
- [x] User can override with `--model opus` for all stages
- [ ] Auto-detect complexity from prompt (would require LLM pre-assessment call)

### 7.3 — Caching (Low Impact)
- [ ] Cache analyst/architect output for similar prompts
- [ ] If REQUIREMENTS.md exists and prompt is similar to previous run, skip analyst stage
- [ ] Hash-based cache key: prompt + codebase scan fingerprint
- [ ] `--no-cache` to force fresh run

---

## Workstream 8: Developer Experience Polish

### 8.1 — Better Error Messages (Medium Impact)
- [ ] Every error includes: what happened, why, and what to do next
- [ ] `swarm doctor` checks: claude CLI version, authentication, disk space, stale worktrees, orphaned processes
- [ ] Common failure patterns get specific guidance (e.g., "Agent timed out" → "Your test suite may be slow. Try --timeout 60m")

### 8.2 — Progress Indicators (Medium Impact)
- [ ] CLI shows real-time progress: `[2/5] Architect ████████░░ 65% — writing ADRs...`
- [ ] Dashboard shows stage progress estimate based on historical data
- [ ] ETA for pipeline completion

### 8.3 — Configuration Profiles (Low Impact)
- [ ] `swarm config create fast --model haiku --budget 3 --lean`
- [ ] `swarm config create thorough --model opus --budget 50 --parallel 5`
- [ ] `swarm mayday --profile fast "fix the login bug"`
- [ ] Profiles stored in `.swarm/profiles/`

---

## Implementation Priority

### Phase A — Quick Wins (1-2 weeks each, highest ROI) ✅ ALL DONE
1. ~~**1.1** Pipeline presets (`fix`, `spike`, `review`, `simplify`) — unlocks 4 new workflows~~ ✅ DONE
2. ~~**4.1** Increase output caps — 30 min fix, huge debugging improvement~~ ✅ DONE
3. ~~**5.1** Blocking guardrails — prevents cascading bad artifacts~~ ✅ DONE
4. ~~**2.5** Partial results on failure — stops losing work on abort~~ ✅ DONE
5. ~~**7.1** Lean mode — makes daily use affordable~~ ✅ DONE

### Phase B — Core Architecture (2-4 weeks each) ✅ ALL DONE
6. ~~**1.3** Existing codebase awareness — makes Swarm usable on real projects~~ ✅ DONE
7. ~~**2.1** Strategy escalation in fix loop — doubles autonomy~~ ✅ DONE
8. ~~**3.1** Parallel task execution — already existed (discovered during implementation)~~ ✅ ALREADY EXISTS
9. ~~**6.1** `swarm review` command — highest-demand integration~~ ✅ DONE (in 1.1)
10. ~~**6.2** `swarm fix --issue` — GitHub integration~~ ✅ DONE

### Phase C — Polish & Scale (2-4 weeks each) ✅ ALL DONE
11. ~~**4.2** Per-stage cost tracking~~ ✅ DONE
12. ~~**2.2** Graceful budget degradation~~ ✅ DONE
13. ~~**2.3** Adaptive timeouts~~ ✅ DONE
14. ~~**6.3** CI pipeline mode~~ ✅ DONE
15. ~~**7.2** Smart model selection~~ ✅ DONE

### Phase D — Advanced (4+ weeks each) ✅ ALL DONE
16. ~~**1.2** Backward context flow~~ ✅ DONE
17. ~~**3.2** Parallel test execution~~ ✅ DONE
18. ~~**6.4** Monorepo support~~ ✅ DONE
19. ~~**1.4** Custom pipeline definitions~~ ✅ ALREADY EXISTS
20. ~~**5.2** LLM-powered quality gate~~ ✅ DONE

---

## Success Metrics

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| Workflows supported | 1 (greenfield) | 6+ (fix, refactor, review, spike, simplify, greenfield) | Count of pipeline presets |
| Fix loop success rate | ~40% (aborts often) | 70%+ | Track MayDay completions vs aborts |
| Average cost per feature | $20-50 | $5-15 (lean mode) | Cost tracking in history |
| Time to first value | ~15 min (full pipeline) | ~3 min (`swarm fix`) | Measure from command to first useful output |
| Parallel speedup | 1x (sequential) | 3x (parallel tasks) | Compare build stage duration |
| Output visibility | 50KB/2KB caps | Full logs searchable | Dashboard log coverage |

---

## What NOT to Build

- **IDE plugin beyond basic commands** — Claude Code itself is the IDE integration. Don't compete.
- **Custom LLM provider support** — Swarm is built for Claude. Don't abstract it.
- **Team collaboration features** — This is a single-developer tool. Keep it that way.
- **Hosted/SaaS version** — Complexity explosion. Stay CLI-first.
- **Visual pipeline builder UI** — YAML config is sufficient. Don't over-invest in dashboard.
