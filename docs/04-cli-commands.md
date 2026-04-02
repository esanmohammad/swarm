# CLI Commands Reference

This document covers every Swarm CLI command in detail: registration, options, internal execution flow, and how each command interacts with the core subsystems.

---

## 1. Command Registration

### Entry Point

The CLI entry point is `packages/cli/bin/swarm.ts`. It creates a Commander.js `Command` instance and registers all 11 commands in sequence:

```
bin/swarm.ts
  ├── registerInit(program)
  ├── registerAnalyze(program)
  ├── registerArchitect(program)
  ├── registerPlan(program)
  ├── registerBuild(program)
  ├── registerTest(program)
  ├── registerEvaluate(program)
  ├── registerStatus(program)
  ├── registerAgent(program)
  ├── registerDashboard(program)
  └── registerMayday(program)
```

Each `register*` function accepts the Commander `Command` instance and attaches a subcommand with its own description, options, arguments, and async action handler. The program is parsed with `program.parse()` at the end.

```mermaid
graph TD
    A[bin/swarm.ts] --> B[Commander Program]
    B --> C[program.parse]
    C --> D{Matched Command}
    D --> E[init]
    D --> F[analyze]
    D --> G[architect]
    D --> H[plan]
    D --> I[build]
    D --> J[test]
    D --> K[evaluate]
    D --> L[status]
    D --> M[agent]
    D --> N[dashboard]
    D --> O[mayday]
```

### Command Summary Table

| Command | Source File | Arguments | Pipeline Stage | Interactive Mode |
|---------|-----------|-----------|----------------|-----------------|
| `init` | `commands/init.ts` | None | N/A | No |
| `analyze` | `commands/analyze.ts` | `<feature-request>` | analyze | Yes (default) |
| `architect` | `commands/architect.ts` | None | architect | Yes (default) |
| `plan` | `commands/plan.ts` | None | plan | Yes (default) |
| `build` | `commands/build.ts` | None | build | No |
| `test` | `commands/test.ts` | None | test | Optional (`-i`) |
| `evaluate` | `commands/evaluate.ts` | None | evaluate | No |
| `status` | `commands/status.ts` | None | N/A | No |
| `agent` | `commands/agent.ts` | Subcommands | N/A | No |
| `dashboard` | `commands/dashboard.ts` | None | N/A | No |
| `mayday` | `commands/mayday.ts` | `[feature-request]` | All | No |

---

## 2. Shared Context

### The `createContext()` Factory

File: `packages/cli/src/commands/shared.ts`

Most commands (all except `init` and `status`) use `createContext()` to wire up the full runtime. It constructs and connects all core subsystems, then returns them as a `SwarmContext` object.

#### SwarmContext Interface

```typescript
interface SwarmContext {
  state: StateManager;          // Persists PipelineState to .swarm/state.json
  costTracker: CostTracker;     // Accumulates cost across agents
  promptLoader: PromptLoader;   // Resolves persona+stack to prompt files
  agentManager: AgentManager;   // Spawns, tracks, kills agents
  pipeline: Pipeline;           // Orchestrates the 4-stage workflow
  wsServer: SwarmWsServer;      // WebSocket server for dashboard communication
  cleanup: () => void;          // Kills agents, stops WS, flushes state
}
```

#### Construction Flow

```mermaid
graph TD
    A[createContext] --> B[StateManager]
    A --> C[CostTracker]
    A --> D["PromptLoader(config.promptsDir)"]
    A --> E["AgentManager(state, costTracker, promptLoader, config)"]
    A --> F["Pipeline(agentManager, state, config)"]
    A --> G["SwarmWsServer(state, agentManager, config, cwd)"]
    A --> H[cleanup function]
    H --> H1[agentManager.killAll]
    H --> H2[wsServer.stop]
    H --> H3[state.flush]
    A --> I[Register SIGINT/SIGTERM]
    I --> H
```

#### Signal Handling

