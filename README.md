# Swarm

**AI builds your feature while you watch.**

Swarm orchestrates multiple Claude Code agents through a 5-stage pipeline — analyze, architect, plan, build, test — to turn a feature request into working, tested code.

```
"Add JWT login with refresh tokens"
    ↓
  Analyze → Architect → Plan → Build → Test → Working Code
```

<!-- TODO: Add demo GIF here once recorded -->
<!-- ![Swarm Demo](assets/demo.gif) -->

## Quick Start

```bash
# 1. Install Claude Code CLI (if you don't have it)
npm install -g @anthropic-ai/claude-code

# 2. Install Swarm
npm install -g swarm-pipeline

# 3. Build a feature (that's it)
swarm "Add a login page with JWT authentication"
```

Swarm auto-detects your tech stack, runs all 5 stages, fixes failing tests, and commits the result.

> **First time?** Run `swarm doctor` to verify your environment is set up correctly.

## What Happens

| Stage | What it does | Output |
|-------|-------------|--------|
| **Analyze** | Gathers requirements, asks clarifying questions | REQUIREMENTS.md |
| **Architect** | Designs system architecture with ADRs | SPEC.md |
| **Plan** | Breaks work into parallelizable tasks | TASKS.md |
| **Build** | Engineers implement code (parallel agents) | Source code |
| **Test** | Generates and runs E2E tests, auto-fixes failures | TESTPLAN.md + passing tests |

Each stage uses a specialized AI persona with strict role boundaries — the analyst can't write code, the engineer can't redesign the architecture.

## Quick Workflows

Not everything needs the full 5-stage pipeline. These commands skip straight to what matters:

| Command | What it does | Default model | Typical cost |
|---------|-------------|---------------|-------------|
| `swarm fix "bug"` | Engineer fixes the bug, runs tests | config default | $1–3 |
| `swarm fix --issue 123` | Fetches GitHub issue, fixes it | config default | $1–3 |
| `swarm review` | Reviews current git changes | sonnet | $0.50–1 |
| `swarm review 456` | Reviews a GitHub PR | sonnet | $0.50–1 |
| `swarm simplify` | Scans changes for dead code, duplication, over-engineering | haiku | $0.20–0.50 |
| `swarm spike "question"` | Read-only codebase exploration | haiku | $0.10–0.30 |
| `swarm refactor "goal"` | Analyze scope → apply changes → verify tests | config default | $2–5 |
| `swarm ci "feature"` | Headless CI pipeline with JSON output + exit codes | config default | $3–10 |
| `swarm learn` | Scan codebase, extract conventions for all agents | — | $0 |
| `swarm explain "question"` | AI-powered codebase Q&A and onboarding | haiku | $0.05–0.50 |
| `swarm watch start` | File watcher → auto-test → auto-fix | config default | $0–2/fix |
| `swarm babysit-prs start` | Background PR reviewer daemon | sonnet | $0.50–1.50/PR |
| `swarm deploy staging` | Deploy using .swarm/deploy.yaml | — | $0 |
| `swarm migrate "description"` | AI-assisted database migration | sonnet | $0.50–2 |
| `swarm stats` | Cost intelligence and analytics | — | $0 |
| `swarm inbox start` | Self-directed work queue daemon | config default | $3-15/item |
| `swarm standup` | Daily/weekly status reports | — | $0 |
| `swarm scope "request"` | Negotiate requirements before pipeline | sonnet | $0.20-0.50 |
| `swarm pair` | Real-time pairing with live suggestions | haiku | $0.50-2/session |
| `swarm delegate "feature"` | Multi-agent parallel workstreams | config default | $15-40 |
| `swarm report` | ROI & impact reporting | — | $0 |
| `swarm retro` | Self-improvement retrospective | — | $0 |

All quick workflows are also available from the **dashboard** Launch view as one-click buttons.

## Wave 2 Features

### Autopilot — Issue-to-PR Automation (`swarm autopilot`)
Background daemon that watches GitHub issues with a specific label, runs the full MayDay pipeline per issue, and creates a PR. Zero-touch from issue to reviewable PR.

```bash
swarm autopilot start --label swarm          # Watch issues labeled "swarm"
swarm autopilot start --budget 10 --dry-run  # Test without creating PRs
swarm autopilot status                       # Show queue, stats, processed issues
swarm autopilot stop                         # Stop the daemon
```

Per issue: creates branch → runs full pipeline → creates PR → comments on issue → updates labels. Configurable poll interval, max concurrent, and per-issue budget.

### Retroactive Test Generation (`swarm test-gen`)
Batch test generation across untested files with coverage analysis, intelligent file ranking, and a verification loop.

```bash
swarm test-gen                               # Generate tests for untested files
swarm test-gen src/core/                     # Scope to a directory
swarm test-gen --coverage --verify           # Analyze coverage, verify generated tests
swarm test-gen --framework vitest --budget 5 # Specify framework and budget
```

