# Onboarding & Interactive Pipeline Plan

> Goal: A vibe coder opens Swarm for the first time and gets a "wow" moment within 60 seconds. They never get stuck.

---

## Part 1: Always-Interactive Pipeline

### Problem

Current behavior is inconsistent and confusing:

| Stage | Default | Why it's wrong |
|-------|---------|----------------|
| analyze | Interactive | OK |
| architect | Interactive | OK |
| plan | Interactive | OK |
| build | Non-interactive (hardcoded) | User can't intervene if it's going wrong |
| test | Non-interactive | User can't guide test strategy |
| mayday | Non-interactive (hardcoded) | User watches helplessly if things go sideways |

**The core principle:** The pipeline should always be interactive. The user should always be able to send input, ask questions, redirect, or abort — without needing special flags.

### Proposed Behavior

**Every stage streams output AND accepts user input.** The difference between stages is the *prompt for input*, not whether input is accepted.

```
┌─────────────────────────────────────────────────────────────┐
│ Stage: Build                                                 │
│                                                              │
│ [engineer-1] Implementing FND-001: auth middleware...        │
│   → Read src/middleware/auth.ts                              │
│   → Edit src/middleware/auth.ts                              │
│   → Read src/routes/login.ts                                 │
│                                                              │
│ [engineer-2] Implementing SVC-001: user service...           │
│   → Write src/services/user.service.ts                       │
│   → Edit src/models/user.ts                                  │
│                                                              │
│ ─────────────────────────────────────────────────────────── │
│ > Type to send feedback to active agents, or press           │
│   Enter to continue watching                          [send] │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Changes

#### CLI Changes (`packages/cli/src/core/pipeline.ts`)

**1. Build stage — add input support**

Current (hardcoded non-interactive):
```typescript
// pipeline.ts line ~556
interactive: false,
permissionMode: 'auto',
```

Change to:
```typescript
interactive: false,  // Keep agent non-interactive (auto-accepts edits)
acceptUserInput: true,  // NEW: Allow user to send messages via --resume
```

**Key insight:** "Interactive" in the CLI context means `stdio: 'inherit'` (user types in terminal). That's NOT what we want for build/test — we want the agent to auto-run BUT accept input when the user chooses to type.

**2. Add input listener during all stages**

Add a non-blocking stdin listener that wraps `AgentManager.sendInput()`:

```typescript
// New: src/core/input-listener.ts
// Listens for stdin during any stage
// When user types + presses Enter:
//   1. Pause output display briefly
//   2. Send input to the active agent via sendInput()
//   3. Resume output display
// When user presses Ctrl+C:
//   1. First press: "Press Ctrl+C again to abort stage"
//   2. Second press: Kill agent, move to next stage or abort
```

**3. MayDay — add intervention points**

Current: runs fully autonomous, no user input accepted.

Change to:
```
After each stage completes:
  [✓ Analyze complete — REQUIREMENTS.md written]
  Press Enter to continue to Architect, or type feedback: _

During fix loop:
  [Fix attempt 2/5 — 3 tests still failing]
  Press Enter to continue, type guidance, or 's' to skip: _
```

This replaces the `--approve` flag with a softer "pause-and-confirm" that doesn't block if the user just hits Enter.

**4. Add `--headless` flag for CI/automation**

For users who DON'T want interactivity (CI, scripts, GitHub Action):

```bash
swarm "feature" --headless    # No prompts, no pauses, pure automation
```

Default = interactive with pauses. `--headless` = old behavior.

#### Dashboard Changes (`packages/dashboard/`)

**5. Always show input bar**

Current: Input bar only shown for agents that are running or done.

Change to: Input bar always visible at bottom of PipelineView, sends to whichever agent is currently active.

**6. Add stage transition prompts**

When a stage completes in the dashboard, show an inline prompt:

```
┌─────────────────────────────────────────┐
│ ✓ Analyze complete                       │
│                                          │
│ REQUIREMENTS.md has been written.        │
│ [View artifact]  [Continue]  [Edit]      │
│                                          │
│ Optional: Add notes for the architect    │
│ > ________________________________ [send]│
└─────────────────────────────────────────┘
```

---

## Part 2: Dashboard Onboarding

### First Visit Experience

**Detection:** Use `localStorage.getItem('swarm_onboarded')` to detect first visit.

#### Screen 1: Welcome (replaces LaunchView on first visit)

```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│   Welcome to Swarm                                           │
│                                                              │
│   AI builds your feature while you watch.                    │
│                                                              │
│   Describe what you want to build, and Swarm will:           │
│                                                              │
│   1. Analyze    → Gather requirements                        │
│   2. Architect  → Design the system                          │
│   3. Plan       → Break into tasks                           │
│   4. Build      → Write the code (parallel agents)           │
│   5. Test       → Generate & run tests, auto-fix failures    │
│                                                              │
│   Each stage uses a specialized AI persona.                  │
│   You can intervene, redirect, or send feedback at any time. │
│                                                              │
│   Typical cost: $3-$8 per feature.                           │
│                                                              │
│                        [Get Started →]                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### Screen 2: First Build (guided LaunchView)

