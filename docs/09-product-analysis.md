# Swarm Product Analysis — Internal Audit

> Internal document for contributors. Tracks known gaps, UX debt, and improvement opportunities.
> For the public-facing analysis, see [release/PRODUCT-ANALYSIS.md](../release/PRODUCT-ANALYSIS.md).

---

## Status

Swarm is a well-engineered prototype with a genuinely valuable core concept: **MayDay — describe a feature in plain English, get tested production code with automatic fix loops.** No other tool does this as a single command.

This document tracks what needs improvement before and after v1.0.

---

## Known UX Gaps

### Dashboard

| Issue | Severity | Status |
|-------|----------|--------|
| No responsive/mobile layout | High | Open |
| Missing ARIA labels and screen reader support | High | Open |
| Color-only status indicators (colorblind unfriendly) | Medium | Open |
| Text sizes below 12px in some components | Medium | Open |
| No onboarding tour for first-time users | Medium | Open |
| No search/filter in activity log | Medium | Open |
| No artifact preview mid-pipeline | Low | Open |
| No dark/light mode toggle | Low | Open |
| UI state lost on page reload | Low | Open |

### CLI

| Issue | Severity | Status |
|-------|----------|--------|
| Interactive vs non-interactive defaults inconsistent across stages | Medium | Open |
| No `swarm config view` command | Low | Open |
| No `swarm logs <agent>` for real-time log tailing | Low | Open |
| Multi-pipeline support undocumented | Low | Open |

### Cost & Safety

| Issue | Severity | Status |
|-------|----------|--------|
| No budget warning as limit approaches | Medium | Open |
| No git diff preview before auto-commit | Medium | Open |
| No undo/rollback for pipeline runs | Medium | Open |
| Cost breakdown per stage not shown | Low | Open |

---

## Improvement Roadmap

### Near-term (v0.2)
- Dashboard accessibility (ARIA labels, keyboard nav, contrast fixes)
- Output search and filter
- Budget warning notifications
- Per-stage cost breakdown
- Basic responsive layout

### Mid-term (v0.3)
- Onboarding tour in dashboard
- Template library for common features
- Git diff preview before commit
- Pipeline pause/resume from dashboard
- `swarm config view` command

### Long-term (v1.0)
- Full mobile responsive design
- Dark/light theme toggle
- Plugin marketplace / community plugins
- Multi-user collaboration
- CI/CD integration guides