### Intelligent Dependency Updates (`swarm deps`)
Scan, classify, and safely update dependencies with risk-aware automation.

```bash
swarm deps check                             # Scan and classify outdated deps
swarm deps update --level minor --verify     # Apply minor updates, run tests after
swarm deps update --level major --budget 5   # Use AI agent for major migrations
swarm deps audit                             # Check for known vulnerabilities
```

### Regression Risk Scoring (`swarm risk`)
Multi-dimensional risk analysis (0-100) for changed files: file criticality, test coverage, blast radius, change history, complexity, and novelty.

```bash
swarm risk                                   # Score files changed vs main
swarm risk src/auth.ts src/db.ts             # Score specific files
swarm risk --fail-above 75                   # CI gate: fail if any file is critical
swarm risk --json                            # Machine-readable output
```

### Production Incident Response (`swarm incident`)
AI-assisted incident diagnosis and remediation: correlates logs with recent deploys, generates root cause analysis, and optionally produces fixes.

```bash
swarm incident respond "500 errors on /api/users" --severity P2
swarm incident respond "memory leak" --logs /tmp/app.log --fix
swarm incident history                       # Past incident responses
```

### Smart PR Creation (`swarm pr`)
Intelligent PR creation with CODEOWNERS parsing, git blame reviewer suggestions, risk score badges, and structured PR bodies.

```bash
swarm pr                                     # Create PR with smart defaults
swarm pr --risk --reviewers                  # Include risk scores, auto-assign reviewers
swarm pr --draft --label "needs-review"      # Draft PR with labels
```

### Codebase Health Monitor (`swarm health`)
Track dependency freshness, vulnerabilities, dead code, complexity hotspots, type coverage, bundle size, and doc freshness. Scored 0-100.

```bash
swarm health                                 # Run health check
swarm health --json                          # Machine-readable output
swarm health --watch --interval 60           # Continuous monitoring
```

### Project Management Integration (`swarm pm`)
Bidirectional sync with GitHub Issues, Linear, and Jira. Import tickets as feature requests, sync pipeline state to PM tool status.

```bash
swarm pm sync --provider github              # Sync pipeline state to GitHub
swarm pm import ISSUE-123 --provider linear  # Import Linear ticket as feature request
swarm pm status                              # Show sync status
```

### Performance Regression Detection (`swarm benchmark`)
Run benchmarks, compare with baselines, and detect performance regressions with configurable thresholds.

```bash
swarm benchmark run                          # Run benchmarks and compare
swarm benchmark baseline                     # Save current results as baseline
swarm benchmark run --threshold 10 --fail-on-regression  # CI gate
```

### Multi-Repo Orchestration (`swarm multi-repo`)
Cross-repo feature coordination with linked PR creation.

```bash
swarm multi-repo run "add auth" --repos api,web  # Feature across repos
swarm multi-repo status                           # Status across repos
swarm multi-repo sync                             # Check API contract alignment
```

### Security Scanner (`swarm secure`)
OWASP-style security scanning: SQL injection, XSS, hardcoded secrets, path traversal, command injection, eval usage, insecure crypto, prototype pollution, SSRF, and insecure headers.

```bash
swarm secure                                 # Static pattern scan
swarm secure --full                          # Include LLM semantic analysis
swarm secure --fix                           # Auto-fix critical/high findings
swarm secure --fail-on high --sarif          # CI gate with SARIF output
```

### Supply Chain Attack Prevention (`swarm supply-chain`)
Pre-install verification: package existence, age, popularity, maintainer count, typosquatting detection, install script scanning, and lockfile integrity.

```bash
swarm supply-chain check                     # Verify all dependencies
swarm supply-chain check lodash              # Verify a single package
swarm supply-chain lockfile                  # Check lockfile integrity
```

### Secret Detection (`swarm secrets`)
200+ regex patterns for AWS keys, GitHub tokens, Stripe keys, private keys, JWTs, database URLs, and more. Context-aware: skips test fixtures and placeholders.

```bash
swarm secrets scan                           # Scan for hardcoded secrets
swarm secrets scan --include-tests           # Include test files
swarm secrets gitignore                      # Check .gitignore coverage
```

### Sandboxed Code Execution (`swarm sandbox`)
Filesystem, network, and command restrictions for AI agents. Three modes: strict, moderate, off.

```bash
swarm sandbox status                         # Show current mode and config
swarm sandbox set strict                     # Maximum restrictions
swarm sandbox violations                     # View violation log
```

### Code Provenance & Audit Trail (`swarm provenance`)
Track AI-generated code: model, requestor, prompt hash, files changed, security checks, cost. Exportable compliance reports.

```bash
swarm provenance trail                       # Show provenance records
swarm provenance trail --file src/auth.ts    # Filter by file
swarm provenance export --format csv         # Compliance export
```

### Prompt Injection Defense (`swarm prompt-guard`)
Input sanitization for external content (issues, PRs, files): detects instruction override, role escape, system prompt leak, jailbreak, and data exfiltration attempts.