`createContext()` replaces any existing `SIGINT`/`SIGTERM` listeners with a single handler that calls `cleanup()` and exits. This ensures all agents are killed, the WebSocket server is stopped, and state is flushed to disk on any termination.

```typescript
// Cleanup handler registered once per process
const onExit = () => {
  cleanup();      // killAll + stop WS + flush state
  process.exit(0);
};
process.removeAllListeners('SIGINT');
process.removeAllListeners('SIGTERM');
process.on('SIGINT', onExit);
process.on('SIGTERM', onExit);
```

#### Standard Command Pattern

Almost every pipeline command follows this pattern:

```mermaid
sequenceDiagram
    participant User
    participant CLI as Command Handler
    participant Config as requireSwarmDir + loadConfig
    participant Context as createContext()
    participant Pipeline
    participant AM as AgentManager
    participant AP as AgentProcess

    User->>CLI: swarm <command> [args]
    CLI->>Config: requireSwarmDir()
    Config-->>CLI: swarmDir path
    CLI->>Config: loadConfig()
    Config-->>CLI: SwarmConfig
    CLI->>Context: createContext(swarmDir, config)
    Context-->>CLI: SwarmContext
    CLI->>Pipeline: pipeline.run*()
    Pipeline->>AM: spawn(agentOpts)
    AM->>AP: new AgentProcess(claude subprocess)
    AP-->>AM: content/result/exit events
    AM-->>Pipeline: agent completion
    Pipeline-->>CLI: success/error
    CLI->>Context: cleanup()
```

---

## 3. Commands

---

### 3.1 `swarm init`

Initializes a new Swarm project in the current working directory by creating the `.swarm/` configuration directory and all required files.

#### Options

| Flag | Long Form | Description | Default |
|------|-----------|-------------|---------|
| `-s` | `--stack <stack>` | Tech stack: `react`, `node`, `go` | `react` |
| `-m` | `--model <model>` | Default model: `sonnet`, `opus`, `haiku` | `opus` |
| `-b` | `--budget <amount>` | Max budget per agent in USD (0 = no limit) | `0` |
| `-n` | `--name <name>` | Project name | Directory name |

#### Behavior

- If `.swarm/` already exists, prints a warning and exits without changes.
- Derives the project name from the `-n` flag or falls back to the current directory name.
- Parses budget as a float; `0` or non-numeric values resolve to `null` (no limit).

#### Files Created

```mermaid
graph TD
    A[swarm init] --> B[".swarm/"]
    B --> C["config.yaml<br/>(SwarmConfig with stack, model, budget)"]
    B --> D["guardrails.yaml<br/>(default example rule)"]
    B --> E["state.json<br/>(empty PipelineState)"]
    B --> F["playwright.config.yaml<br/>(scaffold with commented options)"]
    B --> G[".gitignore<br/>(ignores state.json, logs/)"]
    B --> H["logs/<br/>(empty directory)"]
```

#### Internal Flow

```mermaid
flowchart TD
    A[Start] --> B{.swarm/ exists?}
    B -->|Yes| C[Print warning, return]
    B -->|No| D[Resolve project name]
    D --> E[Build SwarmConfig from defaults + options]
    E --> F["mkdirSync(.swarm/)"]
    F --> G["mkdirSync(.swarm/logs/)"]
    G --> H[Write config.yaml]
    H --> I[Write guardrails.yaml]
    I --> J[Write state.json]
    J --> K[Write playwright.config.yaml]
    K --> L[Write .gitignore]
    L --> M["Print summary: name, stack, model, budget"]
    M --> N["Print: Next: swarm analyze ..."]
```

#### Default Guardrails

The generated `guardrails.yaml` includes a single example rule:

```yaml
rules:
  - name: "Custom: example rule"
    target: REQUIREMENTS.md
    checks:
      - type: section-exists
        value: Summary
        message: REQUIREMENTS.md should have a Summary section
        severity: warning
```

#### Notable Details

