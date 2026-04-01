# Contributing to Swarm

Thanks for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/esanmohammad/swarm
cd swarm
npm install
npm run build
```

### Project Structure

- `packages/cli` — TypeScript CLI (Commander.js)
- `packages/dashboard` — React 19 + Vite + Tailwind web UI
- `prompts/` — Persona system prompts (5 personas x 6 tech stacks)

### Building

```bash
npm run build            # Build everything
npm run build:cli        # CLI only
npm run build:dashboard  # Dashboard only
```

### Running in Development

```bash
npm run dev              # CLI via tsx (auto-reload)
npm run dev:dashboard    # Dashboard via Vite HMR
```

### Testing Changes

```bash
npm run build:cli
swarm doctor             # Verify environment
swarm init && swarm status  # Smoke test
swarm dashboard          # Test dashboard
```

## Conventions

- ESM throughout (`"type": "module"`, `.js` import extensions)
- TypeScript strict mode
- CLI types: `packages/cli/src/types.ts`
- Dashboard types: `packages/dashboard/src/types.ts` (mirrored)

## Submitting Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm run build` to verify everything compiles
4. Open a PR with a clear description of what and why

## Reporting Issues

File issues at [github.com/esanmohammad/swarm/issues](https://github.com/esanmohammad/swarm/issues).

Include:
- What you expected vs. what happened
- Your Node.js version (`node --version`)
- Your Claude CLI version (`claude --version`)
- Relevant error output