```bash
swarm prompt-guard scan "text to check"      # Scan for injection
swarm prompt-guard test                      # Run defense self-test
```

### AI Code Fingerprinting (`swarm fingerprint`)
Tag and track AI-generated vs human-written code using git trailers, provenance records, and heuristic analysis.

```bash
swarm fingerprint                            # Scan all source files
swarm fingerprint src/                       # Scope to directory
swarm fingerprint --json                     # Machine-readable output
```

### Runtime Security Monitoring (`swarm monitor`)
Track filesystem access, network connections, environment variable reads, and subprocess spawning during agent execution. Baseline comparison for anomaly detection.

```bash
swarm monitor events                         # Show runtime events
swarm monitor anomalies                      # Events deviating from baseline
swarm monitor baseline                       # Save current state as baseline
```

## Wave 3 Features — Autonomous Employee

Wave 3 transforms Swarm from a reactive tool into a proactive autonomous employee that finds work, prioritizes, learns from outcomes, and reports back.

### Self-Directed Work Queue (`swarm inbox`)
A persistent daemon that aggregates work from GitHub issues, PRs needing review, failing CI, stale PRs, and manual tasks. Triages by priority, estimates cost, and works through them autonomously based on confidence thresholds.

```bash
swarm inbox                              # Show current queue with priorities
swarm inbox start --label swarm          # Start the daemon
swarm inbox start --budget 25            # Set daily budget
swarm inbox pause                        # Pause processing (keep aggregating)
swarm inbox add "refactor auth module"   # Add manual work item
swarm inbox skip <id>                    # Skip a work item
swarm inbox prioritize <id>              # Bump item to top
swarm inbox config                       # Show triage rules
```

Confidence gating: high (>85%) = auto-merge, medium (60-85%) = create PR for review, low (<60%) = research only and notify human.

### Async Status Reporting (`swarm standup`)
Automated daily/weekly reports summarizing work completed, PRs created, issues resolved, cost spent, blockers hit, and velocity trends.

```bash
swarm standup                            # Today's standup report
swarm standup --weekly                   # Weekly summary
swarm standup --post                     # Save report for posting
swarm standup --since 2026-03-25         # Custom date range
swarm standup --format slack             # Slack-formatted output
```

### Decision Journal & Outcome Learning (`swarm journal`)
Logs every significant decision (auto-merge, confidence gate, review verdict, fix approach), tracks outcomes over time, and generates rules to calibrate future decisions.

```bash
swarm journal                            # Last 20 decisions with outcomes
swarm journal analyze                    # Run learning engine, show findings
swarm journal rules                      # Show auto-generated rules
swarm journal calibrate                  # Calibration report (over/under-confidence)
```

The learning engine identifies patterns like "auto-merged PRs touching auth module reverted 40% of the time" and generates rules like "require human review for auth module changes."

### Requirement Negotiation (`swarm scope`)
Pre-pipeline negotiation that analyzes requests for ambiguity, asks clarifying questions, proposes implementation options with cost/risk tradeoffs, and gets alignment before spending budget.

```bash
swarm scope "add authentication"         # Analyze and negotiate requirements
```

Produces a SCOPE.md with: what will be built, what won't, assumptions, estimated cost, and the chosen approach. Saves $5-20 per feature by avoiding wrong implementations.

### Codebase Intelligence (`swarm context`)
A continuously-updated codebase knowledge graph — dependency graphs, symbol index, complexity scores, churn rates, fragile files, co-change patterns. Every agent reads relevant context instead of re-discovering the codebase from scratch.

```bash
swarm context build                      # Full index rebuild
swarm context query "how does auth?"     # Ask questions about the codebase
swarm context graph src/auth/            # Show dependency graph
swarm context fragile                    # Show fragile files ranked by risk
swarm context stale                      # Show stale index entries
```

### Real-Time Collaboration (`swarm pair`)
A long-running pairing session that watches file changes, understands what you're building, and proactively offers suggestions — bug catches, pattern enforcement, test gaps, security flags, co-change reminders.

```bash
swarm pair                               # Start pairing (suggest mode)
swarm pair --focus src/auth/ --mode assist  # Focus + auto-write tests
swarm pair test                          # Generate tests for current changes
swarm pair commit                        # Generate commit message from changes
```

Three modes: `suggest` (terminal suggestions), `assist` (suggestions + auto-writes tests), `silent` (only critical issues).

### Multi-Agent Task Decomposition (`swarm delegate`)
For large features: decomposes into independent workstreams, runs them in parallel git worktrees, and coordinates the merge with test verification after each merge.

```bash
swarm delegate "build user management"   # Decompose and run parallel workstreams
swarm delegate --max-parallel 3 --budget 50
swarm delegate status                    # Show workstream progress
swarm delegate merge                     # Trigger sequential merge
```

