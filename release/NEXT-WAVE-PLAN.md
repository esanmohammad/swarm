# Swarm — Next Wave Feature Plan

> 10 high-impact features sorted by real-world engineering value.
> Each feature is independent. Implement in order for maximum cumulative impact.

---

## Priority 1: `swarm learn` — Project Convention Extraction

**Impact: 10/10** — Solves the #1 complaint with AI-generated code: it doesn't match your project's style.

### Problem
Every pipeline run starts with zero knowledge of your project's conventions. Agents write generic code — wrong naming, wrong patterns, wrong test structure. Engineers spend more time fixing style than fixing logic.

### Solution
Scan the codebase once and extract a machine-readable conventions file (`.swarm/conventions.md`). Feed it to ALL agents as system context.

### Tasks
- [ ] Create `src/core/convention-extractor.ts` — analyzes codebase patterns
  - [ ] **Naming conventions**: camelCase vs snake_case, file naming (kebab-case dirs, PascalCase components)
  - [ ] **Import patterns**: relative vs absolute, barrel exports, import order
  - [ ] **Component structure**: functional vs class, hooks patterns, prop types approach
  - [ ] **Test patterns**: file location (co-located vs `__tests__/`), naming (`*.test.ts` vs `*.spec.ts`), assertion style
  - [ ] **Error handling**: try/catch patterns, error classes, Result types
  - [ ] **State management**: Redux, Zustand, Context, signals — detect what's used
  - [ ] **API patterns**: REST structure, middleware patterns, response formats
  - [ ] **Directory structure**: feature-based vs layer-based, barrel files
- [ ] Create `swarm learn` CLI command
  - [ ] Spawns a haiku agent with read-only access to scan the codebase
  - [ ] Agent produces structured `.swarm/conventions.md` with extracted patterns
  - [ ] `--refresh` flag to re-scan after codebase changes
  - [ ] `--merge` flag to update existing conventions without overwriting manual edits
- [ ] Inject conventions into all pipeline stages
  - [ ] Append conventions to system prompt for analyst, architect, lead, engineer, tester
  - [ ] Engineer prompt: "Follow these project conventions EXACTLY"
  - [ ] Tester prompt: "Tests must follow the project's testing patterns"
- [ ] Dashboard: show conventions in a "Project" tab, allow manual editing
- [ ] Auto-detect staleness: if `.swarm/conventions.md` is older than 7 days, suggest re-running `swarm learn`

### Cost estimate
- Initial scan: ~$0.10 (haiku, read-only)
- Per-pipeline overhead: ~0 (conventions injected as text, no extra agent)

---

## Priority 2: Context Memory Across Runs

**Impact: 9/10** — Currently each run starts from zero. Cross-run memory makes the fix loop dramatically smarter and prevents repeating mistakes.

### Problem
If a pipeline fails because approach X doesn't work, the next run tries approach X again. If a test is flaky, every run wastes iterations on it. There's no learning across runs.

### Solution
Persistent memory store (`.swarm/memory/`) that records what worked, what failed, and project-specific knowledge. Fed to agents as context.

### Tasks
- [ ] Create `src/core/memory-store.ts` — persistent cross-run memory
  - [ ] **Fix patterns**: "When tests in `auth/` fail, the issue is usually missing env vars"
  - [ ] **Flaky tests**: track tests that intermittently fail — skip or retry them
  - [ ] **Approach history**: "Approach X was tried for Y and failed because Z"
  - [ ] **Agent performance**: which models perform best for which stages in this project
  - [ ] Memory entries have TTL (default 30 days) and confidence scores
- [ ] Auto-record memories after each pipeline run
  - [ ] On success: record what approach worked, which stages were fast/slow
  - [ ] On failure: record failure reason, which approaches were tried, what was stuck
  - [ ] On fix loop: record per-test fix patterns for future reference
- [ ] Feed relevant memories to agents
  - [ ] Before fix loop: "Previous runs found that {memory}. Try a different approach."
  - [ ] Before build: "In previous runs, {file} was a source of bugs. Be extra careful."
  - [ ] Before test: "Tests {X, Y} are known to be flaky — retry once before reporting failure."
- [ ] `swarm memory list` — show all stored memories
- [ ] `swarm memory clear` — reset memory (fresh start)
- [ ] `swarm memory add "note"` — manually add a memory
- [ ] Dashboard: memory panel showing active memories and their sources

