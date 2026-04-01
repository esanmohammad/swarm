# Swarm Testing & Resilience Implementation Plan

> Prioritized implementation plan for hardening Swarm's testing, resilience, and autonomy.
> Work through top-to-bottom after Tier 2 is stable.

---

## Phase 1 — Critical Fixes (Must Fix First)

### C1. Fix `waitForAgentWithBudgetCheck` Infinite Recursion
- **Bug**: `pipeline.ts:87` — method calls itself instead of `agentManager.waitForAgent()`
- **Fix**: Change recursive call to `this.agentManager.waitForAgent(agentId)`
- **Impact**: Stack overflow on every MayDay run

### C2. Agent Timeout / Watchdog
- Add configurable `timeout` to `AgentProcess` (default 30min)
- If no output received for N minutes, send SIGTERM then SIGKILL
- Add `--timeout <minutes>` to CLI commands
- Files: `agent-process.ts`, `agent-manager.ts`, `types.ts`

### C3. Stage Retry in MayDay
- Wrap each stage call in `executeMaydayPipeline` with retry (max 2 attempts)
- On first failure: log warning, wait 5s, retry
- On second failure: mark stage as error, offer to skip or abort
- Files: `pipeline.ts`

### C4. Structured Test Result Parsing
- Configure Playwright to output JSON: `--reporter=json --output=.swarm/test-results.json`
- Parse structured JSON for: test names, pass/fail, error messages, file locations
- Replace regex-based `evaluateTestResults()` with JSON parser
- Fall back to regex if JSON not found (backward compat)
- Files: `pipeline.ts`, test-engineer prompts

### C5. Unit Test Generation Stage
- Add `unit-test` sub-phase after each engineer completes a task
- Spawn a test-writer agent that creates unit tests for modified files
- Run unit tests before proceeding to next task
- Add `test-unit-engineer` prompt for each stack
- Files: `pipeline.ts`, new prompts, `types.ts`

---

## Phase 2 — Fix Loop Intelligence

### I1. Per-Failure Fix Targeting
- Parse structured test results into individual failure objects
- Group failures by likely root cause (same file, same component)
- Spawn one fix agent per failure group (not one for all)
- Pass specific error message, test file, and relevant source file to each
- Files: `pipeline.ts`

### I2. Fix Loop Regression Detection
- Before each fix iteration, record the set of failing test names
- After fix, compare: new failures = regression, same failures = stuck
- If same failures persist for 2+ iterations, flag as "stuck"
- On stuck: try different approach (larger context, different prompt, skip test)
- Files: `pipeline.ts`

### I3. Fix History Tracking
- Maintain a `fixHistory` array in MaydayState
- Each entry: `{ iteration, failedTests, fixedTests, newFailures, approach }`
- Include history in fix prompt so agents know what was already tried
- Files: `pipeline.ts`, `types.ts`

### I4. Pre-Build Test Baseline
- Before build stage, run existing tests (if any exist)
- Record baseline: which tests pass, which fail
- After build, compare: only fix failures that are NEW
- Files: `pipeline.ts`

---

## Phase 3 — Resilience Hardening

### R1. Agent Output Memory Cap
- Cap `agent.output` at 50KB with ring-buffer behavior (keep last 50KB)
- Full output persisted in `.swarm/logs/{agentId}.jsonl` (already exists)
- State.json only includes last 2KB per agent for display
- Files: `agent-manager.ts`, `state.ts`

### R2. Context Budget Management
- For sub-engineers: send only the specific task from TASKS.md, not the full file
- Include a project summary (file tree, key interfaces) instead of full SPEC.md
- Track approximate token count per prompt
- Add `--max-tokens-per-agent` config option
- Files: `pipeline.ts`, `types.ts`

### R3. Guardrails Content Validation
- Add `min-length` check type: ensure sections have > 50 chars
- Add `word-count` check: key sections must have meaningful content
- Add `required-patterns` check: e.g., user stories must have Given/When/Then
- Files: `guardrails.ts`

### R4. State Recovery
- Before overwriting state.json, keep one backup: `state.json.bak`
- On parse failure, try backup before falling back to empty state
- Add `swarm recover` command to restore from backup
- Files: `state.ts`, new `commands/recover.ts`

### R5. Monorepo Awareness
- On `swarm init`, detect monorepo (check `workspaces` in package.json)
- Pass workspace map to agents
- Add `--scope <package>` flag to target specific packages
- Files: `config.ts`, `pipeline.ts`, `init.ts`

---

## Phase 4 — Testing Polish

### T1. Flaky Test Handling
- Add `retries: 2` to generated Playwright config
- Mark tests that only pass on retry as "flaky" in results
- Don't count flaky tests as failures in fix loop

### T2. Coverage Tracking
- Configure coverage collection in Playwright
- Set minimum coverage thresholds (e.g., 60% for new code)
- Report coverage in pipeline summary and PR body

### T3. Incremental Test Runs
- Track which files changed between fix iterations
- Only re-run tests affected by changed files
- Use Playwright `--grep` or test file filtering

### T4. Dashboard Test Visualization
- Parse test results JSON and show pass/fail per test in dashboard
- Color-coded test list with error messages
- Link test failures to source files

### T5. Multi-Browser Testing
- Add config option for cross-browser Playwright runs
- Default to chromium only; opt-in for firefox/webkit

---

## Execution Order

| Order | Items | Est. Effort | Dependency |
|-------|-------|-------------|------------|
| 1 | C1 (recursion fix) | 5 min | None |
| 2 | C2 (agent timeout) | 2 hr | None |
| 3 | C3 (stage retry) | 1 hr | C1 |
| 4 | C4 (structured test results) | 3 hr | None |
| 5 | C5 (unit test generation) | 4 hr | C4 |
| 6 | I1-I3 (fix loop intelligence) | 4 hr | C4 |
| 7 | I4 (test baseline) | 2 hr | C4 |
| 8 | R1-R2 (memory + context) | 3 hr | None |
| 9 | R3-R5 (guardrails, state, monorepo) | 4 hr | None |
| 10 | T1-T5 (testing polish) | 4 hr | C4 |
