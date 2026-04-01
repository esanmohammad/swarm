# Dashboard UX Fixes — Implementation Plan

> Tracks all identified UX issues and their implementation status.

---

## Completed

### Session 1 — Core UX fixes

- [x] Kill dialog jargon → "Stop Agent" with human-readable language
- [x] Spawn dialog tooltips — persona descriptions, model hints, field help text, better labels
- [x] Spawn dialog defaults — sonnet model, auto permissions
- [x] Permission mode simplification — 3 primary + "Show advanced" for bypass
- [x] Output stream search/filter — search bar + per-tool filter buttons
- [x] Welcome screen — first-visit onboarding overlay
- [x] Onboarding hooks — `useOnboarding`, `usePersistedState`
- [x] Persisted UI state — view + selected agent survive reloads
- [x] Bulk kill — "Stop all" button in agent sidebar
- [x] Model helper text — hints on LaunchView model buttons

### Session 2 — Phase 1

- [x] Onboarding tooltips during pipeline — contextual tips auto-advance with pipeline state
- [x] Artifact preview mid-pipeline — WS `get-artifact` + collapsible panel
- [x] Dark/Light mode — theme toggle + CSS variables + system preference
- [x] Budget input in LaunchView — slider in Advanced options
- [x] Connection status ARIA

### Session 3 — Phase 2

**State Persistence:**
- [x] View mode (activity/diff/raw) persisted via `usePersistedState` in OutputStream

**Responsive Layout:**
- [x] Header nav — collapses labels on mobile, shows only icons (sm breakpoint)
- [x] Spawn Agent button — hides label on mobile, shows only icon
- [x] Connection status text — hidden on mobile
- [x] Project name — hidden on mobile
- [x] Pipeline stepper — horizontal scroll on mobile, smaller gaps/padding
- [x] Stage time labels — hidden on mobile
- [x] Connector lines — shorter on mobile
- [x] Agent sidebar — dropdown `<select>` on mobile (< md), full sidebar on desktop
- [x] SpawnDialog / KillConfirmDialog — `mx-4` margin for mobile safe area

**Accessibility:**
- [x] Skip-to-content link (`sr-only` with focus reveal)
- [x] `role="tablist"` + `role="tab"` + `aria-selected` on nav items
- [x] `role="tabpanel"` on main content with `aria-label`
- [x] `role="alert"` on toast notifications
- [x] `aria-live="assertive"` on toast container
- [x] `aria-label` on icon-only buttons (Spawn, Theme toggle, Stop all, re-run)
- [x] `aria-label` on cost display
- [x] `role="status"` + `aria-live="polite"` + `aria-label` on connection indicator
- [x] `aria-hidden="true"` on decorative icons (status dots, stage icons, connector lines)
- [x] `role="list"` + `role="listitem"` on pipeline stages
- [x] `role="listbox"` + `role="option"` + `aria-selected` on agent sidebar
- [x] `aria-label` on each agent button with status
- [x] `role="log"` + `aria-live="polite"` + `aria-label` on OutputStream
- [x] `aria-expanded` on collapsible activity items
- [x] `role="dialog"` + `aria-modal` on SpawnDialog and KillConfirmDialog
- [x] Mobile agent `<select>` has `<label>` + `aria-label`

**Pipeline Controls:**
- [x] "Re-run" button on completed/errored stages (appears on hover, uses `run-stage` WS command)
- [x] "New build" button already exists in ResultsView

### Session 4 — Final polish

- [x] Focus trap in modal dialogs — `useFocusTrap` hook traps Tab/Shift+Tab, restores focus on close
- [x] Scroll position persistence — per-agent scroll position saved on switch and restored
- [x] Expanded/collapsed state per activity — tracked via `Set<string>` of activity IDs, persists across scroll

## Remaining (future)

- [ ] Larger breakpoints: optimize for >1920px ultra-wide displays
- [ ] Touch gesture support (swipe to dismiss toasts, swipe between views)
- [ ] High contrast mode for WCAG AAA compliance