### Storage
- `.swarm/memory/patterns.jsonl` — one memory entry per line
- Git-ignored by default (project-local knowledge)
- Max 1MB — auto-prune oldest low-confidence entries

---

## Priority 3: PR Review Agent (Autonomous)

**Impact: 9/10** — Teams would adopt this immediately. Automated code review that actually understands the codebase.

### Problem
Code reviews are bottlenecks. Reviewers skim large PRs. Obvious bugs slip through. Style violations require multiple round-trips.

### Solution
`swarm babysit-prs` — a background daemon that watches PRs and provides automated review with project-aware context.

### Tasks
- [ ] Create `src/commands/babysit-prs.ts` — background PR watcher
  - [ ] Poll `gh pr list --json` every N minutes (configurable, default 5)
  - [ ] For each new/updated PR:
    - [ ] Fetch diff via `gh pr diff`
    - [ ] Load project conventions (from `swarm learn`)
    - [ ] Spawn review agent with conventions + codebase context
    - [ ] Post structured review comment via `gh pr comment`
  - [ ] Track reviewed PRs to avoid duplicate reviews
  - [ ] `--auto-approve` flag: approve PRs that pass all checks
  - [ ] `--label <label>` flag: only review PRs with specific label
- [ ] Review quality
  - [ ] Check against project conventions (naming, patterns, structure)
  - [ ] Detect common bugs (null checks, race conditions, SQL injection)
  - [ ] Flag test coverage gaps
  - [ ] Suggest performance improvements
  - [ ] Grade: APPROVE / REQUEST_CHANGES / COMMENT
- [ ] `swarm babysit-prs stop` — stop the daemon
- [ ] `swarm babysit-prs status` — show active reviews and stats
- [ ] Dashboard: "PR Reviews" tab showing review history, approval rate, common issues
- [ ] Webhook integration: trigger review on PR open via GitHub webhook

### Cost estimate
- Per PR review: $0.50–1.50 (sonnet, read-only)
- Background polling: free (gh CLI, no API cost)

---

## Priority 4: `swarm watch` — Continuous Integration Agent

**Impact: 8/10** — CI that runs on your laptop. Instant feedback without pushing to GitHub.

### Problem
Developers push code, wait for CI, see failures, fix, push again. The feedback loop is 5-15 minutes. Local test runs are incomplete.

### Solution
A file watcher that detects changes and automatically runs relevant tests, fixes failures, and optionally commits.

### Tasks
- [ ] Create `src/commands/watch.ts` — file watcher daemon
  - [ ] Watch project directory using `fs.watch` (recursive)
  - [ ] On file change: determine affected test suites
  - [ ] Run only affected tests (not full suite)
  - [ ] If tests fail: spawn fix agent → re-run → commit if passing
  - [ ] Debounce: 2-second quiet period before triggering
  - [ ] `--test-only` flag: run tests but don't auto-fix
  - [ ] `--commit` flag: auto-commit passing fixes
  - [ ] `--scope <path>` flag: watch specific directory only
- [ ] Smart test selection
  - [ ] Map source files → test files via naming conventions and import analysis
  - [ ] Track test results to prioritize flaky tests for re-run
  - [ ] Skip unchanged test files
- [ ] Dashboard: "Watch" panel showing live file changes, test runs, auto-fixes
- [ ] `swarm watch stop` — stop the daemon
- [ ] Integration with `swarm learn` conventions for test mapping

### Cost estimate
- Per auto-fix: $0.50–2.00 (depends on fix complexity)
- Test-only mode: $0 (runs local tests, no agent cost)

---

## Priority 5: `swarm explain` — Codebase Onboarding

**Impact: 8/10** — Dramatically reduces onboarding time. New team members understand codebases in minutes instead of weeks.

### Problem
New engineers spend days/weeks understanding a codebase. Documentation is outdated. Architecture decisions are tribal knowledge.

### Solution
Interactive codebase explanation that generates architecture overviews, data flow diagrams, and answers questions about any part of the code.

### Tasks
- [ ] Create `src/commands/explain.ts` — codebase explanation tool
  - [ ] `swarm explain` — full project overview (architecture, key patterns, entry points)
  - [ ] `swarm explain src/auth/` — explain a specific directory
  - [ ] `swarm explain src/api/routes.ts` — explain a specific file
  - [ ] `swarm explain "how does authentication work?"` — answer a question about the codebase
  - [ ] `--diagram` flag: generate Mermaid diagrams
  - [ ] `--depth shallow|medium|deep` — control explanation detail level