### ROI & Impact Reporting (`swarm report`)
Comprehensive impact tracking with financial ROI calculations. Maps directly to engineering metrics: issues resolved, PRs merged, tests generated, cost per issue, estimated hours saved.

```bash
swarm report                             # Monthly impact report
swarm report --period weekly             # Weekly report
swarm report --compare                   # Compare with previous period
swarm report --format html               # Export as HTML
```

ROI estimation: configurable hourly rate (default $75), per-task-type hour savings (pipeline=4h, fix=1h, test-gen=2h, review=0.5h).

### Team Awareness (`swarm team`)
Multi-user coordination — tracks which developers are working on which files/branches, detects overlap with Swarm's work, and prevents conflicts.

```bash
swarm team                               # Show team activity status
swarm team activity                      # Who's working on what
swarm team notify "starting auth work"   # Notify team channel
swarm team config                        # Show team configuration
```

Configure team members in `.swarm/config.yaml`:
```yaml
team:
  members:
    - github: "alice"
      areas: ["frontend", "auth"]
    - github: "bob"
      areas: ["backend", "infra"]
```

### Self-Improvement Retrospectives (`swarm retro`)
Evaluates its own performance: what went well, what went poorly, and proposes concrete config changes to improve. Optionally auto-applies recommendations.

```bash
swarm retro                              # Last 2 weeks retrospective
swarm retro --period monthly             # Monthly retro
swarm retro --auto-apply                 # Apply recommended config changes
```

Analyzes: success rates, revert rates, fix iteration counts, cost efficiency — then recommends threshold adjustments, model changes, and budget tuning.

## Wave 4 Features — Autonomous Engineering Organization

Wave 4 transforms Swarm from an autonomous employee into a **staff/principal engineer** — it owns product surfaces, makes strategic architecture decisions, mentors developers, plans long-term roadmaps, and manages tech debt proactively.

### Surface Ownership (`swarm own`)
Assign Swarm ownership of a product surface (auth, API, payments). It continuously monitors SLOs, maintains code quality, and auto-fixes issues within budget.

```bash
swarm own register auth --paths "src/auth/**" --slo "coverage>=90" --budget 50
swarm own list                               # Show all surfaces with SLO status
swarm own check                              # Check all surface SLOs
swarm own status                             # Detailed surface health
swarm own release auth                       # Release ownership
```

### Strategic Architecture Review (`swarm architect-review`)
Periodic architectural analysis detecting circular dependencies, god modules, coupling hotspots, and growth pattern issues — with multi-phase solution plans.

```bash
swarm architect-review                       # Full architectural assessment
swarm architect-review --focus performance   # Focus on performance patterns
swarm architect-review --focus security      # Security posture analysis
```

Outputs `ARCHITECTURE-REVIEW.md` with executive summary, per-issue evidence, solution options, and a prioritized action plan.

### Developer Onboarding & Mentoring (`swarm onboard` / `swarm mentor`)
Interactive onboarding that walks new developers through the codebase, and a persistent mentor for contextual questions.

```bash
swarm onboard                                # Start guided 5-step tour
swarm onboard --role frontend                # Role-specific onboarding
swarm onboard --area auth                    # Area-specific deep dive
swarm mentor "why does auth use JWT?"        # Ask contextual questions
swarm mentor review                          # Educational code review
swarm mentor explain src/billing/            # Deep dive into any area
```

### Long-Term Project Planning (`swarm roadmap`)
Multi-phase roadmap generation with dependency graphs, critical path analysis, risk assessment, and execution tracking.

```bash
swarm roadmap "migrate to microservices"     # Generate multi-phase plan
swarm roadmap review                         # Review progress vs estimates
swarm roadmap adjust                         # Re-plan based on actuals
swarm roadmap execute phase-1                # Start executing a phase
```

Outputs `ROADMAP.md` with Gantt-style timeline, phase breakdowns, risk register, and decision points.

### Cross-Repository Orchestration (`swarm system`)
Think in systems, not files. Map services, validate contracts, and coordinate changes across repos.

```bash
swarm system map                             # Display service dependency graph
swarm system check                           # Validate cross-repo contracts
swarm system feature "add notifications"     # Plan cross-repo feature
swarm system migrate "upgrade auth v2"       # Coordinated migration plan
```

### Production Outcome Ownership (`swarm slo`)
Own SLOs, track error budgets, detect trends, and proactively address degradation before incidents happen.

```bash
swarm slo                                    # Show all SLOs with status
swarm slo add "p99-latency" --target "<200ms" --source grafana
swarm slo check                              # Check all SLOs against metrics
swarm slo remove "p99-latency"               # Remove an SLO
```

### Proactive Tech Debt Management (`swarm evolve`)
Continuous tech debt tracking — detects code quality issues, architectural debt, dependency risks, test gaps, and documentation staleness.

```bash
swarm evolve scan                            # Analyze codebase for tech debt
swarm evolve plan                            # Generate debt reduction roadmap
swarm evolve work                            # Auto-fix highest-priority items
swarm evolve report                          # Debt score trend report
```

