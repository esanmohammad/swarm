# Swarm Resilience & Autonomy Analysis

> Deep analysis of testing, resilience, and real-world readiness.
> Generated from code review of all core modules.

---

## 1. Testing Phase Analysis

### 1.1 How the Test Stage Works

The test stage (`pipeline.ts`) operates in two phases:

**Phase 1 — Test Plan Generation**: A `tester` persona agent reads REQUIREMENTS.md, SPEC.md, and TASKS.md and produces `TESTPLAN.md`. This agent is constrained: it cannot write code (NON_ENGINEER_DISALLOWED_TOOLS blocks Bash, Edit, NotebookEdit).

**Phase 2 — Test Implementation and Execution**: An `engineer` persona agent reads TESTPLAN.md and implements Playwright spec files, then runs `npx playwright test`.

### 1.2 Test Types Generated

**E2E only.** The entire testing persona is scoped to Playwright E2E tests. No unit tests, no integration tests, no API contract tests.

Missing:
- No unit test generation
- No integration test stage
- No snapshot/visual regression testing infrastructure
- No API contract testing

### 1.3 How the Fix-Retest Loop Works

The fix loop (`maydayFixLoop()`):
1. `evaluateTestResults()` parses agent output with regex (`N passed` / `N failed`)
2. If failed, spawns a fix-engineer with last 3000 chars of test output
3. Fix engineer reads failing tests, reads app code, fixes bugs, runs tests
4. Re-runs the full test stage
5. Repeats up to `maxFixIterations` (default 5)

**Problems:**
- Does not parse individual test failures into separate fix tasks
- Does not provide stack traces or specific file references
- Cannot distinguish test infrastructure failures vs actual bugs
- Does not track which failures were fixed vs new regressions
- Does not correlate failures to specific tasks/files from TASKS.md
- Truncates test output to 3000 chars — loses critical information

### 1.4 What's Missing

| Gap | Impact |
|-----|--------|
| No unit test generation | Most real projects need unit tests as primary safety net |
| No flaky test handling | Fix loop wastes iterations on flaky tests |
| No coverage tracking | No way to know if tests exercise the built code |
| No structured test results | Regex parsing of raw output is unreliable |
| No pre-build baseline | Cannot distinguish pre-existing failures from new ones |
| No test isolation | One broken test setup cascades and fails entire suite |

---

## 2. Resilience Analysis

### 2.1 Agent Crash Mid-Task

**Partially handled.** If the process exits with non-zero code and `result` event never fired, the agent is marked `error`. In `runBuild()`, `Promise.allSettled()` catches individual sub-engineer failures and continues.

**Not handled:** If the `claude` CLI process hangs indefinitely (no exit, no output), there is no timeout. `waitForAgent()` waits forever. No watchdog timer. In MayDay mode, the entire pipeline freezes.

### 2.2 Claude Returns Garbage or Goes Off-Persona

Mitigated by:
- System prompts with hard boundaries
- `--append-system-prompt` with SYSTEM ENFORCEMENT rules
- NON_ENGINEER_DISALLOWED_TOOLS blocks dangerous tools
- Guardrails engine validates output artifacts

**Gaps:**
- No content validation — an agent could write empty REQUIREMENTS.md with right headers and pass guardrails
- If guardrails pass but content is nonsensical, the next stage proceeds and fails
- No mechanism to re-run a stage that produced low-quality output

### 2.3 Partial Failures

**Build phase:** `Promise.allSettled()` collects successes and failures. Failed tasks reported to orchestrator.

**All other stages:** Any stage failure kills the entire pipeline with no retry. MayDay catches the error, sets `active: false`, and archives. No automatic retry.

### 2.4 Infrastructure Failures

| Scenario | Current Behavior | Risk |
|----------|-----------------|------|
| Disk full | `save()` catches error, continues in memory | Work lost on crash |
| Network down | Claude CLI retries internally, eventually exits with error | No Swarm-level retry |
| OOM | `agent.output` grows unbounded per agent | 5+ parallel agents can spike memory |
| State corruption | Falls back to empty state — all run history lost | No backup, no WAL, no recovery |

### 2.5 Large Codebases (100+ files)

**Context window is the bottleneck:**
- Each engineer gets the FULL TASKS.md even though they only implement one task
- Architect reads entire REQUIREMENTS.md in prompt
- Lead reads entire SPEC.md
- No file chunking or summary strategy
- No token counting or context budget management
- Test output truncated to 3000-5000 chars — loses critical stack traces

---

## 3. Autonomy Analysis

### 3.1 End-to-End Autonomy

MayDay pipeline: single feature request → requirements → architecture → tasks → implementation → tests → fix loop → PR. Genuinely autonomous for small greenfield features.

### 3.2 Where It Gets Stuck

| Stuck Point | Cause | Impact |
|-------------|-------|--------|
| **Infinite recursion bug** | `waitForAgentWithBudgetCheck` calls itself instead of `agentManager.waitForAgent()` (pipeline.ts:87) | Stack overflow on every MayDay run |
| Ambiguous requirements | Non-interactive analyst guesses instead of clarifying | Bad guesses cascade through all stages |
| No stage retry | Single failure kills pipeline | Users must restart from scratch |
| Approval gate blocking | Polls every 500ms forever waiting for human | Pipeline thread blocked indefinitely |
| Missing test infrastructure | Playwright may need 500MB install mid-pipeline | Network/config failures kill the run |