- Does **not** call `createContext()` -- it operates directly on the filesystem.
- Does **not** require an existing `.swarm/` directory (it creates one).
- Uses the `yaml` package's `stringify` function to serialize config and guardrails.
- `createEmptyPipeline()` from `types.ts` generates the initial state structure.

---

### 3.2 `swarm analyze <feature-request>`

Runs the **Analyst** persona to produce `REQUIREMENTS.md` from a feature request.

#### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `<feature-request>` | Yes | Feature request text, or a file path if `--file` is set |

#### Options

| Flag | Long Form | Description | Default |
|------|-----------|-------------|---------|
| `-s` | `--stack <stack>` | Tech stack override | Config value |
| `-m` | `--model <model>` | Model override | Config value |
| `-f` | `--file` | Treat argument as file path to read | `false` |
| | `--figma <url>` | Figma design URL to pass to the analyst | None |
| | `--no-interactive` | Run in single-shot mode (no conversation) | Interactive on |

#### Execution Modes

**Interactive mode (default):** The analyst agent bootstraps with the prompt in headless mode, captures the initial response, then resumes with `claude --resume <session-id>` using `stdio: 'inherit'` so the user can converse directly in the terminal. No spinner is shown.

**Non-interactive mode (`--no-interactive`):** The analyst runs as a single-shot headless agent. An `ora` spinner displays during execution. Output is captured programmatically.

#### Internal Flow

```mermaid
flowchart TD
    A[swarm analyze] --> B[requireSwarmDir]
    B --> C[loadConfig + apply model override]
    C --> D{--file flag?}
    D -->|Yes| E[Read prompt from file]
    D -->|No| F[Use argument as prompt text]
    E --> G[Resolve stack from --stack or config]
    F --> G
    G --> H["createContext(swarmDir, config)"]
    H --> I{Interactive?}
    I -->|Yes| J["pipeline.runAnalyze(prompt, {stack, interactive: true, figmaUrl})"]
    I -->|No| K[Start ora spinner]
    K --> L["pipeline.runAnalyze(prompt, {stack, interactive: false, figmaUrl})"]
    J --> M[cleanup]
    L --> N[spinner.succeed]
    N --> M
    M --> O[End]
```

#### Output Artifact

- **REQUIREMENTS.md** -- Written to the project root by the analyst persona.
- The analyst persona is strictly bounded: no architecture decisions, no code, no task breakdowns.

---

### 3.3 `swarm architect`

Runs the **Architect** persona to produce `SPEC.md` from `REQUIREMENTS.md`.

#### Options

| Flag | Long Form | Description | Default |
|------|-----------|-------------|---------|
| `-s` | `--stack <stack>` | Tech stack override | Config value |
| `-m` | `--model <model>` | Model override | Config value |
| | `--no-interactive` | Run in single-shot mode | Interactive on |

#### Prerequisites

- `.swarm/` directory must exist (`requireSwarmDir()`).
- `REQUIREMENTS.md` must exist in the project root (read by the pipeline internally).

#### Internal Flow

```mermaid
flowchart TD
    A[swarm architect] --> B[requireSwarmDir + loadConfig]
    B --> C[Apply model override if provided]
    C --> D[Resolve stack]
    D --> E["createContext(swarmDir, config)"]
    E --> F{Interactive?}
    F -->|Yes| G["pipeline.runArchitect({stack, interactive: true})"]
    F -->|No| H[Start ora spinner]
    H --> I["pipeline.runArchitect({stack, interactive: false})"]
    G --> J[cleanup]
    I --> K[spinner.succeed]
    K --> J
```

#### Output Artifact

- **SPEC.md** -- Architecture specification document.
- The architect persona is bounded: no code, no task breakdown.

---

### 3.4 `swarm plan`

Runs the **Lead** persona to produce `TASKS.md` from `SPEC.md`.

#### Options

| Flag | Long Form | Description | Default |
|------|-----------|-------------|---------|
| `-s` | `--stack <stack>` | Tech stack override | Config value |
| `-m` | `--model <model>` | Model override | Config value |
| | `--no-interactive` | Run in single-shot mode | Interactive on |