- [ ] Output formats
  - [ ] Terminal: formatted markdown output
  - [ ] `--output ONBOARDING.md` flag: save to file
  - [ ] `--json` flag: structured JSON output
- [ ] Smart context gathering
  - [ ] Use codebase scanner for project structure
  - [ ] Read relevant files based on query
  - [ ] Include git blame for "who owns this" context
  - [ ] Reference existing docs (README, CLAUDE.md, etc.)
- [ ] Dashboard: "Explain" tab with interactive Q&A interface
- [ ] Cache explanations to avoid re-scanning unchanged code

### Cost estimate
- Full project overview: $0.50–2.00 (sonnet)
- Single file/dir explanation: $0.10–0.50 (haiku)
- Q&A query: $0.05–0.20 (haiku)

---

## Priority 6: Multi-Agent Collaboration

**Impact: 7/10** — Breaks the sequential bottleneck. Agents can ask each other questions instead of operating in isolation.

### Problem
Currently agents are isolated. The architect can't ask the analyst to clarify a requirement. The engineer can't tell the lead that a task is impossible. Information flows only forward through artifacts.

### Solution
Allow agents to send messages to each other during execution. Create a message bus that routes inter-agent communication.

### Tasks
- [ ] Create `src/core/agent-bus.ts` — inter-agent message bus
  - [ ] `sendTo(targetAgentId, message)` — send a message to another running agent
  - [ ] `broadcast(message)` — send to all running agents
  - [ ] Message types: `question`, `clarification`, `blocker`, `status-update`
  - [ ] Queue messages if target agent is busy (deliver when idle)
- [ ] Modify `AgentProcess` to support injected messages
  - [ ] On receiving a message: append to agent's prompt via `--resume`
  - [ ] Include sender identity: "The architect asks: ..."
  - [ ] Limit message frequency to avoid conversation loops (max 3 exchanges per pair)
- [ ] Enable in pipeline
  - [ ] Engineer → Lead: "Task T005 is impossible because X — please restructure"
  - [ ] Tester → Engineer: "Test TC-003 needs a mock for external API — please add"
  - [ ] Architect → Analyst: "Requirement 3.2 is ambiguous — clarify scope"
- [ ] Dashboard: show inter-agent messages in activity log
- [ ] Guardrails: agents can only message peers, not override role boundaries

---

## Priority 7: Cost Intelligence Dashboard

**Impact: 7/10** — Makes the business case visible. Teams need to justify AI spend.

### Problem
Teams can't answer: "Is Swarm worth it?" No data on cost trends, ROI, or where money is wasted.

### Solution
Analytics dashboard that tracks spending, identifies patterns, and helps optimize model selection.

### Tasks
- [ ] Extend history storage with detailed cost breakdowns
  - [ ] Per-stage cost, per-agent cost, per-model cost
  - [ ] Track time saved (estimated LOC generated × average dev time per LOC)
  - [ ] Feature complexity classification (simple/medium/complex)
- [ ] Create analytics views in dashboard
  - [ ] **Spend over time**: daily/weekly/monthly cost chart
  - [ ] **Cost per feature**: bar chart comparing pipeline runs
  - [ ] **Stage efficiency**: which stages cost the most, which take the longest
  - [ ] **Model comparison**: opus vs sonnet vs haiku success rates and costs
  - [ ] **ROI estimate**: cost vs estimated development hours saved
- [ ] `swarm stats` CLI command — print cost summary
  - [ ] Total spend this week/month
  - [ ] Average cost per pipeline
  - [ ] Success rate (passed vs failed pipelines)
  - [ ] Most expensive stages
- [ ] Recommendations engine
  - [ ] "Your architect stage costs 40% of total — consider using sonnet instead of opus"
  - [ ] "Fix loop used 3 iterations on average — consider enabling `swarm learn` to reduce retries"

---

## Priority 8: `swarm deploy` — Deployment Pipeline

**Impact: 6/10** — Extends Swarm from "code generation" to "idea to production". High value but high complexity.

### Problem
After Swarm builds and tests the code, deployment is still manual. The pipeline stops at "tests pass."

### Solution
Extend the pipeline with optional deployment stages: build artifacts → deploy staging → smoke tests → promote production.

