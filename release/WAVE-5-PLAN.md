# Swarm — Wave 5: Product-Aware Engineering Intelligence

> Wave 4 made Swarm a staff engineer — it owns surfaces, makes architectural decisions, mentors developers, and manages tech debt.
> Wave 5 makes Swarm **product-aware** — it understands business impact, observes production behavior, runs experiments, optimizes performance, and improves itself.
>
> The core shift: **engineer who writes code → engineering leader who understands the business.**
>
> Date: 2026-04-02

---

## Analysis: What's Missing After Wave 4

### What Wave 4 Achieves
After Wave 4, Swarm can: own product surfaces with SLOs, make strategic architecture decisions, onboard and mentor developers, plan multi-month roadmaps, monitor production outcomes, manage tech debt proactively, forecast engineering metrics, enforce compliance, and extend via plugins.

### What's Still Missing for "Engineering Leader" Level

| Gap | Why It Matters |
|-----|----------------|
| **No production observability intelligence** | Swarm deploys code but can't correlate deployments with metric changes, predict incidents, or understand production behavior patterns. |
| **No experimentation framework** | Swarm ships features but never knows if they worked. No A/B testing, feature flags, or success metric tracking. |
| **No self-improvement** | Swarm makes the same quality of decisions in month 12 as month 1. It doesn't learn which strategies work best for this codebase. |
| **No performance optimization** | Swarm writes correct code but doesn't profile, optimize, or understand runtime characteristics. |
| **No business impact awareness** | Swarm can't say "this refactor saved $140K/year in infrastructure costs" or "this feature increased conversion 12%." |
| **No multi-team coordination** | Each Swarm instance is isolated. No knowledge sharing, cross-team dependency management, or organizational budgeting. |
| **No API lifecycle management** | Swarm changes APIs but doesn't manage versioning, breaking changes, SDK generation, or consumer coordination. |
| **No pre-merge production simulation** | Changes are tested in CI but never simulated against production traffic patterns. |

---

## Design Principles

1. **Close the feedback loop** — Every code change should connect to a measurable outcome. Build → deploy → measure → learn → improve.
2. **Production is the source of truth** — Logs, traces, metrics, and user behavior contain more insight than code review alone.
3. **Compounding intelligence** — Swarm should get measurably better every month. Self-improvement is not optional.
4. **Business language** — Engineering work must translate to business outcomes. Cost saved, revenue impact, time-to-market.
5. **Fleet thinking** — Design for multiple Swarm instances sharing knowledge across an organization.

---

## P1: `swarm observe` — Full-Stack Observability Intelligence

**Impact: 10/10** — The foundation. Everything else in Wave 5 depends on understanding production behavior.

### Problem
Swarm deploys code and responds to incidents. But it has no continuous understanding of how code behaves in production. It can't answer: "Did last Tuesday's deploy cause the latency increase?" or "Is the memory leak getting worse?" or "What's the normal error rate for the auth service?"

### Solution
Ingest observability data (logs, metrics, traces) and build a production behavior model that correlates code changes with metric changes, detects anomalies before they become incidents, and provides production context to every engineering decision.

### Tasks
- [ ] Create `src/core/observability.ts` — observability data ingestion
  - [ ] **Data source adapters** (plugin architecture):
    - [ ] Grafana: query dashboards and alerting rules via HTTP API
    - [ ] Datadog: metrics, traces, logs via DD API
    - [ ] CloudWatch: AWS metrics and logs
    - [ ] Prometheus: direct PromQL queries
    - [ ] OpenTelemetry: OTLP receiver for direct trace/metric ingestion
    - [ ] Custom: webhook receiver for arbitrary metric pushes
  - [ ] **Metric store**: `.swarm/observability/metrics.jsonl`
    - [ ] Time-series storage (downsampled: 1min → 5min → 1hr → 1day)
    - [ ] Keep 90 days of hourly data, 2 years of daily data
    - [ ] Automatic cleanup of old data
  - [ ] **Deploy markers**: correlate `git log` / deploy tags with metric timeline
    - [ ] Parse deploy events from: git tags, GitHub deployments API, CI/CD webhooks
    - [ ] Annotate metric timeline with deploy markers
