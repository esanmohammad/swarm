# Swarm — Wave 4: Autonomous Engineering Organization

> Wave 3 made Swarm an autonomous employee — it finds work, does it, reports, and learns.
> Wave 4 makes Swarm an **engineering organization** — it manages projects, coordinates across repos, mentors junior devs, owns entire product surfaces, and operates at organizational scale.
>
> The core shift: **individual contributor → tech lead / staff engineer.** Swarm stops doing isolated tasks and starts owning outcomes across the stack.
>
> Date: 2026-04-02

---

## Analysis: What's Missing After Wave 3

### What Wave 3 Achieves
After Wave 3, Swarm can: pick up work autonomously (inbox), report status (standup), learn from mistakes (journal), negotiate scope (scope), understand the codebase deeply (context), pair with developers (pair), parallelize work (delegate), prove its value (report), coordinate with the team (awareness), and improve itself (retro).

### What's Still Missing for "Staff Engineer" Level

| Gap | Why It Matters |
|-----|----------------|
| **No cross-project ownership** | A staff engineer owns entire systems, not individual repos. Swarm can't coordinate a feature across API + frontend + mobile + infra. |
| **No architectural decision-making** | Swarm follows instructions. It doesn't say "we should migrate from REST to GraphQL because query patterns show N+1 problems." |
| **No knowledge transfer** | When a new developer joins, Swarm can't onboard them. It knows the codebase but can't teach. |
| **No proactive tech debt management** | Swarm fixes what's broken. It doesn't notice "this module has grown 10x in 6 months and needs refactoring" before it breaks. |
| **No production ownership** | Swarm deploys and responds to incidents. It doesn't own SLOs, monitor trends, or prevent incidents before they happen. |
| **No external integration intelligence** | Swarm doesn't understand third-party APIs, cloud infrastructure, or the deployment pipeline deeply enough to optimize them. |
| **No long-term planning** | Swarm does sprint-level work. It can't plan a 3-month migration or sequence a multi-phase architecture change. |

---

## Design Principles

1. **Outcome ownership, not task completion** — Wave 4 features are measured by outcomes ("API latency under 200ms") not outputs ("merged 5 PRs").
2. **Cross-cutting, not siloed** — Every feature works across repos, teams, and time horizons.
3. **Advisory as default, autonomous as earned** — New capabilities start advisory. Swarm proposes, human approves. Autonomy unlocks after proven track record (from decision journal).
4. **Organizational memory** — Swarm becomes the institutional knowledge store. When people leave, the knowledge stays.

---

## P1: `swarm own` — Surface Ownership

**Impact: 10/10** — The defining feature of a staff engineer. Own a product surface end-to-end.

### Problem
Current Swarm model: human says "do X" → Swarm does X. Staff engineer model: "you own the authentication system — keep it secure, performant, well-tested, documented, and up to date. Here are the SLOs."

### Solution
Assign Swarm ownership of a "surface" — a logical area of the product (auth, payments, API, frontend, infra). Swarm continuously monitors, maintains, and improves that surface against defined objectives.

### Tasks
- [x] Create `src/commands/own.ts` — surface ownership manager
  - [x] `swarm own auth` — Swarm takes ownership of the auth surface
  - [x] `swarm own api --slo "p99 < 200ms, error rate < 0.1%"` — with SLO targets
  - [x] `swarm own list` — show all owned surfaces
  - [x] `swarm own release auth` — release ownership