### Tasks
- [ ] Create deployment stage definitions in `.swarm/deploy.yaml`
  ```yaml
  staging:
    build: "docker build -t app:staging ."
    deploy: "kubectl apply -f k8s/staging/"
    healthcheck: "curl -f http://staging.internal/health"
    smoketest: "npx playwright test --config=e2e/staging.config.ts"
  production:
    promote: "kubectl set image deployment/app app=app:staging"
    healthcheck: "curl -f http://prod.internal/health"
    rollback: "kubectl rollout undo deployment/app"
  ```
- [ ] Add `deploy` stage to pipeline (after test)
  - [ ] Run build command
  - [ ] Deploy to staging
  - [ ] Run healthcheck
  - [ ] Run smoke tests
  - [ ] On failure: auto-rollback + generate failure report
- [ ] `swarm deploy staging` — manual deployment trigger
- [ ] `swarm deploy production --approve` — production with approval gate
- [ ] Dashboard: deployment status panel with rollback button

---

## Priority 9: `swarm migrate` — Database Migration Agent

**Impact: 6/10** — Addresses one of the most error-prone engineering tasks. High value for backend teams.

### Problem
Database migrations are risky. Schema changes can break production. Rollback plans are often missing. Migration scripts have subtle bugs.

### Solution
A specialized pipeline for database migrations: analyze current schema → design migration → generate files → test with rollback.

### Tasks
- [ ] Create `src/commands/migrate.ts` — migration workflow
  - [ ] `swarm migrate "add user preferences table"` — generate migration
  - [ ] Detect ORM (Prisma, TypeORM, Knex, Django, SQLAlchemy, goose)
  - [ ] Analyze current schema from migration history
  - [ ] Generate migration file in correct ORM format
  - [ ] Generate rollback/down migration
  - [ ] Run migration against test database
  - [ ] Verify rollback works (apply → rollback → re-apply)
- [ ] Safety checks
  - [ ] Flag destructive operations (DROP TABLE, DROP COLUMN)
  - [ ] Check for data loss risk
  - [ ] Estimate migration duration for large tables
  - [ ] Validate foreign key constraints
- [ ] `--dry-run` flag: generate migration without applying
- [ ] `--review` flag: show migration plan for human approval before generating

---

## Priority 10: Team Mode — Shared Pipeline Server

**Impact: 5/10** — Unlocks organizational adoption. Currently Swarm is single-user. Teams need shared infrastructure.

### Problem
Each developer runs their own Swarm instance. No shared budget, no queue, no team-wide conventions.

### Solution
Run Swarm as a shared server with job queue, team budget management, and shared configuration.

### Tasks
- [ ] Create `swarm server` — persistent server mode
  - [ ] HTTP API for submitting pipeline jobs
  - [ ] Job queue with priority (high/normal/low)
  - [ ] Concurrent pipeline limit (configurable)
  - [ ] Team budget with per-user allocation
- [ ] Authentication
  - [ ] API key per user
  - [ ] Role-based access (admin, developer, viewer)
  - [ ] Audit log of all actions
- [ ] Shared configuration
  - [ ] Team conventions (from `swarm learn`) applied to all runs
  - [ ] Shared memory store across all team pipelines
  - [ ] Standard model/budget defaults per team
- [ ] Dashboard: multi-user view with job queue, team spend, user activity
- [ ] `swarm submit "feature"` — submit job to team server
- [ ] `swarm jobs list` — show queue
- [ ] Slack/Teams integration: submit jobs and receive notifications

---

## Implementation Order Summary

| Priority | Feature | Impact | Effort | Dependencies |
|----------|---------|--------|--------|-------------|
| 1 | `swarm learn` — Conventions | 10/10 | 1 week | None |
| 2 | Context Memory | 9/10 | 1-2 weeks | None |
| 3 | PR Review Agent | 9/10 | 1-2 weeks | `swarm learn` (optional) |
| 4 | `swarm watch` — CI Agent | 8/10 | 2 weeks | None |
| 5 | `swarm explain` — Onboarding | 8/10 | 1 week | Codebase scanner |
| 6 | Multi-Agent Collaboration | 7/10 | 3-4 weeks | Agent bus architecture |
| 7 | Cost Intelligence | 7/10 | 1-2 weeks | History storage |
| 8 | `swarm deploy` | 6/10 | 2-3 weeks | Custom pipeline defs |
| 9 | `swarm migrate` | 6/10 | 2 weeks | None |
| 10 | Team Mode | 5/10 | 4-6 weeks | Server architecture |

**Start with 1-3**: they're independent, high-impact, and each takes ~1 week. Together they transform Swarm from "generic AI code generator" into "AI engineer that knows your project."
