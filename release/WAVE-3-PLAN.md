# Swarm — Wave 3: Autonomous Employee

> Wave 2 made Swarm an "AI engineering teammate" (autopilot, test-gen, deps, incident response, security).
> Wave 3 transforms Swarm into an **autonomous employee** — it works proactively, reports its own status, learns from outcomes, negotiates scope, and integrates into the org like a real team member.
>
> The core shift: **reactive → proactive**. Swarm stops waiting for instructions and starts finding work, doing it, and reporting back.
>
> Date: 2026-04-02

---

## Design Principles

1. **Agency over automation** — An employee doesn't just execute tasks. They prioritize, negotiate, learn, and communicate. Every feature should close one of these gaps.
2. **Trust is earned incrementally** — Start with low-risk autonomous actions (filing reports, suggesting priorities). Escalate to high-risk actions (auto-merging, deploying) only after building a track record.
3. **Transparency as accountability** — Every autonomous decision is logged, explained, and reversible. The human manager can audit everything.
4. **Cost-awareness is non-negotiable** — An employee who burns budget without ROI gets fired. Swarm must self-optimize for cost/value.

---

## P1: `swarm inbox` — Self-Directed Work Queue

**Impact: 10/10** — This is the single most important feature. Without it, Swarm is a tool. With it, Swarm is an employee.

### Problem
Swarm waits for `swarm "do X"` or a labeled issue. A real employee opens their laptop, checks what needs doing, prioritizes, and starts working. Swarm needs an always-on work loop.

### Solution
A persistent daemon that aggregates work from multiple sources (GitHub issues, Slack requests, scheduled tasks, failing CI, stale PRs), triages by priority, and works through them autonomously.

### Tasks
- [x] Create `src/commands/inbox.ts` — work aggregation daemon
  - [x] **Work sources** (plugin architecture — start with 3, extensible):
    - [x] GitHub Issues: labeled `swarm` or assigned to swarm bot account
    - [x] GitHub PR reviews: PRs requesting swarm as reviewer
    - [x] Failing CI: detect failed GitHub Actions runs, auto-investigate
    - [x] Stale PRs: PRs open > N days with no activity, nudge or resolve conflicts
    - [x] Slack integration: messages mentioning `@swarm` in configured channel
    - [x] Scheduled tasks: cron-like config for recurring work (deps update weekly, health check daily)
    - [x] Manual queue: `swarm inbox add "refactor auth module"` pushes to queue
  - [x] **Triage engine** (`src/core/triage.ts`):
    - [x] Classify each work item: bug-fix, feature, maintenance, incident, review
    - [x] Priority scoring (0-100) based on:
      - [x] Source priority (incident > bug > feature > maintenance)
      - [x] Label priority (`urgent`, `critical`, `p0`)
      - [x] Age (older items get priority boost)
      - [x] Requester (configurable VIP list)
      - [x] Estimated complexity (simple = quick win = do first)
      - [x] Dependencies (blocked items deprioritized)
    - [x] Capacity planning: estimate cost + time per item, fit within daily budget
    - [x] Output: ordered work queue with justification for ordering
  - [x] **Work loop**:
    - [x] Pick highest priority item
    - [x] Assess: can I do this autonomously? (complexity < threshold, risk < threshold)
    - [x] If yes: run appropriate command (pipeline, test-gen, deps, fix, review)
    - [x] If no: create a summary + recommendation, notify human for decision
    - [x] On completion: update source (close issue, merge PR, post result)
    - [x] On failure: log, skip, notify human, move to next item
    - [x] Respect budget: stop when daily budget exhausted, resume next day
  - [x] **Confidence gating**:
    - [x] Low confidence (< 60%): research only, present findings to human
    - [x] Medium confidence (60-85%): do the work, create PR, require human review
    - [x] High confidence (> 85%): do the work, auto-merge if tests pass + risk score < 30
    - [x] Confidence thresholds configurable per work type
  - [x] `swarm inbox` — show current queue with priorities
  - [x] `swarm inbox start` — start the daemon
  - [x] `swarm inbox stop` — stop the daemon
  - [x] `swarm inbox pause` — pause processing (keep aggregating)
  - [x] `swarm inbox skip <id>` — skip a work item
  - [x] `swarm inbox prioritize <id>` — bump item to top
  - [x] `swarm inbox config` — show/edit triage rules
  - [x] Config in `.swarm/config.yaml`:
    ```yaml
    inbox:
      sources:
        github:
          labels: ["swarm", "ai-task"]
          repos: ["org/api", "org/web"]
        slack:
          channel: "#swarm-tasks"
          botToken: $SLACK_BOT_TOKEN
        schedule:
          - cron: "0 9 * * 1"  # Every Monday 9am
            task: "swarm deps update"
          - cron: "0 6 * * *"  # Daily 6am
            task: "swarm health"
      budget:
        daily: 25.00      # Max spend per day
        perItem: 15.00     # Max spend per work item
      confidence:
        autoMerge: 85      # Auto-merge threshold
        autoWork: 60       # Auto-work threshold (below = notify human)
      workHours:
        start: "06:00"     # Don't start work before this
        end: "22:00"       # Don't start new work after this
        timezone: "UTC"
    ```