```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│   What do you want to build?                                 │
│                                                              │
│   ┌───────────────────────────────────────────────────────┐ │
│   │ Try: "Add a login page with email/password auth"      │ │
│   │                                                       │ │
│   └───────────────────────────────────────────────────────┘ │
│                                                              │
│   Model: ● Sonnet (recommended)  ○ Opus  ○ Haiku            │
│          ↳ Good balance of speed and quality (~$5)           │
│                                                              │
│   Budget: $5  ← drag slider →  $25                           │
│          ↳ Pipeline stops if budget is reached. No surprises. │
│                                                              │
│                              [Build it →]                     │
│                                                              │
│   ○ Skip tutorial                                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

Changes from current LaunchView:
- Add example suggestion in the textarea
- Add helper text under model picker explaining trade-offs
- Add budget slider with reassurance text
- Add "skip tutorial" link

#### Screen 3: First Pipeline Run (guided PipelineView)

Overlay tooltips appear one at a time as events happen:

**Tooltip 1** (when analyze starts):
```
┌─────────────────────────────────────────┐
│ 💡 The Analyst is reading your request  │
│ and writing REQUIREMENTS.md.            │
│                                         │
│ You can type below to answer questions  │
│ or add context.                         │
│                                   [Got it] │
└─────────────────────────────────────────┘
```

**Tooltip 2** (when first stage completes):
```
┌─────────────────────────────────────────┐
│ 💡 Stage complete! You can review the   │
│ output before the next stage starts.    │
│                                         │
│ Click "View artifact" to read what was  │
│ written, or "Continue" to proceed.      │
│                                   [Got it] │
└─────────────────────────────────────────┘
```

**Tooltip 3** (when build starts):
```
┌─────────────────────────────────────────┐
│ 💡 Multiple engineers are working in    │
│ parallel! Click an agent on the left    │
│ to watch its progress.                  │
│                                   [Got it] │
└─────────────────────────────────────────┘
```

**Tooltip 4** (when pipeline completes):
```
┌─────────────────────────────────────────┐
│ 💡 Done! Check the Results tab to see   │
│ all file changes, test results, and     │
│ total cost.                             │
│                                   [Got it] │
└─────────────────────────────────────────┘
```

After tooltip 4, set `localStorage.setItem('swarm_onboarded', 'true')`.

### SpawnDialog Improvements

Add help text and tooltips to every field:

```
┌─────────────────────────────────────────────────────────────┐
│ $ swarm spawn                                          [×]   │
│                                                              │
│ Name                                                         │
│ ┌───────────────────────────────────────────────────────┐   │
│ │ auth-engineer                                         │   │
│ └───────────────────────────────────────────────────────┘   │
│ A label for this agent (e.g., "auth-engineer", "api-fix")   │
│                                                              │
│ Persona                                     ⓘ What's this?  │
│ ┌─────────────────────────────────────────────────────┐     │
│ │ engineer ▼                                          │     │
│ └─────────────────────────────────────────────────────┘     │
│ ┌─ Persona roles ─────────────────────────────────────────┐ │
│ │ analyst    → Gathers requirements, asks questions       │ │
│ │ architect  → Designs system, writes technical spec      │ │
│ │ lead       → Breaks work into tasks, plans execution    │ │
│ │ engineer   → Writes code, implements features           │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ Model                                                        │
│ ┌─────────────────────────────────────────────────────┐     │
│ │ sonnet ▼                                            │     │
│ └─────────────────────────────────────────────────────┘     │
│ haiku = fast & cheap | sonnet = balanced | opus = best      │
│                                                              │
│ Permission Mode                                              │
│ ┌──────────────┐ ┌──────────────┐                           │
│ │ ● Auto       │ │ ○ Plan       │                           │
│ │ Full access  │ │ Read-only    │                           │
│ └──────────────┘ └──────────────┘                           │
│ "Auto" lets the agent edit files. "Plan" is read-only.      │
│                                                              │
│ Task                                                         │
│ ┌───────────────────────────────────────────────────────┐   │
│ │ Implement JWT authentication middleware with           │   │
│ │ refresh token rotation...                             │   │
│ └───────────────────────────────────────────────────────┘   │
│ What should this agent do? Be specific.                      │
│                                                              │
│                                             [spawn]          │
└─────────────────────────────────────────────────────────────┘
```

Key changes:
- **Add descriptions under every field**
- **Simplify permission modes** to 2 options for vibe coders: "Auto" (full access) and "Plan" (read-only). Hide advanced modes behind "Show advanced" toggle.
- **Add persona role descriptions** inline
- **Add model comparison** one-liner
- **Remove SIGTERM jargon** from kill dialog

### KillConfirmDialog Fix

Current:
```
$ kill --signal SIGTERM
Are you sure you want to kill "engineer-1"?
[cancel] [kill]
```

Change to:
```
Stop agent
Are you sure you want to stop "engineer-1"?
This will cancel any in-progress work.
[Cancel] [Stop Agent]
```

---

## Part 3: CLI Onboarding

### First Run Detection

When user runs `swarm "feature"` for the first time (no `.swarm/` directory):

Current behavior: Auto-inits silently, then runs pipeline.

New behavior:
```
Welcome to Swarm! Let's set up your project.

  Detected stack: react (from package.json)
  Model: sonnet (recommended — good balance of speed & quality)
  Budget: $5 per run (you can change this anytime)

  Ready to build: "Add a login page with JWT authentication"

  Estimated cost: ~$4.00-$7.00

  Press Enter to start, or 'c' to configure: _