Detects: files >300 lines, functions >50 lines, TODO/FIXME/HACK comments, `any` types, circular imports, missing tests, outdated deps, stale docs.

### Engineering Intelligence (`swarm forecast`)
Data-driven predictions for velocity, cost, risk, and codebase health trends.

```bash
swarm forecast velocity                      # Predict next sprint velocity
swarm forecast risk "planned migration"      # Risk assessment for planned work
swarm forecast cost "add notifications"      # Estimate cost before starting
swarm forecast health                        # Predict codebase health trends
```

### Regulatory Compliance (`swarm compliance`)
Automated compliance checking for SOC 2, HIPAA, GDPR, and PCI DSS — with evidence collection and gap analysis.

```bash
swarm compliance check                       # Run all compliance checks
swarm compliance check --framework soc2      # Framework-specific check
swarm compliance report --framework hipaa    # Generate audit-ready report
swarm compliance monitor --interval 60       # Continuous monitoring
```

### Platform Extensibility (Plugins)
Plugin system for custom work sources, actions, checks, reporters, and monitors — managed from the dashboard Plugins view.

## Smart Features

### Codebase Awareness
Swarm scans your project before each pipeline run — package.json, file tree, existing tests, git history — and injects this context into every stage. Stages know they're extending an existing codebase, not building from scratch.

### Strategy Escalation
When the fix loop gets stuck on the same failures, it automatically escalates through 4 strategies before giving up:
1. **Standard** — fix the failing code
2. **Broader context** — read more of the codebase, trace data flow
3. **Rewrite** — delete and rewrite the affected components from scratch
4. **Simplify** — reduce scope, stub features, get tests passing minimally

### Budget Degradation
Instead of killing all agents when budget runs low, Swarm automatically downgrades models:
- At **80% budget**: opus → sonnet
- At **90% budget**: all agents → haiku

### Blocking Guardrails
Artifact validation (REQUIREMENTS.md sections, SPEC.md structure, TASKS.md format) now **blocks** pipeline progression on errors. Bad artifacts trigger automatic retry instead of flowing downstream.

### Failure Reports
When a pipeline fails, Swarm saves `FAILURE-REPORT.md` with: stage-by-stage results, artifacts produced, fix loop history, last test output, and context-aware next steps.

### Parallel Test Execution
For stacks with multiple test frameworks (e.g., React: Vitest + Playwright), Swarm runs them in parallel with separate agents.

### Monorepo Support
Set `packages: ["packages/api", "packages/web"]` in config to scope all agent work to specific packages.

### LLM Quality Gate
Enable `llmQualityGate: true` in config to run haiku-based semantic quality evaluation after each stage (~$0.01/artifact). Blocks if blended score falls below threshold.

### Convention Learning (`swarm learn`)
Scan your codebase once to extract naming conventions, import patterns, test structure, component patterns, and more. Saved to `.swarm/conventions.md` and automatically injected into every agent's system prompt — so all generated code matches your project's style.

### Cross-Run Memory
Swarm remembers what worked and what failed across pipeline runs. Fix patterns, flaky tests, and approach history are stored in `.swarm/memory/` and fed to agents automatically. Add manual notes with `swarm memory add "note"`.

### PR Review Agent (`swarm babysit-prs`)
Background daemon that polls GitHub PRs, reviews them with project conventions, posts structured comments, and optionally auto-approves. Filter by label, configure poll interval.

### File Watcher (`swarm watch`)
Watches your project for file changes, automatically runs affected tests, and spawns fix agents when tests fail. Smart test selection maps source files to test files. Optional auto-commit on passing fixes.

### Codebase Explainer (`swarm explain`)
Interactive codebase Q&A — ask questions, explain files/directories, or generate full project overviews with Mermaid diagrams. Three depth levels (shallow/medium/deep).

### Database Migrations (`swarm migrate`)
AI-assisted migration generation with ORM auto-detection (Prisma, TypeORM, Knex, Drizzle, Django, SQLAlchemy, goose). Safety checks flag destructive operations, data loss risks, and large table locks.

### Deployment Pipeline (`swarm deploy`)
Deploy to staging or production using `.swarm/deploy.yaml`. Sequential step execution (build → deploy → healthcheck → smoketest) with auto-rollback on failure and failure reports.

### Cost Intelligence (`swarm stats`)
Analytics across pipeline runs: per-stage cost breakdown, weekly spend trends, success rates, and automated recommendations for cost optimization.

### Team Server (`swarm server`)
Run Swarm as a shared HTTP server with job queue, priority levels, concurrent pipeline limits, and daily team budgets.

## What Does It Cost?

Swarm uses Claude API credits through the Claude Code CLI. Here's what to expect:

