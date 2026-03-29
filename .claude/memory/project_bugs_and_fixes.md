---
name: Swarm bugs found and fixed during development
description: Key bugs discovered during the build session — reference these to avoid regressions
type: project
---

## Bugs Fixed

1. **stream-json requires --verbose**: Claude CLI errors with "stream-json requires --verbose" in print mode. Fix: always pass `--verbose` with `--output-format stream-json`.

2. **Wrong JSON path for content**: Claude CLI stream-json emits `{"type":"assistant","message":{"content":[...]}}` — content is at `msg.message.content`, NOT `msg.content`. This broke output streaming to dashboard.

3. **Dashboard dist path off by one**: `dashboard.ts` resolved dashboard dist path relative to `dist/src/commands/` but was one `..` short. Needed 4 levels up from commands dir to reach `packages/dashboard/dist/`.

4. **`--prompt` flag doesn't exist**: Interactive mode tried `--prompt` which isn't a Claude CLI flag. Fix: two-step approach — bootstrap with `-p` (non-interactive), then `--resume <session-id>` (interactive stdio inherited).

5. **Agents stuck as "running"**: Interactive mode `exit` event fires before `result` event. Fix: 100ms timeout fallback in exit handler to mark agent as done if result hasn't fired.

6. **Stale agents on dashboard restart**: Old completed agents persisted in state.json. Fix: `cleanupStaleAgents()` called on dashboard startup clears finished agents and resets orphaned running agents.

7. **"Default (Ask)" permission mode can't work headless**: Dashboard agents run in `-p` mode with no stdin. Fix: removed "ask" from dashboard permission options.

**Why:** These are non-obvious issues that could easily regress.
**How to apply:** When modifying agent-process.ts, ws-server.ts, or pipeline.ts, verify these invariants still hold.