- [x] Create `src/core/surface.ts` — surface definition and monitoring
  - [x] Surface definition in `.swarm/surfaces.yaml`:
    ```yaml
    surfaces:
      auth:
        description: "User authentication and authorization"
        paths:
          - "src/auth/**"
          - "src/middleware/auth*"
          - "tests/auth/**"
        slos:
          testCoverage: ">= 90%"
          p99Latency: "<= 200ms"
          errorRate: "<= 0.1%"
          dependencyAge: "<= 6 months"
          securityFindings: "0 critical, 0 high"
        monitoring:
          grafana: "https://grafana.internal/d/auth-dashboard"
          sentry: "auth-service"
        owners:
          human: ["alice"]      # Escalation path
          swarm: true           # Swarm co-owns
        budget:
          monthly: 50.00        # Max monthly spend on this surface
      api:
        description: "REST API layer"
        paths: ["src/api/**", "src/routes/**"]
        slos:
          testCoverage: ">= 80%"
          openAPICompliance: "100%"
        # ... etc
    ```
  - [x] **Continuous monitoring loop** (runs as part of inbox daemon):
    - [x] Check SLOs against current state every 6 hours
    - [x] Coverage: parse coverage reports filtered to surface paths
    - [x] Performance: fetch from Grafana/Datadog API (if configured)
    - [x] Security: run `swarm secure` scoped to surface paths
    - [x] Dependencies: check freshness of deps used by surface
    - [x] Documentation: check if README/API docs are stale vs code changes
  - [x] **Auto-maintenance actions** (when SLO is violated or at risk):
    - [x] Coverage dropping → generate tests for uncovered paths
    - [x] Dependency outdated → run `swarm deps update` scoped to surface
    - [x] Security finding → auto-fix if possible, else create issue
    - [x] Documentation stale → regenerate API docs / update README
    - [x] Performance degrading → analyze recent changes, propose optimization
  - [x] **Proactive improvement** (weekly, within budget):
    - [x] Identify refactoring opportunities (complexity hotspots in surface)
    - [x] Propose improvements as issues or draft PRs
    - [x] Track improvements over time (surface health trend)
  - [x] **Escalation**:
    - [x] If SLO breached and auto-fix fails → notify human owner
    - [x] If budget exhausted → report and pause maintenance
    - [x] Monthly surface report → what changed, SLO status, improvements made, cost
- [x] Dashboard: "Surfaces" as primary navigation view
  - [x] Surface cards with SLO status (green/yellow/red)
  - [x] Drill-down per surface: SLO dashboard, recent changes, maintenance history
  - [x] Surface health trends over time
  - [x] Budget consumption per surface
  - [x] "Add Surface" wizard

### Cost estimate
- Monitoring: $0 (API calls + static analysis)
- Auto-maintenance: $2-10/week per surface
- Proactive improvement: $5-15/week per surface (within budget cap)

---

## P2: `swarm architect` (Autonomous) — Strategic Technical Decisions

**Impact: 9/10** — The difference between writing code and shaping the system.

### Problem
Swarm builds what it's told. A staff engineer identifies systemic issues and proposes strategic changes: "We should split this monolith because deploy times are 45 minutes and growing," or "Our REST API has N+1 query patterns everywhere — we should add a GraphQL gateway."

### Solution
Periodic architectural analysis that identifies systemic problems, proposes strategic solutions with multi-phase plans, and presents tradeoff-rich recommendations to the team.

### Tasks
- [x] Create `src/commands/architect-review.ts` — strategic architecture analysis
  - [x] `swarm architect-review` — full architectural assessment
  - [x] `swarm architect-review --focus performance|scalability|maintainability|security`
  - [x] `swarm architect-review --trigger auto` — runs monthly or when metrics cross thresholds
- [x] Create `src/core/arch-analyzer.ts` — systemic pattern detection
  - [x] **Dependency analysis**:
    - [x] Circular dependencies between modules
    - [x] God modules (too many dependents)
    - [x] Orphan modules (no dependents — dead code?)
    - [x] Layer violations (controller calling database directly)
    - [x] Coupling score: how entangled are the modules?
  - [x] **Growth pattern analysis** (from git history):
    - [x] Which modules are growing fastest?
    - [x] Are commit sizes increasing? (symptom of coupling)
    - [x] Deploy frequency and duration trends
    - [x] Merge conflict frequency by area
    - [x] Are certain areas always changing together? (should they be one module?)
  - [x] **API pattern analysis**:
    - [x] N+1 query patterns (from code analysis or access logs)
    - [x] Inconsistent API design (some endpoints REST, some RPC-style)
    - [x] Missing pagination on list endpoints
    - [x] Overfetching patterns (endpoints returning full objects when clients use 2 fields)
  - [x] **Performance pattern analysis** (if monitoring configured):
    - [x] Slow endpoints trending slower
    - [x] Memory usage growing over time
    - [x] Database query plans degrading
  - [x] **Security posture analysis**:
    - [x] Authentication patterns inconsistencies
    - [x] Authorization gaps (endpoints without access control checks)
    - [x] Secret management anti-patterns