```

If user presses 'c':
```
  Stack [react]: _
  Model [sonnet]: _
  Budget [$5]: _
```

If user just presses Enter: starts immediately with defaults.

### `swarm doctor` Improvements

Current output is good but add a final "next steps" section:

```
✓ Node.js 22.1.0
✓ Claude CLI 1.0.28
✓ Disk space: 45 GB available
✓ .swarm/ directory exists
✓ config.yaml is valid

All checks passed!

Quick start:
  swarm "describe your feature"     Build something
  swarm dashboard                   Open web UI
  swarm status                      Check pipeline state
```

---

## Part 4: Implementation File Map

### CLI files to modify

| File | Change |
|------|--------|
| `packages/cli/src/core/pipeline.ts` | Add `acceptUserInput` to build/test stages, add stage transition pauses |
| `packages/cli/src/core/input-listener.ts` | **NEW** — Non-blocking stdin listener during pipeline |
| `packages/cli/src/commands/mayday.ts` | Add intervention points between stages and during fix loop |
| `packages/cli/src/commands/build.ts` | Accept optional user input during build |
| `packages/cli/src/commands/test.ts` | Accept optional user input during test |
| `packages/cli/src/commands/init.ts` | Add first-run welcome with configure option |
| `packages/cli/src/commands/doctor.ts` | Add "next steps" output |
| `packages/cli/src/types.ts` | Add `acceptUserInput`, `headless` to `StageOpts` |

### Dashboard files to modify

| File | Change |
|------|--------|
| `src/App.tsx` | Add localStorage first-visit detection, onboarding state |
| `src/views/LaunchView.tsx` | Add helper text, budget slider, example suggestions |
| `src/views/PipelineView.tsx` | Add stage transition prompts, always-visible input bar, onboarding tooltips |
| `src/components/SpawnDialog.tsx` | Add field descriptions, simplify permission modes, persona explanations |
| `src/components/KillConfirmDialog.tsx` | Remove SIGTERM jargon |
| `src/components/OnboardingTooltip.tsx` | **NEW** — Reusable tooltip component for guided tour |
| `src/components/WelcomeScreen.tsx` | **NEW** — First-visit welcome overlay |
| `src/hooks/useOnboarding.ts` | **NEW** — localStorage-backed onboarding state hook |

### New components needed

```
src/components/
  OnboardingTooltip.tsx    — Positioned tooltip with "Got it" dismiss
  WelcomeScreen.tsx        — Full-screen welcome overlay
  StageTransition.tsx      — Inline "stage complete, review or continue" prompt
  ArtifactPreview.tsx      — Quick preview of REQUIREMENTS.md/SPEC.md/TASKS.md

src/hooks/
  useOnboarding.ts         — { isFirstVisit, currentStep, dismissStep, resetOnboarding }
```

---

## Part 5: Priority Order

### Phase A — Never get stuck (2-3 days)

1. Add input listener for build/test stages in CLI
2. Add stage transition pauses in MayDay (Enter to continue)
3. Add `--headless` flag for CI
4. Always show input bar in dashboard PipelineView

### Phase B — First impression (2-3 days)

5. Welcome screen component for dashboard
6. Onboarding tooltips during first pipeline run
7. First-run CLI welcome with configure option
8. SpawnDialog field descriptions and persona explanations

### Phase C — Polish (1-2 days)

9. Kill dialog jargon fix
10. Doctor command "next steps"
11. Model/cost helper text in LaunchView
12. Artifact preview during pipeline
13. localStorage onboarding state management