- [x] Dashboard: "Inbox" as primary navigation view
  - [x] Work queue table: source, title, priority, status, confidence, estimated cost
  - [x] Drag-to-reorder for manual priority override
  - [x] Per-item: expand to see triage reasoning, linked PR, cost, outcome
  - [x] Start/stop/pause controls
  - [x] Daily budget meter
  - [x] Source configuration panel
  - [x] Filters: by source, type, status, priority

### Cost estimate
- Aggregation/polling: $0 (CLI/API calls)
- Triage: $0.05 per item (haiku classification)
- Work execution: $3-15 per item (depends on type)
- Typical daily run: $20-50 for a team backlog

---

## P2: `swarm standup` — Async Status Reporting

**Impact: 9/10** — An employee who doesn't report their work is invisible. Status reporting builds trust and enables delegation.

### Problem
Managers need to know: what did Swarm do today? What's blocked? What's coming next? Without this, they can't trust Swarm with real work. Currently you'd have to read audit logs or check the dashboard manually.

### Solution
Automated daily/weekly reports posted to Slack, email, or stored as markdown. Includes work completed, PRs created, issues resolved, cost spent, blockers hit, and planned next actions.

### Tasks
- [x] Create `src/commands/standup.ts` — status report generator
  - [x] `swarm standup` — generate and display today's standup
  - [x] `swarm standup --weekly` — generate weekly summary
  - [x] `swarm standup --post` — generate and post to configured channel
  - [x] `swarm standup --since <date>` — custom date range
  - [x] `--format` flag: `slack`, `markdown`, `json`, `email`
- [x] Create `src/core/activity-tracker.ts` — comprehensive activity logging
  - [x] Track all Swarm actions across commands:
    - [x] Pipelines run: feature, outcome, duration, cost
    - [x] PRs created: title, status (open/merged/closed), review state
    - [x] Issues resolved: issue number, resolution type
    - [x] Tests generated: file count, coverage delta
    - [x] Dependencies updated: package count, security fixes
    - [x] Incidents responded to: severity, resolution time
    - [x] Reviews performed: PR count, approval/rejection/comment
    - [x] Failures: what failed, why, was it recovered?
  - [x] Store in `.swarm/activity/YYYY-MM-DD.jsonl`
  - [x] Aggregate functions: daily summary, weekly summary, cost totals
- [x] Report content:
  - [x] **Completed**: bullet list of work done with links
  - [x] **Impact**: lines of code, PRs merged, issues closed, coverage delta
  - [x] **Cost**: total spend, per-item breakdown, budget remaining
  - [x] **Blockers**: items skipped and why (too complex, human input needed, failed)
  - [x] **Upcoming**: next items in queue with estimated cost
  - [x] **Velocity trend**: items/day this week vs last week
  - [x] **ROI estimate**: cost of Swarm vs estimated human time saved
- [x] Delivery channels:
  - [x] Slack: post to configured channel (rich formatting with blocks)
  - [x] Email: send via configurable SMTP or SendGrid
  - [x] GitHub: create a daily summary issue or comment on a tracking issue
  - [x] File: save to `.swarm/reports/standup-YYYY-MM-DD.md`
- [x] Auto-scheduling:
  - [x] Config: `standup.schedule: "0 9 * * 1-5"` (weekdays at 9am)
  - [x] Config: `standup.channel: "#engineering"`
  - [x] Run automatically when inbox daemon is active