- [x] Recommendation output: `ARCHITECTURE-REVIEW.md`
  - [x] Executive summary: 3 biggest systemic issues
  - [x] Per-issue:
    - [x] Evidence (data, trends, code examples)
    - [x] Impact if not addressed (with timeline)
    - [x] 2-3 solution options with tradeoffs
    - [x] Recommended approach with multi-phase plan
    - [x] Estimated effort (weeks, not hours)
    - [x] Risk assessment
  - [x] Prioritized action plan: what to do this quarter
- [x] Integration with surfaces:
  - [x] Recommendations scoped to owned surfaces get auto-created as issues
  - [x] Cross-surface recommendations presented to team for discussion
- [x] Dashboard: "Architecture" view
  - [x] System diagram auto-generated from dependency graph
  - [x] Issue heatmap overlaid on architecture
  - [x] Recommendation cards with accept/defer/dismiss
  - [x] Historical architecture trend (coupling score, complexity over time)

### Cost estimate
- Analysis: $1-3 per review (opus for deep analysis)
- Frequency: monthly = $1-3/month

---

## P3: `swarm onboard` — Developer Onboarding & Mentoring

**Impact: 8/10** — Institutional knowledge becomes accessible. New developers get productive 5x faster.

### Problem
When a new developer joins, they spend 2-4 weeks learning: the codebase, conventions, architecture, deployment process, common pitfalls, who owns what. This knowledge lives in people's heads. When people leave, knowledge leaves too. Swarm has deep codebase understanding (from context) and institutional memory (from journal + memory + learn) but no way to transfer it.

### Solution
An interactive onboarding system that answers questions, gives guided tours of the codebase, explains decisions, and acts as a persistent mentor for any team member.

### Tasks
- [x] Create `src/commands/onboard.ts` — interactive onboarding
  - [x] `swarm onboard` — start guided onboarding tour
  - [x] `swarm onboard --role frontend|backend|fullstack` — role-specific onboarding
  - [x] `swarm onboard --area auth` — area-specific deep dive
- [x] Onboarding flow:
  - [x] **Step 1 — Project overview**: architecture diagram, tech stack, key abstractions
  - [x] **Step 2 — Development workflow**: how to build, test, deploy, create PRs
  - [x] **Step 3 — Key areas tour**: walk through 3-5 most important modules with explanations
  - [x] **Step 4 — Conventions**: code style, patterns, do's and don'ts (from learn + memory)
  - [x] **Step 5 — Common pitfalls**: things that break, hazard zones, lessons from decision journal
  - [x] **Step 6 — First task**: suggest a good "starter" issue and offer to pair on it
  - [x] Progress tracking: resume onboarding where you left off
- [x] Create `src/commands/mentor.ts` — ongoing mentoring
  - [x] `swarm mentor "why does the auth module use JWT instead of sessions?"` — contextual questions
  - [x] `swarm mentor review` — educational code review (explains WHY, not just WHAT to fix)
  - [x] `swarm mentor explain src/billing/` — deep dive into any area
  - [x] `swarm mentor "what should I know before changing the payment flow?"` — pre-change briefing
  - [x] Answers draw from: codebase context, git history, decision journal, conventions, past incidents
  - [x] If Swarm doesn't know → says so honestly, suggests who might know (from team config)
- [x] Knowledge base auto-generation:
  - [x] `ONBOARDING.md` — auto-generated and kept current
  - [x] `ARCHITECTURE.md` — auto-generated system overview
  - [x] `CONVENTIONS.md` — auto-generated from learn + memory
  - [x] `PITFALLS.md` — auto-generated from decision journal failures
  - [x] Updated automatically when codebase index rebuilds
- [x] Dashboard: "Knowledge" view
  - [x] Interactive Q&A interface (chat-style)
  - [x] Codebase tour with guided navigation
  - [x] Knowledge base browser (searchable)
  - [x] Onboarding progress tracker per developer

### Cost estimate
- Onboarding tour generation: $0.50-1.00 (one-time)
- Mentor query: $0.05-0.20 per question
- Knowledge base update: $0.30 per rebuild

---

## P4: `swarm roadmap` — Long-Term Project Planning

**Impact: 8/10** — The jump from sprint-level thinking to quarterly/annual planning.