#### Prerequisites

- `SPEC.md` must exist in the project root.

#### Internal Flow

```mermaid
flowchart TD
    A[swarm plan] --> B[requireSwarmDir + loadConfig]
    B --> C[Apply model override]
    C --> D[Resolve stack]
    D --> E["createContext(swarmDir, config)"]
    E --> F{Interactive?}
    F -->|Yes| G["pipeline.runPlan({stack, interactive: true})"]
    F -->|No| H[Start ora spinner]
    H --> I["pipeline.runPlan({stack, interactive: false})"]
    G --> J[cleanup]
    I --> K[spinner.succeed]
    K --> J
```

#### Output Artifact

- **TASKS.md** -- Structured task list with IDs (e.g., `FND-001`, `SVC-002`) and parallel group markers.
- The lead persona is bounded: no code, no architecture redesign.

---

### 3.5 `swarm build`

Runs **Engineer** persona(s) to implement the tasks defined in `TASKS.md`. Always runs in non-interactive (headless) mode.

#### Options

| Flag | Long Form | Description | Default |
|------|-----------|-------------|---------|
| `-s` | `--stack <stack>` | Tech stack override | Config value |
| `-m` | `--model <model>` | Model override | Config value |
| `-p` | `--parallel <n>` | Maximum parallel agents | `3` |
| `-t` | `--task <id>` | Run a specific task ID only | None (all tasks) |

#### Prerequisites

- `TASKS.md` must exist in the project root.

#### Execution Model

The pipeline parses `TASKS.md` using `Pipeline.parseTaskGroups()` to extract task IDs organized into parallel execution groups. Engineers are spawned as headless agents, up to the `--parallel` limit at a time.

**Single task mode:** When `--task <id>` is provided, only that specific task is executed.

#### Internal Flow

```mermaid
flowchart TD
    A[swarm build] --> B[requireSwarmDir + loadConfig]
    B --> C[Apply model override]
    C --> D[Resolve stack]
    D --> E["createContext(swarmDir, config)"]
    E --> F[Start ora spinner]
    F --> G{"--task provided?"}
    G -->|Yes| H["pipeline.runBuild({stack, parallel, taskId})"]
    G -->|No| I["pipeline.runBuild({stack, parallel})"]
    H --> J{Success?}
    I --> J
    J -->|Yes| K[spinner.succeed]
    J -->|No| L[spinner.fail + exit 1]
    K --> M["Print costTracker.formatTotal()"]
    M --> N[cleanup]
    L --> N
```

#### Parallel Execution Model

```mermaid
graph TD
    A[TASKS.md] --> B["parseTaskGroups()"]
    B --> C[Group 1: FND-001, FND-002]
    B --> D[Group 2: SVC-001, SVC-002, SVC-003]
    B --> E[Group 3: INT-001]

    C --> F["Spawn up to N engineers in parallel"]
    F -->|All complete| D
    D --> G["Spawn up to N engineers in parallel"]
    G -->|All complete| E
    E --> H["Spawn up to N engineers in parallel"]
    H --> I[Build complete]
```

---

### 3.6 `swarm test`

Generates a test plan (`TESTPLAN.md`) and runs test-runner agents. Supports both interactive and non-interactive modes.

#### Options

| Flag | Long Form | Description | Default |
|------|-----------|-------------|---------|
| `-s` | `--stack <stack>` | Tech stack override | Config value |
| `-m` | `--model <model>` | Model override | Config value |
| `-p` | `--parallel <n>` | Max parallel agents | `2` |
| | `--figma <url>` | Figma design URL for visual test cases | None |
| `-i` | `--interactive` | Run tester in interactive mode | `false` |

#### Two-Phase Execution

**Phase 1 -- Test Plan Generation:** If `TESTPLAN.md` does not already exist, a test-engineer agent generates it based on the existing artifacts (REQUIREMENTS.md, SPEC.md, TASKS.md, and the codebase).