- [x] Dashboard: "Standup" view in Tools dropdown
  - [x] Today's standup report (auto-generated)
  - [x] Historical standups (calendar navigation)
  - [x] Activity timeline: visual chronological log
  - [x] Cost burn chart: daily/weekly/monthly
  - [x] "Post now" button for manual delivery

### Cost estimate
- Report generation: $0.05-0.10 (haiku summarization)
- Delivery: $0 (API calls)

---

## P3: Decision Journal + Outcome Learning

**Impact: 9/10** — This is what separates a junior from a senior. Learning from outcomes, not just following instructions.

### Problem
Swarm makes hundreds of decisions: which approach to take, which tests to write, whether to refactor or patch, what review comments to leave. Currently it has no feedback on whether those decisions were good. A senior engineer learns from: "that migration I auto-merged caused a rollback" → "be more cautious with migrations."

### Solution
Log every significant decision with its context, track the outcome over time, and use outcomes to calibrate future decisions. This is a closed-loop learning system.

### Tasks
- [x] Create `src/core/decision-journal.ts` — decision logging + outcome tracking
  - [x] **Decision capture** (automatic, at key decision points):
    - [x] Pipeline decisions: which model to use, which approach to take, retry or fail
    - [x] Confidence assessments: why was confidence X% for this item?
    - [x] Auto-merge decisions: why was this safe to auto-merge?
    - [x] Review decisions: why approve vs request changes?
    - [x] Fix loop decisions: which fix approach, why not the alternative?
    - [x] Skip decisions: why skip this work item?
  - [x] Each decision record:
    ```json
    {
      "id": "dec-20260402-001",
      "timestamp": "2026-04-02T10:30:00Z",
      "type": "auto-merge",
      "context": "PR #45: add user avatar upload",
      "decision": "auto-merge",
      "reasoning": "all tests pass, risk score 15, only touches UI component, no auth/payment changes",
      "confidence": 92,
      "alternatives": ["request human review", "add more tests first"],
      "outcome": null  // filled later
    }
    ```
  - [x] **Outcome tracking** (async, event-driven):
    - [x] PR merged → was it reverted within 48h? → outcome: success/failure
    - [x] Deploy succeeded → did it roll back? → outcome: success/failure
    - [x] Tests generated → did they catch a real bug later? → outcome: valuable/trivial
    - [x] Dependency updated → did CI break within a week? → outcome: success/failure
    - [x] Incident fix → did the same incident recur? → outcome: resolved/recurring
    - [x] GitHub webhook listener for PR events (merge, revert, close)
    - [x] Deploy status from `swarm deploy` history
  - [x] **Learning engine** (runs weekly or on-demand):
    - [x] Aggregate outcomes by decision type
    - [x] Compute accuracy: "72% of my auto-merge decisions were good"
    - [x] Identify failure patterns: "auto-merged PRs touching auth module reverted 40% of the time"
    - [x] Generate rules: "require human review for auth module changes" (stored in memory)
    - [x] Adjust confidence thresholds: if auto-merge accuracy < 80%, tighten threshold
    - [x] Feed rules back into triage engine and confidence gating
  - [x] **Calibration report** (monthly):
    - [x] Decision accuracy by type
    - [x] Overconfidence detection: decisions with >90% confidence that failed
    - [x] Underconfidence detection: decisions with <60% confidence that would have been fine
    - [x] Recommendations: what rules to add/remove, threshold adjustments
- [x] `swarm journal` — view decision journal
  - [x] `swarm journal recent` — last 20 decisions with outcomes
  - [x] `swarm journal analyze` — run learning engine, show findings
  - [x] `swarm journal rules` — show auto-generated rules
  - [x] `swarm journal calibrate` — run calibration report
- [x] Integration with inbox:
  - [x] Triage engine reads journal rules to adjust confidence
  - [x] Auto-merge gate reads journal to know which areas need human review
  - [x] Standup report includes "lessons learned" section
- [x] Dashboard: "Journal" in Tools dropdown
  - [x] Decision timeline with outcome icons (green check, red X, gray pending)
  - [x] Accuracy chart by decision type
  - [x] Auto-generated rules with enable/disable toggle
  - [x] Calibration dashboard with overconfidence/underconfidence highlights