### Problem
Swarm does great sprint work: "here are 5 issues, go." But engineering leadership needs: "Here's a 3-month plan to migrate from monolith to microservices, broken into 6 phases, with risk mitigation, rollback points, and resource requirements." This requires understanding the full system, estimating complexity at scale, and sequencing work with dependencies.

### Tasks
- [x] Create `src/commands/roadmap.ts` — long-term planning engine
  - [x] `swarm roadmap "migrate to microservices"` — generate multi-phase plan
  - [x] `swarm roadmap "reduce build time from 15min to 2min"` — goal-oriented planning
  - [x] `swarm roadmap review` — review progress on active roadmap
  - [x] `swarm roadmap adjust` — re-plan based on actual progress vs estimates
- [x] Planning engine:
  - [x] **Goal decomposition**: break high-level goal into milestones
  - [x] **Milestone → phase**: each milestone becomes a phase with:
    - [x] Description of what changes
    - [x] Files/modules affected (from codebase index)
    - [x] Dependencies on other phases
    - [x] Risk assessment
    - [x] Estimated effort (from historical data on similar changes)
    - [x] Rollback strategy
    - [x] Definition of done
  - [x] **Dependency graph**: phases ordered by dependencies
  - [x] **Critical path analysis**: identify the bottleneck sequence
  - [x] **Risk mitigation**: for each high-risk phase, propose a de-risk step
  - [x] **Parallel workstreams**: identify phases that can run concurrently
- [x] Output: `ROADMAP.md`
  - [x] Executive summary: goal, approach, timeline, total estimated cost
  - [x] Phase-by-phase breakdown with Gantt-style timeline
  - [x] Risk register with mitigation strategies
  - [x] Success metrics per phase
  - [x] Decision points: "After Phase 2, evaluate if approach is working. If not, pivot to..."
- [x] Execution integration:
  - [x] Each phase maps to a series of inbox items
  - [x] `swarm roadmap execute phase-1` — start executing a phase
  - [x] Progress tracking: actual vs planned per phase
  - [x] Auto-adjust: re-estimate remaining phases based on actual data
  - [x] Weekly roadmap standup: "Phase 2 is 60% complete, 1 day behind estimate"
- [x] Dashboard: "Roadmap" view
  - [x] Gantt chart with phases and dependencies
  - [x] Phase detail panels with progress bars
  - [x] Risk heat map
  - [x] Actual vs planned timeline comparison
  - [x] "Start Phase" button

### Cost estimate
- Plan generation: $2-5 (opus for complex multi-phase planning)
- Progress review: $0.20 per review
- Adjustment: $0.50 per re-plan

---

## P5: Cross-Repository System Orchestration

**Impact: 9/10** — Real organizations have dozens of repos. Swarm must think in systems, not files.

### Problem
Wave 2 has basic multi-repo support. But real cross-repo work requires: understanding API contracts between services, coordinating migrations across repos, ensuring changes in one repo don't break consumers, and managing coordinated releases.

### Tasks
- [x] Create `src/core/system-graph.ts` — cross-repo system intelligence
  - [x] **Service discovery**: scan configured repos for:
    - [x] API definitions (OpenAPI specs, GraphQL schemas, protobuf files)
    - [x] Service dependencies (environment variables referencing other services, config files)
    - [x] Shared types/contracts (shared packages, generated clients)
    - [x] Deploy configurations (docker-compose, k8s manifests, terraform)
  - [x] **System graph**: map of all services, their APIs, and dependencies
  - [x] **Contract registry**: track all inter-service contracts and their versions
  - [x] Store in `.swarm/system/graph.json`
- [x] Create `src/commands/system.ts` — cross-repo operations
  - [x] `swarm system map` — display system dependency graph
  - [x] `swarm system "add user preferences"` — plan cross-repo feature
    - [x] Identify which repos need changes
    - [x] Plan changes in dependency order (shared lib → API → consumers)
    - [x] Generate coordinated PRs with cross-references
  - [x] `swarm system migrate "upgrade auth from v1 to v2"` — coordinated migration
    - [x] Analyze all consumers of the changing API
    - [x] Generate migration plan per consumer
    - [x] Execute in dependency order with rollback points
    - [x] Verify contracts after each step
  - [x] `swarm system check` — validate cross-repo contract compatibility
    - [x] Are all API consumers using the latest contract?
    - [x] Are any shared types diverged between repos?
    - [x] Are there breaking changes in unreleased code?