**Phase 2 -- Test Execution:** Test runner agents are spawned to execute the test plan. When `--figma` is provided, visual test cases are included.

#### Internal Flow

```mermaid
flowchart TD
    A[swarm test] --> B[requireSwarmDir + loadConfig]
    B --> C[Apply model override]
    C --> D[Resolve stack]
    D --> E["createContext(swarmDir, config)"]
    E --> F{Interactive?}
    F -->|Yes| G["pipeline.runTest({stack, parallel, figmaUrl, interactive: true})"]
    F -->|No| H[Start ora spinner]
    H --> I["pipeline.runTest({stack, parallel, figmaUrl})"]
    G --> J[cleanup]
    I --> K[spinner.succeed]
    K --> L["Print costTracker.formatTotal()"]
    L --> J
```

---

### 3.7 `swarm evaluate` (alias: `eval`)

Validates project artifacts against guardrail rules defined in `.swarm/guardrails.yaml`. This command does **not** use `createContext()` -- it directly instantiates `StateManager` and `GuardrailsEngine`.

#### Options

None.

#### Guardrail Check Types

| Check Type | Description |
|-----------|-------------|
| `section-exists` | Verifies a markdown section heading exists in the target file |
| `pattern-match` | Tests a regex pattern against the target file content |
| `command` | Runs a shell command and checks the exit code |

#### Internal Flow

```mermaid
flowchart TD
    A[swarm evaluate] --> B[requireSwarmDir]
    B --> C[new StateManager]
    C --> D[new GuardrailsEngine]
    D --> E["state.updateStage('evaluate', running)"]
    E --> F["engine.evaluate(cwd)"]
    F --> G[Persist violations to state]
    G --> H{Violations found?}
    H -->|None| I["state.updateStage('evaluate', done)"]
    I --> J[state.flush]
    J --> K["Print: All checks passed"]
    H -->|Found| L[Print errors and warnings]
    L --> M{Any errors?}
    M -->|Yes| N["state.updateStage('evaluate', error)"]
    N --> O[state.flush]
    O --> P[exit 1]
    M -->|No warnings only| Q["state.updateStage('evaluate', done)"]
    Q --> R[state.flush]
    R --> S[Print warning count]
```

#### Output Format

Violations are displayed with color-coded severity:

- **Errors** (`FAIL`): Red. Block the pipeline. Exit code 1.
- **Warnings** (`WARN`): Yellow. Do not block. Exit code 0.

Each violation shows the message, the relative file path, and the rule name:

```
  FAIL  REQUIREMENTS.md should have a Summary section
       REQUIREMENTS.md [Custom: example rule]
```

Violations are also persisted to `state.json` so the dashboard can display them.

---

### 3.8 `swarm status`

Displays the current pipeline state and agent status. Read-only command that does **not** use `createContext()` -- it directly reads from `StateManager`.

#### Options

None.

#### Display Sections

1. **Project header** -- Name and tech stack.
2. **Pipeline stages table** -- All 6 stages with status, artifact path, and agent count.
3. **Agents table** -- Name, status, cost, token counts (input/output), and duration.
4. **Total cost summary** -- Aggregate USD cost and token counts.

#### Status Color Coding

| Status | Color |
|--------|-------|
| `pending` | Gray |
| `running` | Cyan |
| `done` | Green |
| `error` | Red |
| `killed` | Yellow |
| `skipped` | Dim |

#### Internal Flow

```mermaid
flowchart TD
    A[swarm status] --> B[requireSwarmDir]
    B --> C[new StateManager]
    C --> D[state.getState]
    D --> E[Print project name + stack]
    E --> F[Print pipeline stages table]
    F --> G{Agents exist?}
    G -->|Yes| H[Print agents table]
    G -->|No| I[Skip agents section]
    H --> J{Total cost > 0?}
    I --> J
    J -->|Yes| K[Print total cost + tokens]
    J -->|No| L[End]
    K --> L
```

#### Pipeline Stages Displayed