### 3.3 Fix Loop Intelligence

The fix loop is a **blind retry with context**. It does NOT:
- Parse failures into categories (setup vs assertion vs timeout)
- Track fix history (what was tried before)
- Adjust strategy based on iteration count
- Detect infinite loops (same failure every iteration)
- Distinguish test bugs from app bugs intelligently

### 3.4 Architectural Dead-Ends

**No recovery.** If the architect designs an impossible architecture, the engineer tries to implement it and fails. The fix loop only fixes test failures, not architectural problems. No mechanism to go back to the architect stage.

---

## 4. Real-World Large Project Challenges

| Challenge | Status | Notes |
|-----------|--------|-------|
| Monorepo (50+ packages) | ❌ Not addressed | No workspace awareness, no per-package pipeline |
| Legacy codebase (no tests) | ⚠️ Partial | Assumes Playwright E2E; ignores existing test frameworks |
| Complex auth flows | ⚠️ Partial | Supports `authStorageState` but can't handle OAuth/SSO/MFA autonomously |
| Microservices | ❌ Not addressed | No multi-service build/start/test coordination |
| Database migrations | ❌ Not addressed | No migration framework integration |
| CI/CD integration | ⚠️ Minimal | Auto-creates PR but no CI config, no status checks |
| Multi-team coordination | ❌ Not addressed | No locking, no concurrent run conflict detection |
| Existing code conventions | ⚠️ Partial | Agents infer from context; no linting/prettier config passed |

---

## 5. Recommended Improvements (Prioritized)

### CRITICAL — Blocks Real-World Usage

| ID | Issue | Fix | Files |
|----|-------|-----|-------|
| C1 | `waitForAgentWithBudgetCheck` infinite recursion | Change self-call to `this.agentManager.waitForAgent(agentId)` | `pipeline.ts:87` |
| C2 | No agent timeout/watchdog | Add configurable timeout (30min default) to AgentProcess; kill on no-output | `agent-process.ts`, `agent-manager.ts` |
| C3 | No stage retry in MayDay | Wrap each stage in retry (max 2 attempts) with backoff | `pipeline.ts` |
| C4 | No unit test generation | Add unit-test sub-stage after each engineer completes | `pipeline.ts`, new prompt |
| C5 | Unstructured test result parsing | Configure Playwright JSON reporter, parse `.swarm/test-results.json` | `pipeline.ts`, test prompts |

### IMPORTANT — Significantly Impacts Quality

| ID | Issue | Fix | Files |
|----|-------|-----|-------|
| I1 | Per-failure fix targeting | Parse structured results → one fix agent per failure group | `pipeline.ts` |
| I2 | Agent output memory unbounded | Cap `agent.output` at 50KB ring buffer; full output in JSONL only | `agent-manager.ts`, `state.ts` |
| I3 | No fix loop regression detection | Track failing test names per iteration; flag "stuck" if same failures persist | `pipeline.ts` |
| I4 | Context budget for large files | Send only relevant task to sub-engineers, not full TASKS.md | `pipeline.ts` |
| I5 | No pre-build test baseline | Run existing tests before build; compare after | `pipeline.ts` |
| I6 | Guardrails content validation | Add `min-length` and `word-count` checks for key sections | `guardrails.ts` |
| I7 | No monorepo awareness | Detect workspaces on init; pass workspace map to agents; add `--scope` flag | `config.ts`, `pipeline.ts` |

### NICE-TO-HAVE — Polish

| ID | Issue | Fix |
|----|-------|-----|
| N1 | Flaky test handling | Add `retries: 2` to generated Playwright config |
| N2 | Better cost prediction | Use historical data from `.swarm/history/` for estimates |
| N3 | Incremental builds | Track changed files; only re-run affected tests |
| N4 | Dashboard test visualization | Parse test results and show pass/fail per test |
| N5 | Git recovery points | `git stash` before each fix iteration; offer revert if worse |
| N6 | Custom pipeline docs | User-facing documentation and examples for pipeline.yaml |
| N7 | Multi-browser testing | Config option for cross-browser Playwright runs |

---

## Summary

The pipeline is architecturally sound for demo-scale projects. The prompt engineering is thorough — persona boundaries, system enforcement, and guardrails represent real thought.

**The three things that will bite first with real users:**

1. **`waitForAgentWithBudgetCheck` infinite recursion (C1)** — showstopper bug that crashes every MayDay run
2. **No agent timeouts (C2)** — a single hung claude process freezes everything with no recovery
3. **Blind fix loop (C5)** — burns through 5 iterations accomplishing nothing because it cannot see the actual error

The testing phase is the weakest link. E2E only, no coverage, no flaky handling, regex-parsed results. For a real project with 50+ tests, this produces false negatives and wastes fix budget.

**Genuinely autonomous for small greenfield features. For anything touching existing code, complex infrastructure, or multi-service coordination, it needs significant hardening.**