### Cost estimate
- Decision logging: $0 (local structured data)
- Outcome tracking: $0 (webhook events + git operations)
- Learning engine: $0.20-0.50 per run (sonnet analyzes patterns)

---

## P4: `swarm scope` — Requirement Negotiation

**Impact: 8/10** — The difference between a code monkey and a thoughtful engineer.

### Problem
Given "add authentication to the app," a junior developer starts coding immediately. A senior developer asks: "OAuth or email/password? Which provider? MFA? What pages need protecting? What's the timeline?" Swarm currently acts like the junior — it takes the prompt at face value and runs the full pipeline.

### Solution
A pre-pipeline negotiation step that analyzes the request, asks clarifying questions, proposes alternatives with tradeoffs, and gets alignment before spending budget.

### Tasks
- [x] Create `src/commands/scope.ts` — requirement negotiation engine
  - [x] `swarm scope "add authentication"` — start scoping conversation
  - [x] `swarm "add authentication"` — auto-triggers scope if request is ambiguous
- [x] Create `src/core/ambiguity-detector.ts` — request analysis
  - [x] Analyze feature request for:
    - [x] **Vagueness score**: how many reasonable interpretations exist?
    - [x] **Scope size**: estimated files/lines affected, number of sub-tasks
    - [x] **Risk factors**: touches auth, payments, data, infra?
    - [x] **Missing context**: what's not specified that matters?
  - [x] Classification:
    - [x] Clear + small → proceed directly to pipeline
    - [x] Clear + large → break into phases, propose sequencing
    - [x] Ambiguous → enter negotiation mode
    - [x] Risky → flag risks and get explicit approval
  - [x] Threshold config: `scope.autoApprove: true` for clear+small requests
- [x] Negotiation flow:
  - [x] **Step 1 — Analysis**: Read codebase, understand current state relevant to request
  - [x] **Step 2 — Questions**: Generate 3-5 targeted clarifying questions
    - [x] Not generic ("what do you want?") but specific ("I see you already have Passport.js — should I extend that or replace with NextAuth?")
    - [x] Include the impact of each choice ("OAuth adds 2 days but supports Google/GitHub login")
  - [x] **Step 3 — Options**: Present 2-3 implementation approaches
    - [x] Each with: estimated cost, time, risk, tradeoffs
    - [x] Recommendation with reasoning
    - [x] Example: "Option A: Extend Passport.js ($4, low risk) vs Option B: NextAuth migration ($12, medium risk, better long-term)"
  - [x] **Step 4 — Alignment**: User picks approach (or modifies)
  - [x] **Step 5 — Pipeline**: Run pipeline with scoped, specific requirements
- [x] Scope document: `SCOPE.md` generated before pipeline
  - [x] What will be built (explicit)
  - [x] What will NOT be built (explicit — prevents scope creep)
  - [x] Assumptions made
  - [x] Estimated cost and risk
  - [x] Approach chosen and why
- [x] Integration with inbox:
  - [x] When inbox picks up an ambiguous issue, auto-scope and comment on the issue with questions
  - [x] Wait for response before starting work
  - [x] Clear issues go straight to pipeline
- [x] Dashboard: "Scope" step shown before pipeline in launch view
  - [x] Questions panel with inline response
  - [x] Options comparison table
  - [x] "Approve & Run" button
  - [x] Scope history for past features

### Cost estimate
- Scoping analysis: $0.20-0.50 (sonnet reads codebase + generates questions)
- Saves: $5-20 per feature by avoiding wrong implementations

---

## P5: `swarm context` — Persistent Codebase Intelligence

**Impact: 8/10** — Makes every other feature smarter. An employee who knows the codebase deeply outperforms one who reads fresh each time.

### Problem
Every time an agent runs, it re-reads files, re-discovers patterns, re-learns the architecture. This is like hiring a contractor who has amnesia every morning. A real employee builds a deep mental model over weeks: "this module is fragile," "that API is deprecated," "these two services always change together."

### Solution
A continuously-updated codebase knowledge graph that every agent reads from. Persists across runs. Gets smarter over time.