| Stage | Label |
|-------|-------|
| `analyze` | Analyze |
| `architect` | Architect |
| `plan` | Plan |
| `build` | Build |
| `test` | Test |
| `evaluate` | Evaluate |

---

### 3.9 `swarm agent`

Parent command with three subcommands for managing individual agents outside the pipeline.

---

#### 3.9.1 `swarm agent spawn <name>`

Spawns a named agent with a specific persona and waits for it to complete.

##### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `<name>` | Yes | Agent name (used for identification and display) |

##### Options

| Flag | Long Form | Description | Default |
|------|-----------|-------------|---------|
| | `--persona <persona>` | **Required.** Persona type: `analyst`, `architect`, `lead`, `engineer` | None |
| `-s` | `--stack <stack>` | Tech stack | Config value |
| `-m` | `--model <model>` | Model override | Config value |
| | `--prompt <prompt>` | Task prompt (text or file path) | Auto-generated |
| | `--file` | Treat prompt as file path | `false` |
| | `--budget <amount>` | Max budget for this agent in USD | None |

##### Internal Flow

```mermaid
flowchart TD
    A["swarm agent spawn myagent --persona engineer"] --> B[requireSwarmDir + loadConfig]
    B --> C[Resolve stack and persona]
    C --> D{--file and --prompt?}
    D -->|Yes| E[Read prompt from file]
    D -->|No| F["Use --prompt or default prompt"]
    E --> G["createContext(swarmDir, config)"]
    F --> G
    G --> H[Start ora spinner]
    H --> I["agentManager.spawn({name, persona, stack, prompt, model, maxBudgetUsd, cwd})"]
    I --> J["spinner.text = running (short ID)"]
    J --> K["agentManager.waitForAgent(id)"]
    K --> L[spinner.succeed]
    L --> M["Print costTracker.formatTotal()"]
    M --> N[cleanup]
```

If no `--prompt` is provided, a default prompt is generated: `"Execute the {persona} workflow for a {stack} project"`.

---

#### 3.9.2 `swarm agent list`

Lists all agents from the persisted state.

##### Internal Flow

```mermaid
flowchart TD
    A[swarm agent list] --> B[requireSwarmDir + loadConfig]
    B --> C["createContext(swarmDir, config)"]
    C --> D[state.getState]
    D --> E{Agents exist?}
    E -->|No| F["Print: No agents found"]
    E -->|Yes| G[For each agent: print name, persona, stack, ID, status, cost]
```

Displays each agent with:
- Name (bold), persona/stack in parentheses
- ID (dimmed), status (color-coded), cost in USD

---

#### 3.9.3 `swarm agent kill <name-or-id>`

Kills a running agent by name or UUID.

##### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `<name-or-id>` | Yes | Agent name or UUID |

##### Internal Flow

```mermaid
flowchart TD
    A["swarm agent kill myagent"] --> B[requireSwarmDir + loadConfig]
    B --> C["createContext(swarmDir, config)"]
    C --> D["agentManager.getByName(nameOrId)"]
    D --> E{Found?}
    E -->|No| F["agentManager.get(nameOrId)"]
    F --> G{Found?}
    G -->|No| H["Error: Agent not found, exit 1"]
    E -->|Yes| I["agentManager.kill(id)"]
    G -->|Yes| I
    I --> J{Was running?}
    J -->|Yes| K["Print: Killed agent"]
    J -->|No| L["Print: Agent was not running"]
```

The command first tries to find the agent by name, then by ID. The `kill()` method returns `true` if the agent was actually running and was terminated.

---

### 3.10 `swarm dashboard`

Starts the web dashboard: an HTTP server for the React UI and a WebSocket server for real-time state synchronization.

#### Options

| Flag | Long Form | Description | Default |
|------|-----------|-------------|---------|
| | `--no-open` | Do not auto-open the browser | Auto-open on |

#### Ports

| Service | Default Port | Config Key |
|---------|-------------|------------|
| HTTP (dashboard UI) | 3848 | `config.dashboardPort` |
| WebSocket | 3847 | `config.wsPort` |

