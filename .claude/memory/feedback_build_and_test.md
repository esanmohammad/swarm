---
name: Build and alias workflow
description: User expects build + alias update in one step after changes
type: feedback
---

After making code changes, always run `npm run build` (or `npm run build:cli` for CLI-only changes) before telling the user to test. The alias `swarm` points to `dist/bin/swarm.js` so rebuilding is sufficient — no alias update needed unless the path changes.

**Why:** User got confused when told "try it" without a rebuild step.
**How to apply:** After any source file edit, rebuild before confirming the fix. Run `npm run build` for both packages, or `npm run build:cli` if only CLI changed.