### Tasks
- [x] Create `src/core/codebase-index.ts` — persistent codebase intelligence
  - [x] **Static analysis layer** (rebuilt on file change):
    - [x] File dependency graph: imports/exports between modules
    - [x] Symbol index: every exported function/class/type with file + line
    - [x] Module boundary map: which files are "public API" vs internal
    - [x] Test coverage map: which functions have tests, which don't
    - [x] Complexity scores: per-file and per-function cyclomatic complexity
    - [x] File size + churn rate (from git log)
  - [x] **Semantic layer** (rebuilt weekly or on-demand, uses LLM):
    - [x] Module purpose summaries: "this module handles user authentication via JWT"
    - [x] Architecture overview: "monolith with service-layer pattern, React frontend, Express API"
    - [x] Data flow maps: "user data flows from signup form → /api/users → UserService → PostgreSQL"
    - [x] Invariants: "all API routes must go through authMiddleware except /health and /login"
    - [x] Hazard zones: "changing anything in src/billing/ requires manual testing with Stripe sandbox"
  - [x] **Historical layer** (accumulated from Swarm runs):
    - [x] Fragile files: files where agent changes frequently caused test failures
    - [x] Co-change patterns: "when file A changes, file B almost always needs updating"
    - [x] Bug hotspots: files associated with incident investigations
    - [x] Successful patterns: "last time we added an API endpoint, the pipeline succeeded on first try with this approach"
  - [x] Storage: `.swarm/index/` directory
    - [x] `graph.json` — dependency graph
    - [x] `symbols.json` — symbol index
    - [x] `semantic.json` — LLM-generated summaries
    - [x] `history.json` — accumulated run history
  - [x] Incremental update: only re-analyze changed files (watch `.git/refs/heads/`)
- [x] Agent integration:
  - [x] Every agent's system prompt gets relevant context from the index:
    - [x] Analyst: architecture overview, module purposes, data flows
    - [x] Architect: dependency graph, module boundaries, hazard zones
    - [x] Lead: complexity scores, co-change patterns, test coverage gaps
    - [x] Engineer: relevant symbols, related files, successful patterns, fragile files
    - [x] Tester: test coverage map, bug hotspots, untested code paths
  - [x] Context is scoped — agents only get context relevant to their task (not the whole index)
  - [x] Token budget: max 2000 tokens of context per agent (concise summaries)
- [x] `swarm context` — CLI for interacting with the index
  - [x] `swarm context build` — full index rebuild
  - [x] `swarm context query "how does auth work?"` — ask questions about the codebase
  - [x] `swarm context graph src/auth/` — show dependency graph for a directory
  - [x] `swarm context fragile` — show fragile files ranked by risk
  - [x] `swarm context stale` — show stale index entries
- [x] Dashboard: "Codebase" view in Tools dropdown
  - [x] Interactive dependency graph (D3.js force-directed or tree layout)
  - [x] File explorer with heat overlay (churn, complexity, coverage)
  - [x] Search bar for codebase questions
  - [x] Module detail panel: purpose, dependencies, coverage, hazards
  - [x] "Rebuild index" button

### Cost estimate
- Static analysis: $0 (AST parsing, git operations)
- Semantic analysis: $0.50-2.00 (sonnet summarizes modules — runs weekly)
- Query: $0.05 (haiku answers from pre-built context)

---

## P6: `swarm pair` — Real-Time Collaboration Mode

**Impact: 8/10** — Multiplies the human developer, doesn't replace them.

### Problem
Sometimes the developer doesn't want Swarm to go away and come back with a PR. They want a pairing partner: "watch what I'm doing, suggest improvements, write the tests as I code, catch bugs before I commit." This is the most natural interaction model for experienced developers.

### Solution
A long-running session that watches file changes in real-time, understands what the developer is building, and proactively offers help — tests, refactors, docs, bug catches — without being asked.

### Tasks
- [x] Create `src/commands/pair.ts` — real-time pairing daemon
  - [x] `swarm pair` — start pairing session in current directory
  - [x] `swarm pair --focus src/auth/` — focus on specific directory
  - [x] `swarm pair --mode suggest|assist|silent` — verbosity control
    - [x] `suggest`: shows suggestions in terminal (default)
    - [x] `assist`: suggestions + auto-writes test files
    - [x] `silent`: only flags critical issues (security, bugs)
  - [x] `swarm pair stop` — end session
