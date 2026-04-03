# SWARM v0.1 — Ultra Implementation Plan

## Context

- 73K LOC (54K CLI + 19K Dashboard), 96 commands, zero tests
- Dashboard has: dark mode, error boundaries, command palette, 38 feature views
- Dashboard UX problems: 10px fonts, WCAG contrast failures, extreme density
- Guardrails engine exists but needs real-world polish
- bin/swarm.ts is intact with all registrations — use hidden flag approach
- Competitors: MetaGPT (45K stars), ChatDev (25K stars) do similar things
- Name collision with OpenAI Swarm (17K stars) — flagged, separate decision

---

## Phase 1: Feature Gating (The Hidden Flag Approach)

**Goal:** `swarm --help` shows only v0.1 commands. All others still work but are invisible.

### V0.1 Launch Set (19 commands)

```
Core Pipeline (6):   mayday, analyze, architect, plan, build, test
Quick Workflows (7): fix, review, pr, refactor, spike, test-gen, learn
DevOps (6):          init, doctor, status, stats, memory, dashboard
```

### Implementation

**Single file change: `packages/cli/bin/swarm.ts`**

Replace the old hardcoded `_hidden` array (lines 298-306) with:

```typescript
// V0.1 launch set — all other commands are registered but hidden from help
const V01_COMMANDS = new Set([
  'mayday', 'analyze', 'architect', 'plan', 'build', 'test',
  'fix', 'review', 'pr', 'refactor', 'spike', 'test-gen', 'learn',
  'init', 'doctor', 'status', 'stats', 'memory', 'dashboard',
]);

const showAll = process.argv.includes('--all');
if (!showAll) {
  for (const cmd of program.commands) {
    if (!V01_COMMANDS.has(cmd.name())) {
      cmd.hidden();  // Commander.js v13 native API
    }
  }
}
```

**Update help footer:**
```typescript
program.addHelpText('after', () => {
  const visible = program.commands.filter(c => !(c as any)._hidden).length;
  const total = program.commands.length;
  const lines = [
    '',
    chalk.bold('Quick start:'),
    `  ${chalk.cyan('swarm "add a login page"')}           Full pipeline end-to-end`,
    `  ${chalk.cyan('swarm fix "login not working"')}      Fix a bug directly`,
    `  ${chalk.cyan('swarm review')}                       Review staged changes`,
    `  ${chalk.cyan('swarm pr --reviewers --risk')}        Smart PR with risk scores`,
    `  ${chalk.cyan('swarm spike "how does auth work?"')}  Quick exploration`,
    `  ${chalk.cyan('swarm dashboard')}                    Real-time web UI`,
  ];
  if (!showAll) {
    lines.push('', chalk.dim(`  Showing ${visible} commands. Run ${chalk.cyan('swarm --help --all')} to see all ${total}.`));
  }
  return lines.join('\n');
});
```

### Files Changed
- `packages/cli/bin/swarm.ts` — ~25 lines changed, zero imports removed

### Verification
```bash
npm run build:cli
swarm --help        # Shows 19 commands + default action
swarm --help --all  # Shows all 96+
swarm negotiate     # Still works (just hidden from help)
```

---

## Phase 2: Guardrails That Actually Work

### Problem With Current Guardrails

The engine (287 LOC) is solid — section-exists, pattern-match, command, min-length, word-count checks. Integrated into pipeline (pipeline.ts:1362) with retry on failure. But:

1. **No standalone CLI command** — can't run guardrails manually
2. **No auto-fix** — reports problems, doesn't help fix them
3. **Output is raw console.log** — no summary, no table, no pass/fail
4. **No presets** — same rules for a todo app and a banking system
5. **No "why" or "how to fix"** — just "Missing X section"
6. **Custom rules undocumented**

### Real-World Inspiration

| Tool | What to Steal |
|------|--------------|
| **ESLint** | Rule IDs, auto-fix, configurable severity, pretty CLI output |
| **SonarQube** | Quality gates with pass/fail summary, coverage thresholds |
| **Danger.js** | "Expected X, found Y" format, PR-level checks |
| **Spectral** | Custom rulesets with presets (strict/standard/lenient) |