#### Internal Flow

```mermaid
flowchart TD
    A[swarm dashboard] --> B[requireSwarmDir + loadConfig]
    B --> C["createContext(swarmDir, config)"]
    C --> D["state.cleanupStaleAgents()"]
    D --> E["wsServer.start(wsPort)"]
    E --> F["Resolve dashboard dist path"]
    F --> G{index.html exists?}
    G -->|Yes| H["createServer(static file handler)"]
    H --> I["server.listen(dashboardPort)"]
    I --> J{--no-open?}
    J -->|No| K["open(url) — launch browser"]
    J -->|Yes| L[Skip browser open]
    K --> M[Register SIGINT handler]
    L --> M
    M --> N["Wait (process stays alive)"]
    G -->|No| O["Print: Dashboard not built"]
    O --> P["Print: WS server still running"]
    P --> Q[Register SIGINT handler]
    Q --> N
```

#### Dashboard Path Resolution

The dashboard static files are resolved relative to the compiled CLI module location:

```
dist/src/commands/dashboard.js
  → ../../../../dashboard/dist/
```

This traverses 4 directory levels from the compiled command file to reach `packages/dashboard/dist/`.

#### Static File Server

The built-in HTTP server handles:
- `/` maps to `/index.html`
- Known file extensions are served with correct MIME types (`html`, `js`, `css`, `json`, `svg`, `png`)
- Unknown routes fall back to `index.html` (SPA routing support)

#### Stale Agent Cleanup

On startup, `state.cleanupStaleAgents()` runs to:
- Remove all agents with `done` status from previous sessions.
- Mark any agents still in `running` status as `error` (orphaned processes).

#### Shutdown

The dashboard registers its own `SIGINT` handler that:
1. Closes the HTTP server.
2. Calls `cleanup()` (kills agents, stops WS, flushes state).
3. Exits with code 0.

---

### 3.11 `swarm mayday [feature-request]`

Autonomous end-to-end pipeline that runs analyze, architect, plan, build, test, and evaluate in sequence, with an automatic fix loop that iterates until all tests pass or the iteration limit is reached.

#### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `[feature-request]` | Conditional | Required for new runs; not needed with `--resume` |

#### Options

| Flag | Long Form | Description | Default |
|------|-----------|-------------|---------|
| `-s` | `--stack <stack>` | Tech stack override | Config value |
| `-m` | `--model <model>` | Model override | Config value |
| `-p` | `--parallel <n>` | Max parallel agents | `3` |
| `-n` | `--max-iterations <n>` | Max fix-retest iterations | `5` |
| | `--figma <url>` | Figma design URL | None |
| `-f` | `--file` | Treat argument as file path to read | `false` |
| | `--resume` | Resume a previously interrupted session | `false` |

#### Two Execution Modes

**New run:** Requires a `feature-request` argument. Runs the full pipeline from analyze through evaluate with the fix loop.

**Resume mode (`--resume`):** Reads the persisted `MaydayState` from state and continues from where it left off. No feature request argument needed.

#### Internal Flow

```mermaid
flowchart TD
    A[swarm mayday] --> B[requireSwarmDir + loadConfig]
    B --> C[Apply model override]
    C --> D{"--resume flag?"}
    D -->|Yes| E[state.getMayday]
    E --> F{Active session?}
    F -->|Yes| G["pipeline.resumeMayday({parallel})"]
    F -->|No| H["Error: No active session, exit 1"]
    D -->|No| I{feature-request provided?}
    I -->|No| J["Error: Feature request required, exit 1"]
    I -->|Yes| K{"--file flag?"}
    K -->|Yes| L[Read prompt from file]
    K -->|No| M[Use argument as prompt]
    L --> N["pipeline.runMayday(prompt, {stack, maxIterations, figmaUrl, parallel})"]
    M --> N
    G --> O[cleanup]
    N --> O
```

#### Autonomous Fix Loop