- [ ] Create `src/core/anomaly-detector.ts` — anomaly detection engine
  - [ ] **Baseline learning**: establish normal ranges for each metric
    - [ ] Time-of-day patterns (weekday vs weekend, business hours vs off-hours)
    - [ ] Seasonal patterns (monthly billing cycles, holiday traffic)
    - [ ] Growth trends (gradual increase in traffic is normal)
  - [ ] **Change detection**: identify when metrics deviate from baseline
    - [ ] Statistical: z-score based alerting (configurable sigma threshold)
    - [ ] Derivative: rate of change exceeds historical norms
    - [ ] Correlation: simultaneous changes in multiple metrics
  - [ ] **Deploy correlation**: when anomaly detected, automatically check
    - [ ] Was there a deploy within the anomaly window?
    - [ ] What files/functions changed in that deploy?
    - [ ] Have similar changes caused similar anomalies before?
    - [ ] Confidence score: "85% likely caused by deploy abc123"
  - [ ] **Predictive alerting**:
    - [ ] Trend extrapolation: "memory usage will exceed limit in ~4 hours at current rate"
    - [ ] Pattern matching: "this metric pattern preceded incidents 3 times in the last month"
    - [ ] Capacity forecasting: "at current growth rate, database connections will saturate in 2 weeks"
- [ ] Create `src/commands/observe.ts` — observability commands
  - [ ] `swarm observe setup` — configure data sources
    ```yaml
    # .swarm/observability.yaml
    sources:
      grafana:
        url: "https://grafana.internal"
        apiKey: "$SWARM_GRAFANA_API_KEY"
        dashboards:
          - uid: "api-latency"
            metrics: ["p50", "p99", "error_rate"]
          - uid: "auth-service"
            metrics: ["login_success_rate", "token_refresh_rate"]
      datadog:
        apiKey: "$SWARM_DD_API_KEY"
        appKey: "$SWARM_DD_APP_KEY"
        metrics:
          - "aws.ec2.cpuutilization"
          - "custom.api.request_duration"
    alerting:
      sigma: 3            # Standard deviations for anomaly detection
      cooldown: 30        # Minutes between alerts for same metric
      channels:
        - type: webhook
          url: "$SWARM_ALERT_WEBHOOK"
    ```
  - [ ] `swarm observe status` — show data source health and metric counts
  - [ ] `swarm observe query "p99 latency last 7 days"` — natural language metric queries
  - [ ] `swarm observe correlate <deploy-sha>` — show metric changes after a specific deploy
  - [ ] `swarm observe anomalies` — show current and recent anomalies
  - [ ] `swarm observe predict` — show predictive alerts and capacity forecasts
  - [ ] `swarm observe watch` — continuous monitoring daemon (integrates with inbox)
- [ ] Integration with existing features:
  - [ ] **Surface ownership (W4 P1)**: SLO checking uses real observability data instead of static analysis
  - [ ] **Incident response (W2 P5)**: automatic metric context attached to every incident
  - [ ] **PR creation (W2 P6)**: deploy risk assessment includes historical metric impact
  - [ ] **Autopilot (W2 P1)**: post-merge metric monitoring — auto-revert if anomaly detected
- [ ] Dashboard: "Observe" view
  - [ ] Metric timeline with deploy markers
  - [ ] Anomaly highlights with correlation explanations
  - [ ] Predictive alerts panel
  - [ ] Deploy impact analysis (select deploy → see metric changes)
  - [ ] Natural language query bar

### Cost estimate
- Data ingestion: $0 (API calls to existing observability tools)
- Anomaly detection: $0 (statistical, runs locally)
- LLM correlation analysis: $0.05-0.10 per anomaly (haiku for pattern matching)
- Predictive alerting: $0 (statistical extrapolation)

---

## P2: `swarm experiment` — A/B Testing & Feature Flag Automation

**Impact: 10/10** — Closes the build → measure → learn loop. The difference between shipping features and shipping outcomes.

### Problem
Swarm ships code. But "code shipped" ≠ "value delivered." Did the login redesign improve conversion? Did the new search algorithm find better results? Without experimentation, every feature is a guess. Most teams skip A/B testing because it's too much work to set up.

### Solution
Automatically wrap new features in feature flags, define success metrics, manage gradual rollout, monitor experiment results, and make data-driven ship/revert decisions.