### Implementation

#### 2A. New `swarm check` command

```
swarm check              # Validate all artifacts
swarm check SPEC.md      # Validate specific artifact
swarm check --fix        # Auto-fix structural issues
swarm check --preset strict   # All warnings become errors
swarm check --json       # Machine-readable output for CI
```

**Pretty output (ESLint-inspired):**

```
  REQUIREMENTS.md
    ✓  section-exists    Original Requirement
    ✓  section-exists    Summary
    ✓  section-exists    Functional Requirements
    ✗  pattern-match     No user stories (As a / I want / So that)
       Fix: Add user stories to "3. Functional Requirements"
       Example: As a [user] I want [feature] So that [benefit]
    ⚠  min-length        Content is 180 chars (minimum: 200)

  SPEC.md
    ✓  section-exists    Architecture
    ✗  pattern-match     No Mermaid diagrams found
       Fix: Add a ```mermaid block in Architecture section
    ✗  pattern-match     No ADR entries found
       Fix: Add Architecture Decision Records (ADR-1, ADR-2, ...)

  ─────────────────────────────────────────
  2 artifacts · 18 passed · 3 errors · 1 warning
  2 auto-fixable (run swarm check --fix)
```

#### 2B. Auto-fix for structural issues

```typescript
interface GuardrailFix {
  type: 'insert-section' | 'insert-pattern' | 'extend-content';
  description: string;
  patch: string;
  location: 'append' | 'after-section';
  afterSection?: string;
}
```

When `--fix` is used:
- Missing sections → append heading + placeholder content
- Missing patterns → add example/template to relevant section
- Too short → add "TODO: expand this section" markers

Inspired by ESLint `--fix`: fix what's mechanical, flag what needs judgment.

#### 2C. Presets

```yaml
# .swarm/guardrails.yaml
preset: standard   # strict | standard | lenient | off

rules:
  REQUIREMENTS.md:
    user-stories: warning      # Downgrade from error
    min-length: 100            # Override threshold
  SPEC.md:
    mermaid-diagrams: off      # Skip this check
```

| Preset | Behavior |
|--------|----------|
| `strict` | All checks are errors. Pipeline blocks on any violation. |
| `standard` | Structure = error, content = warning. Default. |
| `lenient` | Only file-exists and critical sections are errors. |
| `off` | No guardrails. |

#### 2D. Better violation messages

Current: `[guardrail] error: Missing "Architecture" section`

New:
```
✗  SPEC.md › section-exists › Architecture

   Why:  Defines system structure, component relationships, and data flow.
         Without it, engineers lack context for implementation decisions.

   Fix:  Add "## Architecture" with a system diagram and component list.
   Auto-fixable: Yes (run swarm check --fix)
```

#### 2E. Pipeline integration improvements

- **Pre-stage validation:** Before architect, verify REQUIREMENTS.md passes. Don't start a stage if input artifact is invalid.
- **State storage:** Store violations in pipeline state → dashboard can display them.
- **WebSocket broadcast:** `guardrail-alert` events (type exists in types.ts:210).

### Files Changed
- `packages/cli/src/core/guardrails.ts` — Expand (~287→700 LOC)
- `packages/cli/src/commands/check.ts` — New (~200 LOC)
- `packages/cli/src/types.ts` — Add `GuardrailFix`, `GuardrailPreset`
- `packages/cli/bin/swarm.ts` — Register check, add to V01_COMMANDS
- `packages/cli/src/core/pipeline.ts` — Pre-stage validation

---

## Phase 3: Comprehensive Test Suite

### Strategy

Test EVERYTHING that ships in v0.1. Two layers:
1. **Core module unit tests** (6 modules, ~55 tests) — the real engineering
2. **Command unit tests** (19 commands + shared, ~127 tests) — the user-facing features
3. **Dashboard E2E tests** (Playwright, ~20 tests) — the portfolio showcase

**Total: ~200+ tests**

### Setup

```bash
# CLI tests
cd packages/cli
npm install -D vitest @vitest/coverage-v8

