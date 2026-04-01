# Troubleshooting

Common issues and how to fix them. Run `swarm doctor` first — it catches most problems automatically.

---

## Installation Issues

### `command not found: swarm`

The global npm install didn't link the binary to your PATH.

```bash
# Option 1: Reinstall globally
npm install -g swarm-pipeline

# Option 2: Use npx instead
npx swarm-pipeline "your feature"

# Option 3: Check your npm global bin directory is in PATH
npm config get prefix
# Add <prefix>/bin to your PATH if it's not there
```

### `command not found: claude`

Claude Code CLI is not installed or not in your PATH.

```bash
npm install -g @anthropic-ai/claude-code
claude --version  # Should print a version number
```

If it prints a version but `swarm doctor` still fails, your shell might need a restart:
```bash
exec $SHELL
```

### `Node.js version too old`

Swarm requires Node.js 18+.

```bash
node --version  # Check current version
```

Upgrade via [nodejs.org](https://nodejs.org/) or your package manager:
```bash
# macOS with Homebrew
brew install node

# nvm
nvm install 18
nvm use 18
```

---

## Runtime Issues

### Pipeline stops with no error

**Cause:** Budget cap reached. The default is $5 per pipeline.

```bash
swarm status           # Check current spend
swarm "feature" --budget 15   # Increase budget
swarm "feature" --budget none # No limit (use carefully)
```

### Agent seems stuck / no output

Agents have a 30-minute inactivity timeout. If an agent appears stuck:

```bash
swarm agent list       # See agent status
swarm agent kill <name> # Force stop it
```

If this keeps happening, the prompt may be too vague. Try being more specific:
```bash
# Too vague
swarm "make it better"

# Better
swarm "Add a search bar to the header that filters products by name"
```

### `state.json` corrupted

```bash
swarm recover          # Restores from state.json.bak
```

If the backup is also corrupted:
```bash
rm .swarm/state.json .swarm/state.json.bak
swarm init             # Reinitialize (you'll lose pipeline history)
```

### Dashboard won't open / port in use

```bash
# Check what's using the port
lsof -i :3848

# Option 1: Kill the old process
kill <PID>

# Option 2: Change the port in .swarm/config.yaml
# dashboardPort: 4000
# wsPort: 4001
```

### Dashboard shows "Connecting..." forever

1. Make sure the CLI is running: `swarm dashboard` must stay open in terminal
2. Check that `wsPort` in `.swarm/config.yaml` matches what the dashboard expects
3. Check browser console for WebSocket errors

### `stream-json` parsing errors

This usually means the Claude CLI output format changed. Ensure you have the latest Claude CLI:
```bash
npm update -g @anthropic-ai/claude-code
```

---

## Cost Issues

### How do I see what I've spent?

```bash
swarm status           # Current pipeline cost breakdown
swarm audit            # Full cost history across all runs
```

### How do I reduce costs?

1. Use cheaper models for early stages:
   ```yaml
   # .swarm/config.yaml
   models:
     analyst: haiku       # Cheapest
     architect: sonnet    # Mid-tier
     engineer: opus       # Best quality where it matters
   ```

2. Lower the budget cap: `swarm "feature" --budget 3`

3. Run stages individually to review before proceeding:
   ```bash
   swarm analyze "feature"   # Review REQUIREMENTS.md
   swarm architect            # Review SPEC.md before spending on build
   ```

---

## Getting Help

1. Run `swarm doctor` — it checks everything automatically
2. Check this troubleshooting guide
3. File an issue at [github.com/esanmohammad/swarm/issues](https://github.com/esanmohammad/swarm/issues) with:
   - Output of `swarm doctor`
   - What you expected vs. what happened
   - Your Node.js and Claude CLI versions