### Tasks
- [ ] Create `src/core/experiment-engine.ts` — experimentation framework
  - [ ] **Feature flag integration**:
    - [ ] LaunchDarkly adapter
    - [ ] Unleash adapter
    - [ ] Growthbook adapter
    - [ ] Built-in: simple `.swarm/flags.yaml` for teams without a flag service
  - [ ] **Experiment definition**:
    ```yaml
    experiments:
      new-login-flow:
        flag: "login-redesign"
        hypothesis: "New login flow will increase conversion rate"
        metrics:
          primary: "login_success_rate"
          secondary: ["time_to_login", "support_tickets_login"]
          guardrail: ["error_rate", "p99_latency"]
        targeting:
          percentage: 10          # Start at 10%
          rampSchedule: [10, 25, 50, 100]  # Ramp over days
        duration: 14              # Days minimum
        minSampleSize: 1000
        significanceLevel: 0.05
    ```
  - [ ] **Experiment lifecycle**:
    - [ ] Create: define hypothesis, metrics, targeting
    - [ ] Start: enable flag for target percentage
    - [ ] Monitor: track metrics for control vs treatment
    - [ ] Analyze: statistical significance testing (chi-squared, t-test)
    - [ ] Ramp: increase percentage if metrics are positive
    - [ ] Decide: auto-recommend ship/kill based on results
    - [ ] Ship: remove flag, clean up experiment code
  - [ ] **Auto-flag insertion**:
    - [ ] When Swarm builds a new feature, automatically wrap entry points in feature flags
    - [ ] Generate flag cleanup PR when experiment concludes
  - [ ] **Guardrail monitoring**:
    - [ ] If guardrail metric degrades (error rate up, latency up): auto-pause experiment
    - [ ] Alert human owner for review
    - [ ] Auto-revert if critical guardrail breached
- [ ] Create `src/commands/experiment.ts`
  - [ ] `swarm experiment create "new login flow"` — define experiment interactively
  - [ ] `swarm experiment start <name>` — begin rollout
  - [ ] `swarm experiment status` — show all active experiments with current metrics
  - [ ] `swarm experiment analyze <name>` — statistical analysis and recommendation
  - [ ] `swarm experiment ship <name>` — conclude experiment, ship to 100%, create cleanup PR
  - [ ] `swarm experiment kill <name>` — revert experiment, disable flag
  - [ ] `swarm experiment history` — past experiments with outcomes
- [ ] Dashboard: "Experiments" view
  - [ ] Active experiments with live metrics (control vs treatment)
  - [ ] Statistical significance indicators
  - [ ] Ramp schedule timeline
  - [ ] Guardrail status indicators
  - [ ] Ship/kill decision buttons
  - [ ] Experiment history with ROI tracking

### Cost estimate
- Flag management: $0 (API calls to flag service)
- Metric analysis: $0 (statistical, runs locally)
- Experiment creation: $0.50-1.00 (sonnet for flag insertion and metric definition)
- Cleanup PR: $0.50-1.00

---

## P3: Self-Improving Agent Loop

**Impact: 9/10** — Compounding returns. The earlier this ships, the more benefit it accumulates.

### Problem
Swarm makes the same quality of decisions in month 12 as month 1. It doesn't learn that "for this codebase, starting with tests before implementation produces better results" or "opus is overkill for routine fixes — haiku suffices." Human engineers get better with experience. Swarm should too.

### Solution
A meta-learning system that analyzes Swarm's own performance across runs, identifies patterns in what works and what doesn't, and automatically adjusts strategies, model selection, and prompts.