- [x] Contract-aware features:
  - [x] When Swarm changes an API in repo A:
    - [x] Auto-detect consumers in repos B, C
    - [x] Update generated clients if applicable
    - [x] Create PRs in consumer repos for contract changes
    - [x] Block API change PR until consumer PRs are ready
  - [x] When inbox picks up an issue:
    - [x] Automatically scope which repos are affected
    - [x] Plan work across repos, not just one
- [x] Dashboard: "System" view
  - [x] Interactive service graph with dependency arrows
  - [x] Click service → see its APIs, consumers, health
  - [x] Cross-repo PR coordination timeline
  - [x] Contract compatibility matrix

### Cost estimate
- System scan: $0.50-1.00 per run (reads API specs + configs)
- Cross-repo feature planning: $2-5 (multi-repo analysis)
- Contract checking: $0 (static analysis)

---

## P6: `swarm slo` — Production Outcome Ownership

**Impact: 8/10** — Own the outcome, not just the code.

### Problem
A staff engineer doesn't just write code — they own production outcomes. "P99 latency is under 200ms" is their responsibility. When it degrades, they don't wait for an incident — they proactively investigate, optimize, and prevent.

### Tasks
- [x] Create `src/commands/slo.ts` — SLO management
  - [x] `swarm slo` — show all SLOs and current status
  - [x] `swarm slo add "p99 latency < 200ms" --source grafana --dashboard api-latency`
  - [x] `swarm slo check` — check all SLOs against current metrics
  - [x] `swarm slo watch` — continuous SLO monitoring daemon