```mermaid
graph TD
    A[Analyze] --> B[Architect]
    B --> C[Plan]
    C --> D[Build]
    D --> E[Test]
    E --> F{Tests pass?}
    F -->|Yes| G[Evaluate]
    G --> H[Done]
    F -->|No| I{Iterations < max?}
    I -->|Yes| J[Fix: spawn engineer to fix failures]
    J --> E
    I -->|No| K[Exit with error: max iterations reached]
```

The `MaydayState` is persisted to `state.json` after each phase, enabling the `--resume` capability. This allows interrupted sessions to continue from the last completed phase rather than restarting from scratch.

---

## 4. Generic Command Execution Flow

The following sequence diagram shows the complete lifecycle of a typical pipeline command (analyze, architect, plan, build, test):

```mermaid
sequenceDiagram
    actor User
    participant CLI as bin/swarm.ts
    participant Cmd as Command Handler
    participant Cfg as Config Module
    participant Ctx as createContext()
    participant SM as StateManager
    participant CT as CostTracker
    participant PL as PromptLoader
    participant AM as AgentManager
    participant Pipe as Pipeline
    participant AP as AgentProcess
    participant Claude as claude subprocess

    User->>CLI: swarm analyze "build a login page"
    CLI->>Cmd: registerAnalyze action handler
    Cmd->>Cfg: requireSwarmDir()
    Cfg-->>Cmd: /path/to/.swarm
    Cmd->>Cfg: loadConfig()
    Cfg-->>Cmd: SwarmConfig object

    Cmd->>Ctx: createContext(swarmDir, config)
    Ctx->>SM: new StateManager(swarmDir)
    Ctx->>CT: new CostTracker()
    Ctx->>PL: new PromptLoader(promptsDir)
    Ctx->>AM: new AgentManager(SM, CT, PL, config)
    Ctx->>Pipe: new Pipeline(AM, SM, config)
    Ctx-->>Cmd: SwarmContext

    Cmd->>Pipe: pipeline.runAnalyze(prompt, opts)
    Pipe->>PL: resolve("analyst", stack)
    PL-->>Pipe: system prompt text
    Pipe->>SM: updateStage("analyze", running)
    Pipe->>AM: spawn({persona, stack, prompt, systemPrompt})

    AM->>AP: new AgentProcess(claude args)
    AP->>Claude: claude -p "prompt" --output-format stream-json --verbose

    loop Stream Processing
        Claude-->>AP: NDJSON lines
        AP-->>AM: content event (msg.message.content[].text)
        AM-->>SM: update agent output + state
    end

    Claude-->>AP: result event (cost data)
    AP-->>AM: result event
    AM-->>CT: add cost
    AM-->>SM: update agent status + cost

    Claude-->>AP: exit event
    AP-->>AM: agent complete
    AM-->>Pipe: agent done

    Pipe->>SM: updateStage("analyze", done)
    Pipe-->>Cmd: success

    Cmd->>Ctx: cleanup()
    Ctx->>AM: killAll()
    Ctx->>SM: flush()
```

### Key Points

- **State persistence** happens at every significant event (agent spawn, content update, completion, error) via `StateManager`, which debounces writes to `.swarm/state.json` at 100ms intervals.
- **Cost tracking** accumulates across all agents for the session. The `CostTracker` aggregates input tokens, output tokens, and USD cost from `result` events.
- **WebSocket broadcasting** occurs when the dashboard is running -- `StateManager` emits events that `SwarmWsServer` relays to connected dashboard clients. Cross-process updates are detected via `fs.watch()` on `state.json`.
- **Prompt resolution** follows a search chain: custom directory (from config), bundled `prompts/` directory, `~/.claude/prompts/`, then `~/.claude/prompt/`. Filename casing varies by persona (e.g., `analyst-react.md` vs `Architect-React.md`).
- **Cleanup** is guaranteed via both explicit `cleanup()` calls in `finally` blocks and the registered `SIGINT`/`SIGTERM` handlers.