| Run Type | Typical Cost | Notes |
|----------|-------------|-------|
| Single stage (analyze/architect/plan) | $0.50 – $2.00 | Quick, focused work |
| Full pipeline (all 5 stages) | $3.00 – $8.00 | Depends on feature complexity |
| Full pipeline + fix iterations | $5.00 – $15.00 | Auto-fixing test failures adds cost |

**Cost controls:**
- Default budget: **$5 per pipeline** (override with `--budget`)
- **Lean mode** (`--lean`): haiku for docs stages, default model for engineer — saves ~70%
- **Smart mode** (`--smart`): sonnet for docs, opus for engineer — best quality/cost balance
- Per-stage cost tracking in dashboard and CLI output
- Budget degradation: auto-downgrades models at 80%/90% instead of killing agents
- If you hit the budget cap, the pipeline stops — no surprise charges

```yaml
# .swarm/config.yaml — per-stage model overrides to save money
models:
  analyst: haiku        # ~$0.25 per run
  architect: sonnet     # ~$0.75 per run
  engineer: opus        # ~$2.00 per run (where quality matters most)
```

## Dashboard

```bash
swarm dashboard
```

Opens a web UI where you can:
- **Launch builds** from a simple "What do you want to build?" input
- **Quick actions** — Fix, Spike, Review, Refactor, Simplify buttons for fast workflows
- **Watch progress** through each pipeline stage in real-time with per-stage cost display
- **Lean mode toggle** — save ~70% on pipeline costs with one click
- **View results** — file diffs, test outcomes, cost breakdown
- **Browse history** of past runs
- **Spawn individual agents** with custom personas
- **Fix GitHub issues** — type `#123` in the Fix action to auto-fetch issue context

<!-- TODO: Add dashboard screenshot -->
<!-- ![Dashboard](assets/dashboard.png) -->

## Commands