- [x] Create `src/core/slo-engine.ts` — SLO monitoring and response
  - [x] **Data sources**: Grafana, Datadog, CloudWatch, Prometheus (plugin architecture)
  - [x] **SLO types**: latency, error rate, availability, throughput, custom metric
  - [x] **Trend detection**: not just current value but trajectory
    - [x] "P99 is 180ms (under 200ms target) but has increased 20% in 2 weeks"
    - [x] Predictive: "At current trend, SLO will breach in ~12 days"
  - [x] **Proactive response** (when SLO at risk):
    - [x] Correlate with recent changes (git log + deploy history)
    - [x] Identify likely cause (new feature, dependency update, traffic increase)
    - [x] If code-related: propose optimization (create issue or PR)
    - [x] If infrastructure-related: flag for human (Swarm doesn't modify infra by default)
    - [x] If traffic-related: suggest scaling or caching strategies
  - [x] **Error budget tracking**:
    - [x] Monthly error budget per SLO
    - [x] Burn rate alerts: "auth service has consumed 60% of error budget with 20 days remaining"
    - [x] When budget runs low: auto-freeze non-critical changes to that surface
- [x] Integration with surfaces:
  - [x] SLOs attached to surfaces
  - [x] Surface health incorporates SLO status
  - [x] Auto-maintenance triggered by SLO degradation
- [x] Dashboard: "SLOs" view
  - [x] SLO dashboard with status cards (green/yellow/red)
  - [x] Trend charts with target lines
  - [x] Error budget burn-down
  - [x] Correlation view: SLO changes overlaid with deploy markers

### Cost estimate
- Monitoring: $0 (API calls to observability tools)
- Analysis: $0.10-0.30 per investigation (haiku for correlation)
- Optimization proposals: $1-3 (sonnet for code analysis)

---

## P7: `swarm evolve` — Proactive Tech Debt Management

**Impact: 8/10** — The work nobody prioritizes until it's too late.

### Problem
Tech debt accumulates silently. By the time anyone notices, a "quick refactor" is a 3-month project. A staff engineer tracks debt continuously and addresses it incrementally before it compounds.

### Tasks
- [x] Create `src/commands/evolve.ts` — tech debt management
  - [x] `swarm evolve scan` — analyze codebase for tech debt
  - [x] `swarm evolve plan` — generate debt reduction roadmap
  - [x] `swarm evolve work` — start working on highest-priority debt items
  - [x] `swarm evolve report` — tech debt trend report
- [x] Create `src/core/debt-analyzer.ts` — tech debt detection
  - [x] **Code quality debt**:
    - [x] Files exceeding complexity thresholds
    - [x] Duplicated code blocks (token-level similarity > 80%)
    - [x] Functions longer than N lines (configurable, default 50)
    - [x] Deep nesting (> 4 levels)
    - [x] TODO/FIXME/HACK comments (especially old ones from git blame)
    - [x] Type safety gaps (`any` types in TypeScript, `interface{}` in Go)
  - [x] **Architectural debt**:
    - [x] Modules violating intended architecture (layer violations from context)
    - [x] Circular dependencies
    - [x] God objects/modules (too many responsibilities)
    - [x] Leaky abstractions (implementation details exposed in public APIs)
  - [x] **Dependency debt**:
    - [x] Outdated dependencies (especially with security vulnerabilities)
    - [x] Deprecated APIs being used
    - [x] Multiple versions of same library
    - [x] Unused dependencies
  - [x] **Test debt**:
    - [x] Untested critical paths
    - [x] Flaky tests (from CI history)
    - [x] Slow tests (from test timing data)
    - [x] Tests testing implementation rather than behavior
  - [x] **Documentation debt**:
    - [x] Stale comments (code changed but comment didn't)
    - [x] Missing API documentation
    - [x] README outdated vs actual behavior
  - [x] Debt scoring:
    - [x] Per-item: severity (1-5) × impact area × age multiplier
    - [x] Aggregate: total debt score (lower is better)
    - [x] Trend: increasing or decreasing over time
- [x] Auto-maintenance:
  - [x] When inbox has no higher-priority work → work on debt items
  - [x] Small items (< 30 min, low risk) → auto-fix and create PR
  - [x] Medium items → create issue with analysis and fix plan
  - [x] Large items → add to roadmap as a phase
  - [x] Budget allocation: configurable % of weekly budget for debt work
  - [x] Debt burndown: track debt score over time
- [x] Dashboard: "Tech Debt" view
  - [x] Debt score gauge with trend
  - [x] Debt items table sortable by severity, type, age
  - [x] Debt heatmap overlaid on file explorer
  - [x] Burndown chart: debt score over time
  - [x] "Fix now" button for auto-fixable items

### Cost estimate
- Scan: $0 (static analysis)
- LLM-enhanced analysis: $0.50-1.00 per scan
- Auto-fixes: $0.10-0.50 per item
- Monthly debt management: $10-30

---

## P8: `swarm forecast` — Engineering Intelligence

**Impact: 7/10** — Data-driven engineering decisions at the organizational level.

### Problem
Engineering leadership makes decisions based on gut feeling: "Is the codebase getting better or worse? Are we shipping faster or slower? Where should we invest engineering time?" Swarm has enough data to answer these questions empirically.

### Tasks
- [x] Create `src/commands/forecast.ts` — engineering intelligence
  - [x] `swarm forecast velocity` — predict next sprint velocity based on historical data
  - [x] `swarm forecast risk "planned migration"` — risk assessment for planned work
  - [x] `swarm forecast cost "add notifications system"` — estimate cost before starting
  - [x] `swarm forecast health` — predict codebase health trends
- [x] Create `src/core/forecasting.ts` — predictive analytics engine
  - [x] **Velocity forecasting**:
    - [x] Historical: items completed per week (from activity tracker)
    - [x] Seasonal: account for holidays, crunch periods, team changes
    - [x] Confidence intervals: "next week: 8-12 items (80% confidence)"
  - [x] **Cost estimation**:
    - [x] Per-feature: based on similar past features (from memory + journal)
    - [x] Factors: codebase area, complexity, risk, tests required
    - [x] Accuracy tracking: compare estimates vs actuals, improve over time
  - [x] **Risk prediction**:
    - [x] For a planned change: predict likelihood of: test failure, revert, incident
    - [x] Based on: area risk (from journal), complexity (from context), coverage (from index)
    - [x] "This migration has a 35% chance of causing a production incident based on 3 similar past changes"
  - [x] **Health projection**:
    - [x] Extrapolate debt trends: "at current pace, complexity score will double in 6 months"
    - [x] Coverage projection: "test coverage is declining 0.5%/week"
    - [x] Dependency risk: "3 critical dependencies will be EOL within 12 months"
  - [x] **What-if analysis**:
    - [x] "If we hire 2 more engineers, how does velocity change?"
    - [x] "If we spend 20% of budget on debt, when does debt score stabilize?"
    - [x] "If we don't update dependency X, what's the security exposure timeline?"
- [x] Dashboard: "Intelligence" view
  - [x] Velocity chart with forecast cone
  - [x] Cost estimation calculator (input: feature description → output: cost range)
  - [x] Risk radar: upcoming planned work with risk indicators
  - [x] Health projection dashboard with intervention recommendations

### Cost estimate
- Forecasting: $0.10-0.30 per analysis (haiku for pattern matching)
- What-if: $0.20-0.50 per scenario

---

## P9: `swarm compliance` — Regulatory & Policy Automation

**Impact: 7/10** — Required for enterprise adoption. Swarm as compliance officer.

### Problem
Regulated industries (finance, healthcare, government) have compliance requirements that are checked quarterly by auditors. These checks are mechanical and repetitive. An autonomous employee in a regulated environment must understand and enforce compliance continuously.

### Tasks
- [x] Create `src/commands/compliance.ts` — compliance automation
  - [x] `swarm compliance check` — run all configured compliance checks
  - [x] `swarm compliance report --framework soc2|hipaa|gdpr|pci` — generate compliance report
  - [x] `swarm compliance monitor` — continuous compliance monitoring
- [x] Compliance frameworks (templates):
  - [x] **SOC 2**: access controls, change management, monitoring, incident response
  - [x] **HIPAA**: data encryption, access logging, audit trails, data handling
  - [x] **GDPR**: data mapping, consent tracking, deletion capabilities, privacy by design
  - [x] **PCI DSS**: cardholder data handling, encryption, access control, vulnerability management
  - [x] Custom: define own compliance checks in `.swarm/compliance.yaml`
- [x] Automated checks:
  - [x] All AI-generated code has provenance (from Wave 2 S5)
  - [x] All changes have audit trail (from existing audit log)
  - [x] All secrets are in environment variables (from Wave 2 S3)
  - [x] All dependencies are known and vulnerability-free (from Wave 2 S2)
  - [x] All PRs have been reviewed before merge
  - [x] All deployments have rollback capability
  - [x] Data handling patterns comply with framework requirements
  - [x] Access control patterns are consistent and complete
- [x] Report generation:
  - [x] Auditor-friendly format (PDF with evidence links)
  - [x] Evidence collection: automatically gather git logs, PR reviews, test results, security scans
  - [x] Gap analysis: what's compliant, what's not, what needs work
  - [x] Remediation plan for gaps
- [x] Dashboard: "Compliance" view
  - [x] Framework compliance dashboard with check/X per requirement
  - [x] Evidence links per check
  - [x] Trend: compliance posture over time
  - [x] Export for auditors

### Cost estimate
- Compliance checking: $0 (static checks + existing data)
- Report generation: $0.50-1.00 (sonnet for analysis and writing)

---

## P10: Swarm Platform — Extensibility & Ecosystem

**Impact: 7/10** — Swarm becomes a platform, not just a product.

### Problem
Every organization has unique workflows: custom deploy processes, specific testing requirements, internal tools, proprietary APIs. Swarm can't hard-code every possible integration. It needs a platform model where teams build custom extensions.

### Tasks
- [x] Extend existing plugin system:
  - [x] **Plugin types**:
    - [x] `source` plugins: new work sources for inbox (Asana, Monday, custom webhooks)
    - [x] `action` plugins: new capabilities (custom deploy, internal API calls)
    - [x] `check` plugins: new quality/security checks
    - [x] `reporter` plugins: new reporting destinations (Confluence, Google Docs)
    - [x] `monitor` plugins: new data sources for SLOs (custom metrics, internal dashboards)
  - [x] Plugin SDK:
    ```typescript
    export interface SwarmPlugin {
      name: string;
      type: 'source' | 'action' | 'check' | 'reporter' | 'monitor';
      init(config: PluginConfig): Promise<void>;
      // Type-specific methods...
    }
    ```
  - [x] Plugin registry: `swarm plugin search`, `swarm plugin install`, `swarm plugin publish`
  - [x] Plugin marketplace (future): community-built plugins
- [x] **Agent SDK**: allow teams to create custom agents with specialized personas
  - [x] Define custom pipeline stages
  - [x] Custom guardrails per stage
  - [x] Custom quality scoring dimensions
  - [x] Example: "Security Reviewer" agent that runs after every build
- [x] **API**: expose Swarm capabilities via REST API
  - [x] `POST /api/queue` — add work item to inbox
  - [x] `GET /api/status` — get current status
  - [x] `POST /api/run` — trigger a specific command
  - [x] `GET /api/report` — get latest report
  - [x] Auth: API key per team
  - [x] Use case: integrate Swarm into existing CI/CD, chatbots, internal tools
- [x] Dashboard: "Plugins" management view

### Cost estimate
- Plugin infrastructure: development effort only
- API server: extends existing swarm server

---

## Implementation Order

| # | Feature | Impact | Effort | Dependencies | Phase |
|---|---------|--------|--------|-------------|-------|
| P1 | `swarm own` — Surface ownership | 10/10 | 3 weeks | inbox, context, security (W2-3) | Week 1-3 |
| P2 | Autonomous architect review | 9/10 | 2 weeks | context, codebase index | Week 2-4 |
| P5 | Cross-repo orchestration | 9/10 | 3 weeks | multi-repo (W2) | Week 3-6 |
| P3 | `swarm onboard` — Mentoring | 8/10 | 2 weeks | context, journal, learn | Week 4-6 |
| P4 | `swarm roadmap` — Long-term planning | 8/10 | 2 weeks | delegate, forecast | Week 5-7 |
| P6 | `swarm slo` — Production ownership | 8/10 | 2 weeks | own, monitoring plugins | Week 6-8 |
| P7 | `swarm evolve` — Tech debt mgmt | 8/10 | 2 weeks | context, inbox, health (W2) | Week 7-9 |
| P8 | `swarm forecast` — Eng intelligence | 7/10 | 2 weeks | activity tracker, journal | Week 8-10 |
| P9 | `swarm compliance` — Regulatory | 7/10 | 2 weeks | provenance, audit (W2) | Week 9-11 |
| P10 | Platform & ecosystem | 7/10 | 3 weeks | plugin system (existing) | Week 10-13 |

---

## The Full Picture: Wave 1 → Wave 4

| Wave | Identity | Core Capability | Metaphor |
|------|----------|----------------|----------|
| **Wave 1** | AI code generator | 5-stage pipeline, MayDay, dashboard | Intern |
| **Wave 2** | AI engineering teammate | Autopilot, test-gen, deps, security, incident response | Junior engineer |
| **Wave 3** | Autonomous employee | Inbox, standup, journal, scope, context, pair, delegate | Mid-level engineer |
| **Wave 4** | Engineering organization | Surface ownership, architecture, mentoring, roadmap, SLOs, tech debt, forecasting | Staff/Principal engineer |

### What "Staff Engineer Swarm" Looks Like

```
Organization: Acme Corp
Swarm manages: 4 repos (api, web, mobile, shared-lib)
Swarm owns: auth surface, API surface, test infrastructure

Monday morning:
  → Weekly architect review: "API coupling score increased 15%. Module X should be extracted. Phase 1 plan attached."
  → SLO alert: "auth p99 trending up (175ms → 190ms). Correlated with last week's session cache change. Fix PR created."
  → Tech debt update: "Resolved 3 debt items (dead code removal, flaky test fix, deprecated API migration). Debt score: 72 → 68."
  → Inbox processing: 5 issues triaged, 3 started, 2 waiting for human input
  → New developer onboarding: walked @charlie through the payment flow, answered 8 questions

Cost: $180/month
Equivalent to: ~40 engineering hours/month saved
ROI: 8.3x
```

---

## Open Questions for Wave 4

1. **Trust calibration**: How much production access should Swarm have? Read-only monitoring vs. auto-scaling vs. auto-rollback?
2. **Organizational politics**: How do you introduce "Swarm owns auth" without engineers feeling replaced? Positioning as "co-owner" vs "owner"?
3. **Liability**: Who's responsible when Swarm's auto-merged code causes an incident? The person who configured the confidence threshold? The team lead who gave Swarm surface ownership?
4. **Cost ceiling**: At what monthly spend does Swarm stop being cost-effective? Depends on team size + feature velocity.
5. **Model dependency**: Swarm's value is tied to Claude's capabilities. How to hedge against model regression or API changes?