- [x] Create `src/core/pair-engine.ts` — file change analysis
  - [x] Watch file system for saves (fs.watch on project directory)
  - [x] On file save:
    - [x] Diff the file vs last known state
    - [x] Understand the intent: "adding a new function," "fixing a bug," "refactoring"
    - [x] Check against codebase context: "this touches the auth module, which has invariants"
  - [x] **Proactive suggestions** (debounced, max 1 per 30 seconds):
    - [x] Bug detection: "This function doesn't handle the null case — `getUserById` returns null when user not found"
    - [x] Pattern enforcement: "Other handlers in this file use try/catch — this one is missing error handling"
    - [x] Test gaps: "You added `calculateDiscount()` but there are no tests for it yet — want me to generate them?"
    - [x] Security flags: "This query uses string interpolation — use parameterized queries instead"
    - [x] Import suggestions: "You're using `lodash.get` — this project uses optional chaining instead"
    - [x] Co-change reminders: "When you change `UserService`, `UserController` usually needs updating too"
  - [x] **On-demand actions** (triggered by developer):
    - [x] `swarm pair test` — generate tests for current changes
    - [x] `swarm pair explain` — explain the code they're reading
    - [x] `swarm pair refactor` — suggest refactoring for current function
    - [x] `swarm pair commit` — generate commit message from changes
  - [x] Context accumulation: the longer the session, the better Swarm understands the current task
  - [x] Session summary on exit: what was done, suggestions made, tests written
- [x] VS Code extension integration:
  - [x] Show suggestions as inline hints (Code Actions)
  - [x] "Swarm: Generate Tests" in right-click menu
  - [x] Status bar: "Pairing with Swarm" indicator
  - [x] Suggestion notification with accept/dismiss
- [x] Dashboard: "Pair" view
  - [x] Live file change feed
  - [x] Suggestion history with accept/dismiss/ignore tracking
  - [x] Session duration + activity graph
  - [x] "Currently watching" file list

### Cost estimate
- Per suggestion: $0.02-0.05 (haiku for quick analysis)
- Per test generation: $0.10-0.30 (sonnet for test writing)
- Typical 2-hour session: $0.50-2.00

---

## P7: `swarm delegate` — Multi-Agent Task Decomposition

**Impact: 7/10** — The jump from "one task at a time" to "managing a team of agents."

### Problem
Currently Swarm processes one pipeline at a time per work item. A real employee managing a project would parallelize: "while the API is being built, start on the frontend. Once both are done, write integration tests." Swarm needs to self-organize parallel workstreams.

### Solution
When a task is too large for a single pipeline, Swarm decomposes it into independent workstreams, runs them in parallel (separate git worktrees), and coordinates the merge.

### Tasks
- [x] Create `src/commands/delegate.ts` — multi-agent orchestrator
  - [x] `swarm delegate "build a user management system"` — large feature request
  - [x] Decomposition pipeline:
    - [x] Run analyst + architect as normal (produces REQUIREMENTS.md + SPEC.md)
    - [x] Lead produces TASKS.md with parallel group markers
    - [x] **New**: Swarm reads TASKS.md and identifies independent workstreams
    - [x] Each workstream gets its own git worktree + pipeline
    - [x] Workstreams run in parallel (respecting dependency ordering)
  - [x] Coordination:
    - [x] Shared context: all workstreams read from the same SPEC.md + codebase index
    - [x] Merge orchestration: when workstreams complete, merge branches sequentially
    - [x] Conflict resolution: if merge conflicts, spawn a resolution agent
    - [x] Integration tests: after all merges, run full test suite
    - [x] If integration fails: identify which workstream broke it, re-run fix loop
  - [x] `swarm delegate status` — show all parallel workstreams and their status
  - [x] `swarm delegate merge` — manually trigger merge when ready
  - [x] Resource limits:
    - [x] `--max-parallel <n>` — max concurrent workstreams (default: 3)
    - [x] `--budget <amount>` — total budget across all workstreams
    - [x] Workstream priority: critical path items first
- [x] Dashboard: "Delegate" view
  - [x] Workstream swimlanes showing parallel progress
  - [x] Dependency graph between workstreams
  - [x] Merge status and conflict indicators
  - [x] Total cost aggregated across workstreams
  - [x] Per-workstream: click to see standard pipeline view

### Cost estimate
- Decomposition: $0.50-1.00 (single pipeline through architect/lead)
- Per workstream: $3-10 (standard pipeline)
- Typical large feature: $15-40