```bash
# The main command — runs the full pipeline
swarm "your feature request"

# Quick workflows (no pipeline overhead)
swarm fix "login button not working"    # Direct bug fix → engineer → tests
swarm fix --issue 123                   # Fix a GitHub issue (fetches via gh CLI)
swarm review                            # Code review current git changes
swarm review 456                        # Review a GitHub PR
swarm simplify                          # Clean up changed code (dead code, duplication)
swarm spike "how does auth work here?"  # Quick read-only codebase exploration
swarm refactor "extract auth service"   # Analyze scope → apply changes → run tests

# Pipeline stages (interactive mode)
swarm analyze "Add dark mode"     # → REQUIREMENTS.md
swarm architect                    # → SPEC.md
swarm plan                         # → TASKS.md
swarm build --parallel 3           # → Code
swarm test                         # → Tests

# CI mode (headless, JSON output, exit codes)
swarm ci "feature" --json --budget 10 --timeout 30

# Project intelligence
swarm learn                        # Extract conventions from codebase
swarm learn --refresh              # Re-scan after changes
swarm explain                      # Full project overview
swarm explain src/auth/            # Explain a directory
swarm explain "how does auth?"     # Answer a codebase question
swarm stats                        # Cost analytics and recommendations
swarm stats --period 7             # Last 7 days only

# Cross-run memory
swarm memory list                  # Show stored memories
swarm memory add "note"            # Add manual memory
swarm memory clear                 # Reset all memories

# Continuous workflows
swarm watch start                  # File watcher → auto-test → auto-fix
swarm watch start --test-only      # Watch + test without auto-fix
swarm babysit-prs start            # Background PR reviewer
swarm babysit-prs status           # Review history and stats

# Database & deployment
swarm migrate "add users table"    # AI migration generation
swarm migrate "add col" --dry-run  # Plan only, no file changes
swarm deploy staging               # Deploy to staging
swarm deploy production --approve  # Deploy to production

# Team server
swarm server start                 # Run as shared HTTP server
swarm server submit "feature"      # Submit job to server
swarm server jobs                  # List queued/running jobs

# Autopilot (issue-to-PR)
swarm autopilot start --label swarm  # Watch GitHub issues
swarm autopilot status               # Queue and stats
swarm autopilot stop                 # Stop daemon

# Test generation
swarm test-gen                       # Generate tests for untested files
swarm test-gen src/ --verify         # Scope + verify

# Dependency management
swarm deps check                     # Scan outdated deps
swarm deps update --level minor      # Apply safe updates
swarm deps audit                     # Vulnerability check

# Risk scoring
swarm risk                           # Score changed files
swarm risk --fail-above 75           # CI gate

# Incident response
swarm incident respond "description" # Diagnose + fix
swarm incident history               # Past incidents

# Smart PR creation
swarm pr --risk --reviewers          # PR with risk scores + reviewers

# Health monitor
swarm health                         # Codebase health check

# PM integration
swarm pm sync --provider github      # Sync to PM tool
swarm pm import ISSUE-123            # Import ticket

# Benchmarks
swarm benchmark run                  # Run and compare
swarm benchmark baseline             # Save baseline

# Multi-repo
swarm multi-repo run "feature"       # Cross-repo feature

# Security
swarm secure                         # OWASP security scan
swarm secrets scan                   # Secret detection
swarm supply-chain check             # Dependency verification
swarm sandbox set moderate           # Agent sandboxing
swarm provenance trail               # Code provenance
swarm prompt-guard scan "text"       # Injection defense
swarm fingerprint                    # AI code tracking
swarm monitor events                 # Runtime monitoring

# Wave 3 — Autonomous Employee
swarm inbox                          # Show work queue
swarm inbox start --label swarm      # Start inbox daemon
swarm inbox add "task description"   # Add manual task
swarm standup                        # Daily status report
swarm standup --weekly               # Weekly summary
swarm journal                        # View decision journal
swarm journal analyze                # Run learning engine
swarm journal calibrate              # Calibration report
swarm scope "add authentication"     # Negotiate requirements
swarm context build                  # Build codebase index
swarm context query "how does X?"    # Query the codebase
swarm context fragile                # Show risky files
swarm pair                           # Start pairing session
swarm pair test                      # Generate tests for changes
swarm pair commit                    # Generate commit message
swarm delegate "large feature"       # Decompose into workstreams
swarm delegate status                # Workstream progress
swarm report                         # Monthly impact report
swarm report --period weekly         # Weekly report
swarm team                           # Team activity status
swarm team activity                  # Who's working on what
swarm retro                          # Self-improvement retro
swarm retro --auto-apply             # Apply recommendations

# Wave 4 — Autonomous Engineering Organization
swarm own register auth --paths "src/auth/**" --slo "coverage>=90"
swarm own list                       # Show owned surfaces
swarm own check                      # Check surface SLOs
swarm own release auth               # Release ownership
swarm architect-review               # Full architecture review
swarm architect-review --focus perf  # Focused review
swarm onboard                        # Guided onboarding tour
swarm onboard --role frontend        # Role-specific onboarding
swarm mentor "why JWT?"              # Ask contextual question
swarm mentor review                  # Educational code review
swarm mentor explain src/auth/       # Deep dive into area
swarm roadmap "migrate to microservices"  # Generate roadmap
swarm roadmap review                 # Review progress
swarm roadmap execute phase-1        # Start executing phase
swarm system map                     # Service dependency graph
swarm system check                   # Validate contracts
swarm system feature "add notifs"    # Plan cross-repo feature
swarm slo                            # Show SLOs
swarm slo add "p99" --target "<200ms"  # Add SLO
swarm slo check                      # Check all SLOs
swarm evolve scan                    # Scan for tech debt
swarm evolve work                    # Auto-fix debt items
swarm evolve report                  # Debt trend report
swarm forecast velocity              # Predict velocity
swarm forecast risk "migration"      # Risk assessment
swarm forecast cost "notifications"  # Cost estimate
swarm compliance check               # Run compliance checks
swarm compliance report --framework soc2  # Compliance report

# Utilities
swarm status                       # Show pipeline state and costs
swarm dashboard                    # Open web UI
swarm doctor                       # Check your environment
swarm init --stack react           # Manual project setup

# Multi-pipeline
swarm pipeline create <name>       # Create isolated pipeline
swarm pipeline list                # List all pipelines
swarm pipeline switch <name>       # Switch active pipeline
swarm pipeline delete <name>       # Delete pipeline and worktree
```

### Options

```bash
swarm "feature" --model opus       # Use Opus (default: Sonnet)
swarm "feature" --budget 15        # Set budget to $15 (default: $5)
swarm "feature" --budget none      # No budget limit
swarm mayday --lean                # Lean mode: haiku for docs, default for engineer (~70% cheaper)
swarm mayday --smart               # Smart mode: sonnet for docs, opus for engineer
swarm mayday --from build          # Resume from a specific stage
swarm mayday --approve             # Require approval between stages
swarm mayday --figma <url>         # Include Figma designs
```

### Multi-Pipeline Management

Run multiple pipelines in parallel, each in its own git worktree for full isolation:

```bash
swarm pipeline create auth-feature  # Create pipeline with isolated worktree
swarm pipeline create api-refactor  # Create another
swarm pipeline list                 # Show all pipelines with status and cost
swarm pipeline switch auth-feature  # Switch active pipeline
swarm pipeline delete api-refactor  # Clean up worktree and state
```

Each non-default pipeline gets its own git branch (`pipeline/{name}`) and worktree, so agents in different pipelines never conflict on files. When creating a pipeline, existing artifacts (REQUIREMENTS.md, SPEC.md, etc.) are copied to the new worktree.

Pipelines can also be managed directly from the **dashboard**:
- **Pipeline selector** dropdown (top-left header) to switch between pipelines
- **"New pipeline"** button at the bottom of the dropdown to create pipelines from the UI
- **Delete** button (trash icon) on each non-default pipeline in the dropdown
- **Compare** button in the header for side-by-side stage comparison across pipelines

### Pipeline Resume