### Tasks
- [ ] Create `src/core/self-improvement.ts` — meta-learning engine
  - [ ] **Performance tracking** (per run):
    - [ ] Predicted vs actual cost
    - [ ] Predicted vs actual duration
    - [ ] Test pass rate on first attempt
    - [ ] Fix loop iterations needed
    - [ ] Human edit rate after merge (how much did human change Swarm's output?)
    - [ ] Revert rate (was the PR reverted?)
    - [ ] Post-merge incident rate (did the change cause problems?)
  - [ ] **Strategy analysis**:
    - [ ] Which pipeline configuration produces best results per task type?
    - [ ] Is lean mode quality sufficient for bug fixes? For new features?
    - [ ] Do parallel engineers produce better results than sequential?
    - [ ] Which model performs best per persona/stage?
    - [ ] Does codebase context injection improve or hurt output?
    - [ ] Does convention injection measurably improve code style compliance?
  - [ ] **Prompt effectiveness**:
    - [ ] Track which system prompt variations produce higher test pass rates
    - [ ] A/B test prompt variants across runs (with human opt-in)
    - [ ] Identify prompt anti-patterns (instructions that are consistently ignored)
  - [ ] **Auto-tuning**:
    - [ ] Model selection: auto-downgrade to cheaper model for task types where quality is equivalent
    - [ ] Strategy selection: auto-choose pipeline configuration based on task type
    - [ ] Prompt refinement: adjust system prompts based on effectiveness data
    - [ ] Budget prediction: improve cost estimates based on historical accuracy
  - [ ] **Self-assessment report** (monthly):
    - [ ] Accuracy metrics: prediction accuracy trends
    - [ ] Quality metrics: test pass rate, human edit rate, revert rate trends
    - [ ] Efficiency metrics: cost per successful feature, time per fix
    - [ ] Improvement recommendations: "Switch analyst to haiku (saves 40%, no quality loss)"
    - [ ] Confidence tracking: which task types is Swarm confident on vs uncertain?
- [ ] Create `src/commands/improve.ts`
  - [ ] `swarm improve analyze` — run self-analysis on last N runs
  - [ ] `swarm improve report` — generate self-assessment report
  - [ ] `swarm improve apply` — apply recommended tuning changes
  - [ ] `swarm improve reset` — revert to default configuration
- [ ] Integration with existing features:
  - [ ] **Journal (W3)**: self-improvement insights written to decision journal
  - [ ] **Stats (W2)**: enhanced with prediction accuracy tracking
  - [ ] **Inbox (W3)**: task type classification improves model/strategy selection
- [ ] Dashboard: "Self-Improvement" view
  - [ ] Performance trend charts (accuracy, quality, efficiency)
  - [ ] Strategy comparison table
  - [ ] Active tuning configuration
  - [ ] Monthly self-assessment summary

### Cost estimate
- Analysis: $0 (statistical analysis of existing run data)
- Self-assessment report: $0.50 (sonnet for narrative generation)
- Auto-tuning: $0 (configuration changes)

---

## P4: `swarm optimize` — AI-Driven Performance Optimization

**Impact: 9/10** — High-value work that humans deprioritize because it's hard. AI can profile → analyze → fix → verify automatically.

### Tasks
- [ ] Create `src/core/perf-analyzer.ts` — performance analysis engine
  - [ ] **Profiling integration**:
    - [ ] Node.js: V8 CPU profiler, heap snapshots
    - [ ] Go: pprof integration
    - [ ] Python: cProfile, memory_profiler
    - [ ] Browser: Lighthouse CI, Web Vitals
  - [ ] **Hot path detection**: identify functions consuming >10% of CPU or memory
  - [ ] **Query analysis**: detect N+1 queries, missing indexes, full table scans
  - [ ] **Bundle analysis**: tree-shaking opportunities, large dependencies, code splitting
  - [ ] **Memory leak detection**: growing heap patterns, unreleased references
- [ ] Create `src/commands/optimize.ts`
  - [ ] `swarm optimize profile` — run profiler and analyze results
  - [ ] `swarm optimize "reduce API latency"` — goal-directed optimization
  - [ ] `swarm optimize bundle` — analyze and optimize bundle size
  - [ ] `swarm optimize queries` — find and fix slow database queries
  - [ ] `swarm optimize memory` — detect and fix memory leaks
  - [ ] All optimizations: benchmark before/after, only merge if measurable improvement
- [ ] Integration with observe:
  - [ ] Use production profiling data (from APM) to identify real hot paths
  - [ ] Prioritize optimizations by production impact (not just code analysis)

### Cost estimate
- Profiling: $0 (runs existing tools)
- Analysis: $0.50-1.00 per analysis
- Fix generation: $1-3 per optimization
- Verification: $0 (runs existing benchmarks)

---

## P5: `swarm impact` — Business Impact Analysis

**Impact: 8/10** — Makes the business case for every engineering decision. Justifies Swarm's own existence.

### Tasks
- [ ] Create `src/core/impact-analyzer.ts` — business impact engine
  - [ ] **Metric connectors**: revenue dashboards, conversion funnels, user analytics
    - [ ] Google Analytics
    - [ ] Mixpanel / Amplitude
    - [ ] Stripe (revenue metrics)
    - [ ] Custom: webhook or API endpoint
  - [ ] **Impact estimation**:
    - [ ] Performance → business: "300ms faster page load → +2.1% conversion → $X/year"
    - [ ] Reliability → business: "99.9% → 99.95% uptime → X fewer affected users/month"
    - [ ] Developer productivity → business: "30% faster deploys → X more features/quarter"
  - [ ] **ROI tracking**:
    - [ ] Track Swarm's own impact: cost of Swarm vs value delivered
    - [ ] Per-feature: cost to build vs measured business impact
    - [ ] Per-fix: cost of bug vs cost of fix
- [ ] Create `src/commands/impact.ts`
  - [ ] `swarm impact "last quarter"` — business impact summary
  - [ ] `swarm impact estimate "add recommendation engine"` — predict impact before building
  - [ ] `swarm impact roi` — Swarm's own ROI calculation
- [ ] Dashboard: "Impact" view
  - [ ] Business metric timeline with code change markers
  - [ ] ROI dashboard for Swarm
  - [ ] Per-feature impact cards

### Cost estimate
- Metric ingestion: $0
- Impact analysis: $0.20-0.50 per analysis
- Report generation: $0.50

---

## P6: `swarm fleet` — Multi-Team Swarm Orchestration

**Impact: 8/10** — Enterprise scale. One Swarm per team, one fleet manager for the org.

### Tasks
- [ ] Create `src/commands/fleet.ts` — fleet management
  - [ ] `swarm fleet register` — register this Swarm instance with fleet
  - [ ] `swarm fleet status` — show all Swarm instances across org
  - [ ] `swarm fleet budget` — set/view organization-wide budget allocation
  - [ ] `swarm fleet knowledge sync` — share learnings across instances
- [ ] **Fleet server**: central coordination service
  - [ ] Instance registry with health checks
  - [ ] Budget management: org-wide cap, per-team allocation
  - [ ] Knowledge graph: solutions discovered by team A available to team B
  - [ ] Cross-team dependency alerts: "Team A changed the auth API — teams B, C, D affected"
  - [ ] Aggregate reporting: org-wide engineering intelligence

### Cost estimate
- Fleet server: hosting cost only
- Knowledge sync: $0.10 per sync

---

## P7: Enhanced Migrations — Zero-Downtime Large-Scale

**Impact: 8/10** — Saves quarters of engineering time on major migrations.

### Tasks
- [ ] Enhance existing `swarm migrate` with:
  - [ ] **Multi-phase execution**: dual-write → shadow traffic → gradual cutover → cleanup
  - [ ] **Framework migrations**: auto-detect and execute (e.g., Express → Fastify, class components → hooks)
  - [ ] **Database migrations**: schema changes with backfill orchestration, zero-downtime
  - [ ] **Canary analysis**: at each phase, compare old vs new path metrics
  - [ ] **Rollback automation**: instant rollback at any phase
  - [ ] **Progress tracking**: per-phase completion with estimated time remaining

### Cost estimate
- Migration planning: $2-5
- Per-phase execution: $1-3
- Canary analysis: $0 (metric comparison)

---

## P8: `swarm contract` — API Lifecycle Management

**Impact: 8/10** — The #1 pain point in microservice architectures.

### Tasks
- [ ] Create `src/core/api-lifecycle.ts`
  - [ ] **Schema generation**: auto-generate OpenAPI/GraphQL schemas from code
  - [ ] **Breaking change detection**: compare schema versions, flag breaking changes
  - [ ] **Consumer impact**: which services consume which APIs? What breaks?
  - [ ] **SDK generation**: auto-generate typed clients when API changes
  - [ ] **Versioning**: auto-manage API versioning (semver, URL-based, header-based)
- [ ] Create `src/commands/contract.ts`
  - [ ] `swarm contract generate` — generate API schema from code
  - [ ] `swarm contract check` — detect breaking changes
  - [ ] `swarm contract publish` — publish schema to registry
  - [ ] `swarm contract sdk` — generate client SDKs
  - [ ] `swarm contract migrate` — coordinate API version migration across consumers

### Cost estimate
- Schema generation: $0.50-1.00
- Breaking change detection: $0 (static analysis)
- SDK generation: $0.50 per client

---

## P9: `swarm simulate` — Pre-Merge Production Simulation

**Impact: 7/10** — Catches issues that CI can't.

### Tasks
- [ ] Create `src/core/simulator.ts`
  - [ ] **Traffic replay**: replay production traffic patterns against new code
  - [ ] **Resource prediction**: estimate memory, CPU, DB queries for new code paths
  - [ ] **Scale simulation**: "at 10x current traffic, this endpoint would..."
  - [ ] **Dependency failure simulation**: "if Redis is down, this code path..."
- [ ] Create `src/commands/simulate.ts`
  - [ ] `swarm simulate` — simulate current changes against production traffic
  - [ ] `swarm simulate scale 10x` — simulate at 10x traffic
  - [ ] `swarm simulate chaos "redis-down"` — simulate dependency failure
- [ ] Integration with PR creation:
  - [ ] Auto-run simulation on every PR
  - [ ] Block merge if simulation predicts regression

### Cost estimate
- Traffic analysis: $0 (from observability data)
- Simulation: $0.20-0.50 per run
- Report: $0.10

---

## P10: `swarm teach` — Custom Model Fine-Tuning Pipeline

**Impact: 7/10** — Long-term cost optimization. 80% cheaper routine operations.

### Tasks
- [ ] Create `src/core/training-pipeline.ts`
  - [ ] **Data collection**: approved PRs, human-edited Swarm output, high-quality code
  - [ ] **Dataset curation**: filter by quality signals (test pass, no revert, no human edits)
  - [ ] **Fine-tuning jobs**: submit to Claude fine-tuning API (when available) or open-source models
  - [ ] **Evaluation**: benchmark fine-tuned vs base model on task suite
  - [ ] **Gradual rollout**: use fine-tuned for low-risk tasks, base for high-risk
- [ ] Create `src/commands/teach.ts`
  - [ ] `swarm teach collect` — gather training data from history
  - [ ] `swarm teach train` — submit fine-tuning job
  - [ ] `swarm teach evaluate` — benchmark fine-tuned model
  - [ ] `swarm teach deploy` — use fine-tuned model for routine tasks

### Cost estimate
- Data collection: $0
- Fine-tuning: depends on provider ($10-100 per job)
- Long-term savings: 60-80% cost reduction on routine tasks

---

## Implementation Order

| # | Feature | Impact | Effort | Dependencies | Phase |
|---|---------|--------|--------|-------------|-------|
| P1 | `swarm observe` — Observability | 10/10 | 3 weeks | SLOs (W4) | Week 1-3 |
| P2 | `swarm experiment` — A/B testing | 10/10 | 3 weeks | observe, flags | Week 2-5 |
| P3 | Self-improving loop | 9/10 | 2 weeks | stats, history | Week 3-5 |
| P4 | `swarm optimize` — Performance | 9/10 | 2 weeks | observe, benchmark (W2) | Week 5-7 |
| P5 | `swarm impact` — Business impact | 8/10 | 2 weeks | observe, experiment | Week 6-8 |
| P6 | `swarm fleet` — Multi-team | 8/10 | 3 weeks | server (W1) | Week 7-10 |
| P7 | Enhanced migrations | 8/10 | 2 weeks | observe | Week 8-10 |
| P8 | `swarm contract` — API lifecycle | 8/10 | 2 weeks | multi-repo (W2) | Week 9-11 |
| P9 | `swarm simulate` — Simulation | 7/10 | 2 weeks | observe | Week 10-12 |
| P10 | `swarm teach` — Fine-tuning | 7/10 | 2 weeks | self-improvement | Week 11-13 |

---

## The Full Picture: Wave 1 → Wave 5

| Wave | Identity | Core Capability | Metaphor |
|------|----------|----------------|----------|
| **Wave 1** | AI code generator | 5-stage pipeline, MayDay, dashboard | Intern |
| **Wave 2** | AI engineering teammate | Autopilot, test-gen, deps, security, incident response | Junior engineer |
| **Wave 3** | Autonomous employee | Inbox, standup, journal, scope, context, pair, delegate | Mid-level engineer |
| **Wave 4** | Engineering organization | Surface ownership, architecture, mentoring, roadmap, SLOs | Staff engineer |
| **Wave 5** | Product-aware intelligence | Observability, experiments, self-improvement, business impact | Engineering leader |

### What "Engineering Leader Swarm" Looks Like

```
Organization: Acme Corp
Swarm fleet: 4 instances (API team, Web team, Mobile team, Infra team)

Thursday morning:
  → Observe: "Deploy abc123 caused 15% p99 increase in /api/users. Correlated with new N+1 query in UserService.getWithRelations(). Fix PR created and verified — latency restored."
  → Experiment: "Login redesign experiment (14 days, 50K users): conversion +8.3% (p=0.001). Recommendation: SHIP. Cleanup PR created to remove feature flag."
  → Self-improvement: "Monthly report: test pass rate improved 12% after switching to test-first strategy for bug fixes. Haiku sufficient for 73% of fix tasks (was using sonnet). Saving $45/month."
  → Optimize: "Identified 3 hot paths consuming 40% of API CPU. Generated caching layer for most-queried endpoint. Benchmark: 65% latency reduction. PR ready for review."
  → Impact: "Q1 summary: Swarm delivered $340K estimated business impact. Cost: $720. ROI: 472x."

Monthly Swarm cost: $720
Equivalent to: ~120 engineering hours/month saved
ROI: 472x
```