---

## P8: `swarm report` — ROI & Impact Reporting

**Impact: 7/10** — The feature that justifies Swarm's existence to management.

### Problem
Engineering managers need to justify AI tooling costs. "We spent $500 on Swarm last month" means nothing without: "...and it resolved 47 issues, wrote 3,200 lines of tests, caught 5 security vulnerabilities, reduced mean-time-to-fix by 60%, and saved approximately 120 engineering hours."

### Solution
Comprehensive impact tracking with financial ROI calculations that map directly to engineering metrics leadership cares about.

### Tasks
- [x] Create `src/commands/report.ts` — impact reporting
  - [x] `swarm report` — generate monthly impact report
  - [x] `swarm report --period weekly|monthly|quarterly`
  - [x] `swarm report --format pdf|markdown|html|slack`
  - [x] `swarm report --compare` — compare with previous period
- [x] Metrics tracked:
  - [x] **Output metrics**:
    - [x] Issues resolved (count, by type)
    - [x] PRs created and merged
    - [x] Lines of code generated (net, not churned)
    - [x] Tests generated (count + coverage delta)
    - [x] Dependencies updated (count + security fixes)
    - [x] Incidents responded to (count + mean time to diagnose)
    - [x] Code reviews performed
  - [x] **Quality metrics**:
    - [x] PR merge rate (merged/total — higher = better quality)
    - [x] Revert rate (reverted/merged — lower = better)
    - [x] Fix loop success rate (fixed on first try vs needed retries)
    - [x] Security findings caught before merge
    - [x] Test failure prevention (bugs caught by generated tests)
  - [x] **Cost metrics**:
    - [x] Total spend (by model, by command, by feature)
    - [x] Cost per issue resolved
    - [x] Cost per PR merged
    - [x] Cost per line of code
    - [x] Budget utilization (spent/allocated)
  - [x] **ROI estimation**:
    - [x] Estimated human hours saved (based on industry averages per task type)
    - [x] Configurable hourly rate: `report.engineerHourlyRate: 75`
    - [x] ROI = (estimated hours saved × hourly rate) / total Swarm cost
    - [x] Break-even analysis: "Swarm pays for itself if it saves > X hours/month"
  - [x] **Trend analysis**:
    - [x] Period-over-period comparison
    - [x] Velocity trends (items/week)
    - [x] Quality trends (merge rate, revert rate)
    - [x] Cost efficiency trends (cost per issue over time)
- [x] Dashboard: "Reports" view in Tools dropdown
  - [x] Executive summary card: ROI, issues closed, cost
  - [x] Interactive charts: output over time, cost breakdown, quality trends
  - [x] Exportable as PDF for management review
  - [x] Shareable link (static HTML export)

### Cost estimate
- Report generation: $0.10-0.20 (haiku for summaries)
- Data collection: $0 (from existing activity tracker)

---

## P9: Team Awareness — Multi-User Coordination

**Impact: 7/10** — An employee knows what their teammates are doing. Avoids duplicate work and conflicts.

### Tasks
- [x] Extend `swarm server` with multi-user awareness
  - [x] Track which human developer is working on which files/branches
  - [x] When Swarm inbox picks up an issue:
    - [x] Check if a human already has a branch for it → skip
    - [x] Check if another Swarm instance is working on a related issue → coordinate
  - [x] Conflict prevention:
    - [x] Lock files being actively edited by humans (read from IDE integration)
    - [x] Warn before starting work that overlaps with in-progress human work
    - [x] "Developer X is working on auth — defer auth-related issues?"
  - [x] Communication:
    - [x] @mention relevant developers in PR descriptions
    - [x] Post to team channel when starting large tasks: "Starting work on #45 — estimated 20 min"
    - [x] Ask developers for input when stuck: "I'm not sure how to handle X in #45 — @developer thoughts?"
- [x] Config:
  ```yaml
  team:
    members:
      - github: "alice"
        slack: "@alice"
        areas: ["frontend", "auth"]
      - github: "bob"
        slack: "@bob"
        areas: ["backend", "infra"]
    notifyChannel: "#engineering"
  ```
- [x] Dashboard: team activity feed showing Swarm + human activity

### Cost estimate
- $0 (coordination logic, API calls)

---

## P10: `swarm retro` — Self-Improvement Retrospectives