Pipelines persist across restarts. If a pipeline is interrupted (crash, Ctrl+C, budget kill):

- Completed stages are **preserved** — they won't re-run
- Interrupted stages keep their Claude session ID for **automatic resume**
- `swarm mayday --resume` picks up from exactly where it left off
- Sessions older than 24 hours fall through to a fresh start with context summaries from prior stages

The dashboard shows a **Resume** button on errored stages that have a saved session.

### Advanced Commands

These are available but hidden from `--help` by default. Run `swarm --help --all` to see them.

```bash
swarm agent spawn <name>           # Spawn a standalone agent
swarm agent list                   # List all agents
swarm agent kill <name>            # Stop an agent
swarm evaluate                     # Run guardrail checks on artifacts
swarm audit                        # View structured event log
swarm recover                      # Restore from state backup
swarm plugin list                  # Show installed plugins
swarm telemetry [on|off|reset]     # Manage local usage stats
```

## Configuration

`swarm init` creates `.swarm/config.yaml`:

```yaml
projectName: my-project
stack: react              # react | node | go | python | rust | swift
model: sonnet             # sonnet | opus | haiku
maxBudgetUsd: 5           # Per-pipeline budget (null = no limit)
```

<details>
<summary>Full configuration reference</summary>

```yaml
projectName: my-project
stack: react
model: sonnet

# Per-stage model overrides (save money on early stages)
models:
  analyst: haiku
  architect: sonnet
  lead: sonnet
  engineer: opus
  tester: sonnet

maxBudgetUsd: 5
promptsDir: bundled        # 'bundled' or path to custom prompts

# Networking (auto-derived from project name to avoid collisions)
wsPort: 3847
dashboardPort: 3848

# Permission modes for Claude CLI
permissions:
  permissionMode: default  # default | acceptEdits | bypassPermissions | plan | auto

# E2E testing
playwright:
  baseUrl: http://localhost:3000
  testDir: e2e

# Webhooks (Slack, Discord, or generic HTTP)
webhooks:
  - url: https://hooks.slack.com/services/...
    events: [stage-complete, pipeline-done]
    format: slack

# Monorepo — scope agent work to specific packages
packages:
  - packages/api
  - packages/web

# LLM quality gate (optional, ~$0.01/artifact)
llmQualityGate: false
llmQualityThreshold: 60

# Custom plugins
plugins:
  - './plugins/custom.js'
```

</details>

## Defaults

- **Model**: Sonnet (good balance of speed and quality)
- **Budget**: $5 per pipeline run (override with `--budget`)
- **Stack**: Auto-detected from package.json, go.mod, etc.
- **Parallel agents**: 3 engineers during build stage

## Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org/)
- **Claude Code CLI** — installed and authenticated

```bash
# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Verify it's working (this will prompt for authentication if needed)
claude --version
```

> **Don't have an Anthropic account?** Sign up at [console.anthropic.com](https://console.anthropic.com). You'll need API credits to use Swarm.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `command not found: swarm` | Run `npm install -g swarm-pipeline` again, or use `npx swarm-pipeline` |
| `command not found: claude` | Run `npm install -g @anthropic-ai/claude-code` |
| `No .swarm/ directory found` | Run `swarm init` in your project, or just run `swarm "feature"` (auto-inits) |
| Pipeline stops mid-run | Check `swarm status` for cost/budget. Increase with `--budget` |
| Dashboard won't open | Port may be in use. Check `swarm doctor` or change `dashboardPort` in `.swarm/config.yaml` |
| `state.json` corrupted | Run `swarm recover` to restore from backup |
| Agent seems stuck | Agents have a 10-minute inactivity timeout (60 min during Bash commands). Run `swarm agent kill <name>` to force stop |

Run `swarm doctor` for a full environment health check — it verifies Node.js, Claude CLI, disk space, and project setup.

## Why Swarm vs. Claude Code Directly?

| | Single Claude session | Swarm pipeline |
|---|---|---|
| **Approach** | One agent does everything | 5 specialized agents with role boundaries |
| **Requirements** | Skipped or ad-hoc | Structured REQUIREMENTS.md with acceptance criteria |
| **Architecture** | Implicit | Explicit SPEC.md with ADRs and diagrams |
| **Task planning** | None | Parallelizable task groups with dependencies |
| **Testing** | Often forgotten | Automatic E2E test generation and execution |
| **Fix loop** | Manual | Auto-detects failures, targets fixes, detects regressions |
| **Cost tracking** | Hidden | Real-time per-stage cost breakdown |

## Development

```bash
git clone https://github.com/esanmohammad/swarm
cd swarm
npm install
npm run build
npm run dev              # CLI dev mode
npm run dev:dashboard    # Dashboard dev mode with HMR
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for details. Architecture docs are in [docs/](docs/).

## License

BSL 1.1 — free to use, source available. Converts to Apache 2.0 on April 2, 2030. See [LICENSE](LICENSE).