# Dashboard E2E tests
cd packages/dashboard
npm install -D @playwright/test
npx playwright install chromium
```

**packages/cli/vitest.config.ts:**
```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/commands/**'],
    },
    testTimeout: 10000,
  },
});
```

### 3A. Core Module Tests (~55 tests)

#### `state.test.ts` (10 tests) — START HERE (easiest, pure file I/O)
```
✓ create new state file in .swarm/
✓ read existing state
✓ update stage without losing other fields
✓ create backup before write (state.json.bak)
✓ recover from corrupted state using backup
✓ multi-pipeline namespace (worktrees)
✓ emit 'change' event on update
✓ handle concurrent writes (scheduled flush)
✓ initialize with default pipeline stages
✓ persist agent list with status
```

#### `guardrails.test.ts` (12 tests)
```
✓ detect missing artifact file
✓ pass when all sections exist
✓ fail on missing required section
✓ warn on missing optional section (severity: warning)
✓ match regex pattern in content
✓ fail on missing regex pattern
✓ check min-length threshold
✓ check word-count per section
✓ check required-patterns (all must match)
✓ load custom rules from guardrails.yaml
✓ evaluate single artifact (evaluateArtifact)
✓ command check (execSync)
```

#### `agent-process.test.ts` (10 tests)
```
✓ spawn non-interactive agent with correct CLI args
✓ parse stream-json content (msg.message.content[].text path)
✓ emit 'content' events with accumulated output
✓ emit 'result' event with cost data
✓ emit 'exit' event before 'result'
✓ timeout after inactivity (watchdog)
✓ kill agent and clean up subprocess
✓ handle subprocess crash (non-zero exit)
✓ resume session with --resume flag
✓ accumulate output in ring buffer
```

#### `agent-manager.test.ts` (8 tests)
```
✓ spawn agent and track in map
✓ kill agent by ID
✓ sendInput resumes session with new prompt
✓ waitForAgent resolves on completion
✓ output capped at ring buffer limit
✓ cost accumulates across turns
✓ broadcast state on status change
✓ list running agents
```

#### `pipeline.test.ts` (10 tests)
```
✓ run single stage (analyze) and produce artifact
✓ enforce role boundaries (non-engineer can't use Bash)
✓ sequence stages in correct order
✓ skip stages when configured
✓ detect test failures and enter fix loop
✓ respect max fix iterations
✓ run guardrails after stage completion
✓ retry stage on guardrail error
✓ track cumulative cost across stages
✓ save state after each stage
```

#### `ws-server.test.ts` (7 tests)
```
✓ accept WebSocket connection
✓ reject connection without auth token
✓ broadcast state changes to clients
✓ handle spawn command
✓ handle kill command
✓ handle get-state command
✓ handle malformed JSON gracefully
```

### 3B. Command Unit Tests (~127 tests)

Every v0.1 command gets tested. Grouped by complexity:

#### High-Complexity Commands (47 tests)

| Command | Tests | Key Logic to Test |
|---------|-------|-------------------|
| **test-gen.ts** (629 LOC) | 12 | Coverage parsing, scope discovery, scan heuristics (no-test +60, recent +30, imports +10), test file detection, batch processing |
| **pr.ts** (251 LOC) | 9 | Base branch rejection, changed files collection, fallback diff logic (3 attempts), risk scoring, reviewer suggestion, PR title normalization, body assembly |
| **review.ts** (186 LOC) | 8 | PR number detection, staged+unstaged diff, branch diff, 50KB truncation, review prompt structure, PR comment posting, tool restrictions |
| **fix.ts** (154 LOC) | 7 | GitHub issue fetching (JSON parsing), comment truncation (5 max, 500 chars), label inclusion, git diff (5000 char limit), file reading |
| **mayday.ts** (156 LOC) | 6 | Cost confirmation (yes/no), lean mode (haiku for docs), smart mode (sonnet docs/opus engineer), file reading, resume validation |
| **stats.ts** (199 LOC) | 6 | Date filtering, success rate, per-stage cost aggregation, weekly bucketing, recommendation triggers, duration formatting |

#### Medium-Complexity Commands (30 tests)

| Command | Tests | Key Logic |
|---------|-------|-----------|
| **init.ts** | 5 | Port derivation (deterministic MD5 hash), collision avoidance, config merge, file creation |
| **refactor.ts** | 5 | Two-stage agent spawning, scope clause, analyst (read-only) → engineer (write), cost accumulation |
| **memory.ts** | 5 | List/add/remove/clear, kind+tag filtering, confidence color coding |
| **doctor.ts** | 6 | Node version check, claude CLI detection, auth check, disk space, .swarm/ check, config validation |
| **learn.ts** | 4 | Convention extraction, refresh/merge modes, show mode |
| **dashboard.ts** | 4 | Path resolution (monorepo vs published), HTML injection (wsPort/wsToken), SPA fallback, port error handling |
| **shared.ts** | 4 | Manager wiring order, audit event wiring, SIGINT/SIGTERM cleanup, exception handling |

#### Low-Complexity Commands (27 tests)

| Command | Tests | Key Logic |
|---------|-------|-----------|
| **analyze.ts** | 3 | Interactive vs non-interactive, spinner lifecycle, file reading |
| **architect.ts** | 2 | Mode selection, spinner |
| **plan.ts** | 2 | Mode selection, spinner |
| **build.ts** | 3 | Headless vs interactive, InputListener lifecycle, cost display |
| **test.ts** | 4 | Mode branching, InputListener, agent message forwarding |
| **spike.ts** | 3 | Read-only mode, interactive mode, default model (haiku) |
| **status.ts** | 3 | Color mapping, stage display, cost summation |
| **check.ts** | 7 | Pretty output format, --fix flag, --preset flag, --json output, single artifact mode, pass/fail summary |

#### Test Helpers (shared utilities)

```
src/__tests__/
├── helpers/
│   ├── mock-agent.ts        # Mock AgentProcess (emit events on schedule)
│   ├── mock-subprocess.ts   # Mock child_process.spawn and execSync
│   ├── mock-managers.ts     # Pre-wired mock AgentManager, Pipeline, State
│   ├── temp-dir.ts          # Create/cleanup temp .swarm/ directories
│   └── ws-client.ts         # WebSocket test client
├── core/
│   ├── state.test.ts
│   ├── guardrails.test.ts
│   ├── agent-process.test.ts
│   ├── agent-manager.test.ts
│   ├── pipeline.test.ts
│   └── ws-server.test.ts
└── commands/
    ├── mayday.test.ts
    ├── analyze.test.ts
    ├── ... (19 command test files)
    └── check.test.ts
```

### 3C. Dashboard E2E Tests (~20 tests, Playwright)

```
packages/dashboard/e2e/
├── playwright.config.ts
├── dashboard.spec.ts        # Core dashboard functionality
├── pipeline.spec.ts         # Pipeline view interactions
└── helpers/
    └── mock-ws.ts           # Mock WebSocket server for tests
```

#### Test Setup
- Spin up a mock WebSocket server that sends realistic state data
- Launch dashboard against mock server (no real Claude CLI needed)
- Playwright tests interact with the rendered UI

#### dashboard.spec.ts (8 tests)
```
✓ loads dashboard and shows pipeline view
✓ displays agent cards with status/cost/tokens
✓ dark mode toggle persists across reload
✓ command palette opens with Cmd+K
✓ sidebar navigation between views
✓ sidebar collapses on mobile viewport (320px)
✓ error boundary shows friendly message on component crash
✓ WebSocket reconnect indicator on disconnect
```

#### pipeline.spec.ts (12 tests)
```
✓ shows 5 pipeline stages with correct status icons
✓ stage transitions update in real-time via WebSocket
✓ agent card shows running spinner during execution
✓ agent card shows cost and token counts
✓ output stream renders activity items
✓ output stream auto-scrolls to bottom
✓ spawn dialog opens and lists persona/stack/model options
✓ kill button sends kill command via WebSocket
✓ cost panel shows per-persona breakdown
✓ guardrail violations display in stage view (Phase 2 integration)
✓ responsive layout: stages stack vertically on mobile
✓ loading states visible during async operations
```

### Verification
```bash
# CLI tests
cd packages/cli && npm test                  # ~182 tests pass
cd packages/cli && npm run test:coverage     # >70% on core + commands

# Dashboard E2E
cd packages/dashboard && npx playwright test  # ~20 tests pass
```

---

## Phase 4: Dashboard UX Overhaul

### Audit Findings (Critical Issues)

The UX audit revealed serious readability problems:

| Issue | Severity | Scope |
|-------|----------|-------|
| **Font size: 441× `text-[10px]`, 47× `text-[9px]`** | CRITICAL | Global |
| **Contrast: `text-stone-500` fails WCAG AA on dark bg** | CRITICAL | 491 instances |
| **Density: 8+ data points per AgentCard, 9+ per OutputStream line** | HIGH | Core views |
| **Monospace everywhere (even UI labels)** | HIGH | Global |
| **Muted semantic colors (warnings/errors too subtle)** | MEDIUM | Semantic system |
| **No visual hierarchy (no section dividers, no spacing)** | MEDIUM | Layout |
| **Sidebar: 40+ items, no search, no collapse** | MEDIUM | Navigation |
| **Touch targets too small for mobile** | MEDIUM | Responsive |

### 4A. Typography System

**Problem:** JetBrains Mono at 10px is near-illegible. Monospace is wrong for UI labels.

**Fix: Dual font system**

```css
/* index.css */
:root {
  --font-ui: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-code: 'JetBrains Mono', 'IBM Plex Mono', monospace;
}
```

| Element | Before | After |
|---------|--------|-------|
| **UI labels, nav, buttons** | JetBrains Mono 10px | Inter 12px |
| **Code, logs, diffs** | JetBrains Mono 10px | JetBrains Mono 12px |
| **Secondary labels** | 9px | 10px minimum |
| **Headings** | 10px bold | 14-16px semibold |
| **Timestamps** | 9px stone-500 | 10px stone-400 |

**Implementation:**
- Add Inter font to `index.html`
- Create utility classes: `font-ui` (sans-serif) and `font-code` (monospace)
- Apply `font-ui` to: Sidebar, TopBar, AgentCard labels, CostPanel labels, buttons, tooltips
- Keep `font-code` for: OutputStream, DiffViewer, code blocks, token counts

**Scale:**
```
text-2xs  = 10px  (minimum, only for tertiary metadata)
text-xs   = 12px  (body text, labels — NEW DEFAULT)
text-sm   = 13px  (emphasized labels)
text-base = 14px  (section headers)
text-lg   = 16px  (page headers)
```

### 4B. Color Contrast Fix

**Problem:** `text-stone-500` (RGB 120,113,108) on `bg-[#0c0a09]` (RGB 12,10,9) = contrast ratio ~3.5:1. WCAG AA requires 4.5:1 for body text.

**Fix: Upgrade text color usage**

| Usage | Before | After | Contrast |
|-------|--------|-------|----------|
| Body text | `text-stone-500` | `text-stone-300` | ~8:1 ✓ |
| Secondary text | `text-stone-400` | `text-stone-400` | ~5.5:1 ✓ (at 12px+) |
| Tertiary/muted | `text-stone-600` | `text-stone-500` | ~3.5:1 (only for non-essential) |
| Active/primary | `text-stone-200` | `text-stone-200` | ~12:1 ✓ |

**Semantic color saturation:**

| Color | Before | After |
|-------|--------|-------|
| Error | `text-red-400` | `text-red-400` (keep, increase bg contrast) |
| Warning | `text-amber-400` on `bg-amber-950/40` | `text-amber-300` on `bg-amber-950/60` |
| Success | `text-green-400` | `text-emerald-400` (slightly more vibrant) |
| Info | `text-stone-300` | `text-blue-300` (add color differentiation) |

**Implementation:** Global find-and-replace with careful review:
- `text-stone-500` (491 instances) → audit each: promote to `text-stone-300` or `text-stone-400`
- `text-stone-600` (135 instances) → promote to `text-stone-500`

### 4C. Information Density Reduction

**AgentCard — Before (8+ data points crammed):**
```
● analyst     [kill]
  react · opus · auto
  $0.05  2k/1k  1m 23s
```

**AgentCard — After (visual hierarchy, breathing room):**
```
● Analyst                    [kill]
  react · opus · auto

  Cost     $0.05
  Tokens   2,100 in / 1,200 out
  Time     1m 23s
```

Changes:
- Capitalize persona name
- Add blank line between badge row and metrics
- Metrics on separate lines (not crammed)
- Increase padding from `px-2.5 py-2` to `px-3 py-3`
- Use `font-ui` for labels, `font-code` for values

**OutputStream — Before (9 visual elements per line):**
```
12 │ 🔧 [Edit] Modified auth.ts — added JWT validation  9:41
```

**OutputStream — After (cleaner, more scannable):**
```
  12  Edit    Modified auth.ts — added JWT validation       9:41 AM
```

Changes:
- Remove emoji icons → use text labels with consistent width
- Increase line padding from `py-1` to `py-1.5`
- Timestamp in `text-stone-400` at 10px (not 9px stone-500)
- Tool name in fixed-width column (left-aligned)
- Add subtle separator every 10 lines (or per tool-use group)

**TopBar — Before (everything on one line):**
```
$ analyze → architect → plan → build → test | ⚠ 2 | MayDay | $4.50 | 5m 32s
```

**TopBar — After (two-row layout):**
```
Row 1: [analyze ✓] → [architect ✓] → [plan ●] → [build ○] → [test ○]
Row 2: Cost: $4.50  ·  Time: 5m 32s  ·  2 warnings  ·  [MayDay Controls]
```

Changes:
- Stages on their own row with clear status icons
- Metadata on second row with labels
- More padding between elements

### 4D. Sidebar Cleanup

**Problem:** 40+ nav items, 8 groups, no search, no collapse.

**Fix for v0.1:**
- Default: show only v0.1 command views (matching V01_COMMANDS)
- Group non-v0.1 views under "More Features" section (collapsed by default)
- Add search/filter input at top of sidebar
- Increase spacing between groups

### 4E. Spacing & Layout Standards

Establish minimum spacing rules:

```css
/* Component padding minimums */
.card { @apply px-3 py-3; }          /* Was: px-2.5 py-2 */
.list-item { @apply px-3 py-2; }     /* Was: px-3 py-1 */
.section { @apply mb-4; }            /* Was: mb-2 */

/* Gap minimums */
.flex-group { @apply gap-2; }        /* Was: gap-0.5 */
.grid-group { @apply gap-3; }        /* Was: gap-1 */

/* Line height */
body { @apply leading-relaxed; }     /* 1.625 */
.compact { @apply leading-normal; }  /* 1.5, for dense views */
```

### 4F. Light Mode Audit

Light mode CSS exists but is incomplete. Ensure:
- All `text-stone-*` colors have light mode counterparts
- Background colors invert properly
- Semantic colors work on both themes
- Test every view in both modes

### Files Changed
- `packages/dashboard/src/index.css` — Font system, spacing tokens
- `packages/dashboard/index.html` — Inter font import
- `packages/dashboard/src/components/AgentCard.tsx` — Density reduction
- `packages/dashboard/src/components/OutputStream.tsx` — Cleaner line format
- `packages/dashboard/src/components/TopBar.tsx` — Two-row layout
- `packages/dashboard/src/components/Sidebar.tsx` — v0.1 filtering, search
- `packages/dashboard/src/components/CostPanel.tsx` — Font/contrast fixes
- `packages/dashboard/src/components/PipelineView.tsx` — Guardrail display
- ~20 other component files for font-size/contrast global fixes

### Verification
- Visual inspection at 320px, 768px, 1440px
- WCAG contrast checker on all text/background combos
- Dark mode + light mode toggle test
- Playwright E2E tests (Phase 3C) verify layout doesn't break

---

## Phase 5: README Overhaul

### Strategy
Use README_SAMPLE.md as base. Key additions:

1. **Hero:** Clean tagline, no emoji overload
2. **Demo GIF placeholder:** `![Demo](docs/demo.gif)` — record separately
3. **Competitive positioning:** "Unlike MetaGPT/ChatDev (research demos), Swarm is a production CLI with real subprocess management, artifact validation, and a live dashboard."
4. **Guardrails showcase:** Show `swarm check` output — this is a differentiator
5. **Honest scope:** "v0.1 ships 19 commands. 60+ more are in development."

### Structure
```
# Swarm
> One command. 5 AI agents. Complete features.

## Why Swarm?                    ← Visual flow diagram
## Quick Start                   ← 3 steps: install, init, build
## Features (v0.1)               ← 19 commands, grouped
## How It Works                  ← Mermaid pipeline diagram
## Guardrails                    ← swarm check output (differentiator)
## Dashboard                     ← Screenshot/GIF
## Configuration                 ← .swarm/config.yaml example
## Cost & Performance            ← Realistic estimates
## Coming Soon (v0.2+)           ← Builds anticipation
## Architecture                  ← Link to docs/
## Contributing / FAQ / License
```

### Files Changed
- `README.md` — Full rewrite

---

## Phase 6: Repository Cleanup

### Add Missing Files
- `CODE_OF_CONDUCT.md` — Contributor Covenant
- Review `LICENSE` — Currently BUSL-1.1, consider MIT for portfolio

### Update Existing Files
- `.gitignore` — Verify .swarm/ patterns
- `CONTRIBUTING.md` — Review/update

### Remove Planning Artifacts
Before public push, delete:
```
POLISH.md, POLISH_TASKS.md, POLISH_SUMMARY.md, POLISH_CHECKLIST.md,
PR_REVIEW_ADDITION.md, FEATURES.md, README_SAMPLE.md, V01_PLAN.md
```

### Package.json
```json
{
  "name": "swarm-pipeline",
  "version": "0.1.0",
  "description": "Multi-agent AI pipeline — 5 Claude Code specialists build your features",
  "keywords": ["ai", "claude", "multi-agent", "pipeline", "cli", "code-generation"],
  "license": "MIT"
}
```

---

## Execution Order & Dependencies

```
Phase 1  Feature Gating           ~1h     (unblocks everything)
Phase 2  Guardrails Polish         ~6h     (new check command + presets + auto-fix)
Phase 3  Test Suite               ~16h     (55 core + 127 command + 20 E2E = ~200 tests)
Phase 4  Dashboard UX Overhaul    ~10h     (typography + contrast + density + sidebar)
Phase 5  README                    ~2h     (rewrite + guardrails showcase)
Phase 6  Cleanup                   ~1h     (files, license, .gitignore)

Total: ~36 hours
```

### Dependency Graph

```
Phase 1 ─┬─→ Phase 2 ──→ Phase 3A (core tests need guardrails changes)
          │                  │
          │                  ├─→ Phase 3B (command tests, parallel with 3A)
          │                  │
          ├─→ Phase 4 ──────┼─→ Phase 3C (E2E tests need UX changes)
          │                  │
          ├─→ Phase 5 ◄─────┘   (README references test counts + guardrails)
          │
          └─→ Phase 6            (parallel, anytime after Phase 1)
```

### Critical Path
```
Phase 1 → Phase 2 → Phase 3A → Phase 3B → Phase 5
               └──→ Phase 4 → Phase 3C ──┘
```

---

## Success Criteria

```
swarm --help              → 19 commands visible
swarm --help --all        → 96+ commands visible
swarm negotiate           → Still works (hidden, not deleted)
swarm check               → Beautiful guardrail report with fix suggestions
swarm check --fix         → Auto-fixes structural issues
swarm check --preset strict → Strict mode
npm test (CLI)            → ~182 tests pass
npm run test:coverage     → >70% on src/core/ and src/commands/
npx playwright test       → ~20 E2E tests pass
npm run build             → Zero errors
Dashboard                 → Readable at 12px+ fonts, WCAG AA contrast
Dashboard mobile          → Usable at 320px
README.md                 → Clear, beautiful, positioned vs competitors
```

---

## What This Plan Does NOT Include (Conscious Scope Cuts)

1. **Rename** — OpenAI name collision flagged but not addressed. Separate decision.
2. **Demo recording** — GIF/video is high-impact but separate effort.
3. **CI/CD pipeline** — No GitHub Actions. Manual build/test for now.
4. **Performance optimization** — Ship first, optimize later.
5. **Accessibility audit** — WCAG contrast fixes included, but full a11y audit is v0.2.
6. **Dashboard component library** — No Storybook or design system extraction.