**Impact: 6/10** — Closes the loop. Swarm evaluates its own performance and proposes improvements.

### Tasks
- [x] Create `src/commands/retro.ts` — self-evaluation engine
  - [x] `swarm retro` — run retrospective for last 2 weeks
  - [x] `swarm retro --period monthly`
  - [x] Analyzes:
    - [x] What went well: successful auto-merges, fast resolutions, good reviews
    - [x] What went poorly: reverted PRs, failed pipelines, overbudget items
    - [x] What to change: concrete improvements to config, thresholds, rules
  - [x] Output: `RETRO.md` with action items
  - [x] Action items are actionable changes to `.swarm/config.yaml` or memory rules
  - [x] `--auto-apply` flag: automatically apply recommended config changes
  - [x] Dashboard: "Retro" view with before/after comparison if changes are applied

### Cost estimate
- $0.30-0.50 per retro (sonnet analysis)

---

## Implementation Order

| # | Feature | Impact | Effort | Dependencies | Phase |
|---|---------|--------|--------|-------------|-------|
| P1 | `swarm inbox` — Self-directed work | 10/10 | 3 weeks | autopilot (wave-2) | Week 1-3 |
| P2 | `swarm standup` — Status reporting | 9/10 | 1 week | activity tracker | Week 2-3 |
| P3 | Decision journal + learning | 9/10 | 2 weeks | memory store | Week 3-5 |
| P4 | `swarm scope` — Negotiation | 8/10 | 1.5 weeks | codebase index | Week 4-5 |
| P5 | `swarm context` — Codebase intel | 8/10 | 2 weeks | learn, memory | Week 1-3 (parallel) |
| P6 | `swarm pair` — Real-time collab | 8/10 | 2 weeks | watch, context | Week 5-7 |
| P7 | `swarm delegate` — Multi-agent | 7/10 | 2.5 weeks | pipeline, worktrees | Week 6-8 |
| P8 | `swarm report` — ROI reporting | 7/10 | 1 week | activity tracker | Week 4-5 |
| P9 | Team awareness | 7/10 | 2 weeks | server, inbox | Week 7-9 |
| P10 | `swarm retro` — Self-improvement | 6/10 | 1 week | journal, report | Week 8-9 |

**Critical path**: P1 (inbox) + P5 (context) start in parallel → P3 (journal) → P4 (scope) → P6 (pair)
**The inbox is the anchor**. Everything else makes the inbox smarter, more trusted, or more visible.

---

## What "Autonomous Employee" Looks Like After Wave 3

```
Monday 6:00 AM — swarm inbox wakes up
  → Checks GitHub: 3 new issues, 2 stale PRs, 1 failing CI run
  → Checks Slack: 1 request from @alice
  → Triage: CI fix (P0), alice's request (P1), bug #78 (P2), feature #80 (P3), stale PRs (P4)

6:02 AM — Starts CI fix (high confidence, clear error)
  → Reads failing test, identifies regression from yesterday's merge
  → Fixes, tests pass, creates PR, auto-merges (risk score: 8, confidence: 94%)

6:15 AM — Starts alice's request: "add rate limiting to /api/upload"
  → swarm scope detects ambiguity: "What rate? Per user or global? Which response code?"
  → Posts questions as Slack reply to @alice
  → Moves to next item while waiting

6:20 AM — Starts bug #78 (medium confidence)
  → Reads issue, scopes fix, runs pipeline
  → Creates PR, requests review from bob (CODEOWNERS match)
  → Decision journal: "auto-created PR, did not auto-merge (touches payment module, journal rule #7)"

7:30 AM — Alice replies: "100 req/min per user, 429 response"
  → Resumes rate limiting task with clear requirements
  → Runs pipeline, creates PR, assigns to alice for review

9:00 AM — swarm standup posts to #engineering:
  "✅ Fixed CI (auto-merged) | 🔄 Rate limiting PR ready for @alice | 🔄 Bug #78 PR ready for @bob | 📋 Feature #80 queued (estimated $8) | 💰 $12.30 spent today ($12.70 remaining)"

... continues through the day ...

Friday 5:00 PM — swarm retro runs:
  "This week: 12 issues resolved, 14 PRs, 2 reverted (both in auth module). Recommendation: raise review threshold for auth/ from 85 → 95 confidence."
```
