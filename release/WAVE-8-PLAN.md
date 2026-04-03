# Swarm — Wave 8: ULTRAPLAN — Multi-LLM Architecture

> **The Vendor Lock-in Problem**: Swarm shells out to the `claude` CLI binary for everything. Every agent is a `spawn('claude', ...)`. Every stream is Claude's NDJSON format. Every session is Claude's `--resume`. Users can't use GPT-4, Gemini, Llama, DeepSeek, Mistral, or any other model — even for stages where Claude isn't needed.
>
> Wave 8 makes Swarm model-agnostic. Claude remains the default and the best experience, but users can plug in any LLM — commercial or open-source, cloud or local.
>
> **Core principle: Any model that can chat can participate. Any model that can use tools can build.**
>
> Date: 2026-04-03

---

## The Problem — Architecture Audit

### Current Coupling Points (Hard Dependencies on Claude CLI)

| Location | Coupling | Severity |
|----------|---------|----------|
| `agent-process.ts` lines 94, 155, 181 | `spawn('claude', [...])` — binary name hardcoded | **Critical** |
| `agent-process.ts` lines 274-318 | `buildCommonArgs()` / `buildNonInteractiveArgs()` — Claude CLI flags (`-p`, `--output-format stream-json`, `--verbose`, `--session-id`, `--resume`, `--system-prompt`, `--model`, `--max-budget-usd`, `--permission-mode`, `--allowedTools`) | **Critical** |
| `agent-process.ts` lines 352-492 | `parseStreamJson()` — Claude's NDJSON format (`msg.type === 'result'`, `msg.message.content[]`, `total_cost_usd`, thinking blocks, sub-agent tracking) | **Critical** |
| `agent-manager.ts` | `sendInput()` / `resumeSession()` — relies on Claude's `--resume` session system | **High** |
| `agent-manager.ts` | Cost accumulation — expects `total_cost_usd` from Claude CLI | **High** |
| `pipeline.ts` | Model names: `opus`, `sonnet`, `haiku` — no provider prefix | **Medium** |
| `config.ts` | `defaultModel: 'sonnet'` — Claude shorthand only | **Medium** |
| `types.ts` | `PermissionMode`, `allowedTools`, `disallowedTools` — Claude Code concepts | **Medium** |
| `types.ts` | `CostInfo.cacheReadTokens`, `cacheWriteTokens` — Claude-specific fields | **Low** |
| `types.ts` | `ClaudeStreamMessage` type — entire type is Claude-specific | **Low** |
| All persona prompts in `prompts/` | Written for Claude's persona system; reference Claude Code tools | **Medium** |

### The Fundamental Challenge

Swarm doesn't just call an LLM API — it spawns a **full agent** (Claude Code) that can:
- Read/edit/write files
- Run shell commands
- Search codebases
- Spawn sub-agents
- Manage its own tool permissions

Other LLMs accessed via API **don't have these agentic capabilities built in**. A raw GPT-4 API call can generate text, but it can't edit your files. This means:

1. **For text-generation stages** (analyst, architect, lead) — any LLM works via API
2. **For agentic stages** (engineer, tester) — need either Claude Code OR a custom agent runtime that provides tool execution on top of raw LLM API calls

---

## Industry Analysis — How Others Solve This

### Model Abstraction Patterns

| Tool | Approach | Pros | Cons |
|------|----------|------|------|
| **LiteLLM** | Python proxy; translates all providers to OpenAI format | 100+ providers, single function call | Python-only, runtime dependency |
| **Vercel AI SDK** | TypeScript provider packages (`@ai-sdk/anthropic`, `@ai-sdk/openai`) | Native TS, streaming, tool calling unified | Node.js only, provider packages needed |
| **OpenRouter** | Hosted proxy; one API key for all models | Zero setup, transparent pricing | Adds latency, single point of failure |
| **Portkey** | AI gateway; config-driven routing, fallbacks, caching | Enterprise features, observability | Managed service, adds cost |
| **LangChain** | Abstract `BaseChatModel` class per provider | Mature ecosystem, graph-based agents | Heavy dependency, Python-centric |

### How IDE Tools Handle Multi-Model

| Tool | Model Selection | Key Insight |
|------|----------------|-------------|
| **Cursor** | Dropdown per chat; proxy routes to provider | Model selection is per-interaction, not global |
| **Continue.dev** | `config.json` with provider/model/apiKey blocks | Open config file, explicit provider field |
| **Aider** | CLI flag `--model provider/model`; uses LiteLLM internally | Provider/model naming convention; graceful degradation |
| **Cody** | Server-side config; enterprise BYOK | Separates model config from usage |
| **GitHub Copilot** | UI model picker; backend routes | User doesn't manage API keys |

### The OpenAI-Compatible Standard

The industry has converged on the **OpenAI Chat Completions API** as the lingua franca:

```
POST /v1/chat/completions
{
  "model": "gpt-4o",
  "messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}],
  "tools": [...],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 4096
}
```

**Every major provider supports this format** (natively or via compatibility layer):
- OpenAI: native
- Anthropic: via proxy (LiteLLM, OpenRouter) or Anthropic SDK
- Google Gemini: via OpenAI compatibility mode (`generativelanguage.googleapis.com/v1beta/openai/`)
- Ollama: native (`localhost:11434/v1/chat/completions`)
- vLLM: native OpenAI-compatible server
- llama.cpp: native OpenAI-compatible server
- Together AI, Fireworks, Groq: all OpenAI-compatible
- AWS Bedrock: via Converse API or proxy
- Azure OpenAI: near-identical to OpenAI

### Key Format Differences to Normalize

| Feature | OpenAI | Anthropic | Gemini | Ollama |
|---------|--------|-----------|--------|--------|
| System prompt | `role: "system"` message | Top-level `system` field | `systemInstruction` field | `role: "system"` message |
| Content format | string or array | Always array of blocks | `parts` array | string |
| Tool calling | `tool_calls` in assistant message | `tool_use` content block | `functionCall` part | `tool_calls` (OpenAI format) |
| Streaming | SSE `choices[].delta` | SSE `content_block_delta` | SSE `candidates[].content` | SSE `choices[].delta` |
| Max tokens | Optional | **Required** | Optional | Optional |
| Thinking | N/A | `thinking` content blocks | `thinkingConfig` | N/A |

### Open-Source / Local Model Options

| Provider | Access Method | Tool Calling | Context | Best For |
|----------|-------------|-------------|---------|----------|
| **Ollama** (local) | OpenAI-compatible API at `:11434` | Llama 3.1+, Mistral | 8K-128K | Dev/testing, cost-free stages |
| **vLLM** (self-hosted) | OpenAI-compatible API | Depends on model | Varies | GPU servers, high throughput |
| **llama.cpp** (local) | OpenAI-compatible API | Limited | Varies | CPU inference, edge |
| **Together AI** | OpenAI-compatible API | Yes | Up to 128K | Fast open-model inference |
| **Fireworks AI** | OpenAI-compatible API | Yes | Up to 128K | Sub-second latency |
| **Groq** | OpenAI-compatible API | Yes | Up to 128K | Fastest inference (500+ tok/s) |
| **HuggingFace** | Custom or TGI (OpenAI-compat) | Limited | Varies | Model variety |
| **DeepSeek** | OpenAI-compatible API | Yes | 128K | Coding tasks, cheap |

---

## Architecture Design

### The Hybrid Approach

```
┌─────────────────────────────────────────────────────────────┐
│                    Model Configuration                        │
│  ┌─────────────┐ ┌──────────────┐ ┌───────────────────────┐ │
│  │ Per-Stage   │ │ Provider     │ │ API Key               │ │
│  │ Model Map   │ │ Registry     │ │ Vault                 │ │
│  └──────┬──────┘ └──────┬───────┘ └───────────┬───────────┘ │
├─────────┼───────────────┼─────────────────────┼─────────────┤
│         ▼               ▼                     ▼              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                   Model Resolver                         │ │
│  │  "anthropic/claude-sonnet-4" → Claude CLI backend       │ │
│  │  "openai/gpt-4o"            → OpenAI API backend        │ │
│  │  "ollama/llama3"            → Ollama API backend         │ │
│  │  "google/gemini-2.5-pro"    → Gemini API backend         │ │
│  └──────────────────────┬──────────────────────────────────┘ │
│                         │                                     │
│         ┌───────────────┼───────────────┐                    │
│         ▼               ▼               ▼                    │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │ Claude CLI  │ │  API Agent  │ │  Ollama     │           │
│  │ Backend     │ │  Backend    │ │  Backend     │           │
│  │ (full agent)│ │(HTTP + tools)│ │ (local API) │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
│                                                               │
│  Backend capabilities:                                        │
│  Claude CLI: tool_use ✓  file_edit ✓  shell ✓  session ✓   │
│  API Agent:  tool_use ✓* file_edit ✓* shell ✓* session ✗   │
│  Ollama:     tool_use ~  file_edit ✗  shell ✗  session ✗   │
│                                                               │
│  * = provided by Swarm's built-in tool executor              │
└─────────────────────────────────────────────────────────────┘
```

### Three Backend Types

#### 1. Claude CLI Backend (existing)
- Spawns `claude` CLI subprocess
- Full agentic capabilities (file editing, shell, sub-agents)
- Used when: `provider === 'anthropic'` AND `agenticMode === true`
- Session resume, permission modes, tool restrictions — all work
- **No changes needed** for this backend

#### 2. API Backend (new — the core of Wave 8)
- Makes HTTP API calls to any OpenAI-compatible endpoint
- Swarm provides the agentic layer: tool definitions, tool execution, conversation management
- Used when: any non-Claude provider, or Claude via API (without CLI)
- Handles: streaming, tool calling, cost calculation, conversation history
- **This is the main new subsystem**

#### 3. Text-Only Backend (new — for simple stages)
- API calls for pure text generation (no tool calling)
- Used for: analyst (generates REQUIREMENTS.md), architect (generates SPEC.md), lead (generates TASKS.md)
- These stages don't need to edit files — they just generate documents
- Any LLM works, even models without tool support
- Cheapest option: use Llama 3 for analysis, GPT-4o for architecture, Claude for engineering

### Capability Tiers

```
Tier 3 (Full Agent):     Claude CLI — can edit files, run commands, spawn sub-agents
Tier 2 (Tool Calling):   API + Swarm tool executor — can call defined tools via API
Tier 1 (Text Only):      API text generation — generates documents, no tool use

┌─────────────────────────────────────────────────────────┐
│ Pipeline Stage │ Min Tier │ Recommended              │
├────────────────┼──────────┼──────────────────────────┤
│ Analyst        │ Tier 1   │ Any model (cheapest OK)  │
│ Architect      │ Tier 1   │ Smart model (GPT-4o, etc)│
│ Lead           │ Tier 1   │ Smart model              │
│ Engineer       │ Tier 2*  │ Claude CLI (Tier 3)      │
│ Tester         │ Tier 2*  │ Claude CLI (Tier 3)      │
│ Fix/Spike/etc  │ Tier 2*  │ Claude CLI (Tier 3)      │
└─────────────────────────────────────────────────────────┘

* Tier 2 requires Swarm's built-in tool executor for file operations
```

---

## P1: Provider Registry & Model Configuration (Impact: 10/10)

### Problem
Config only supports `model: 'sonnet'`. No way to specify different providers or models per stage.

### Solution
A provider registry with per-stage model mapping and API key management.

### Configuration Format

**`.swarm/config.yaml` (existing, extended)**
```yaml
# Default model for all stages (backward compatible)
model: sonnet

# NEW: Per-stage model configuration
models:
  analyst: ollama/llama3.1:70b          # Cheap local model for analysis
  architect: openai/gpt-4o              # Strong reasoning for architecture
  lead: openai/gpt-4o                   # Strong reasoning for task breakdown
  engineer: anthropic/claude-sonnet-4   # Best coding model (uses Claude CLI)
  tester: anthropic/claude-sonnet-4     # Best for test writing
  fix: anthropic/claude-sonnet-4        # Fix loop needs agentic capabilities
  review: google/gemini-2.5-pro         # Fast, cheap reviews
  spike: deepseek/deepseek-chat         # Good for exploration, very cheap

# NEW: Provider configurations
providers:
  anthropic:
    # If apiKey is set, uses API mode. If not, uses Claude CLI (default)
    mode: cli  # 'cli' (default, uses claude binary) or 'api' (HTTP API calls)
    apiKey: ${ANTHROPIC_API_KEY}  # env var reference

  openai:
    apiKey: ${OPENAI_API_KEY}
    baseUrl: https://api.openai.com/v1  # default, can override for Azure
    organization: ${OPENAI_ORG_ID}      # optional

  google:
    apiKey: ${GOOGLE_API_KEY}

  ollama:
    baseUrl: http://localhost:11434      # default Ollama URL
    # No API key needed for local

  openrouter:
    apiKey: ${OPENROUTER_API_KEY}
    baseUrl: https://openrouter.ai/api/v1

  together:
    apiKey: ${TOGETHER_API_KEY}
    baseUrl: https://api.together.xyz/v1

  groq:
    apiKey: ${GROQ_API_KEY}
    baseUrl: https://api.groq.com/openai/v1

  deepseek:
    apiKey: ${DEEPSEEK_API_KEY}
    baseUrl: https://api.deepseek.com/v1

  azure:
    apiKey: ${AZURE_OPENAI_API_KEY}
    baseUrl: https://{resource}.openai.azure.com/openai/deployments/{deployment}
    apiVersion: '2024-02-01'

  custom:
    # Any OpenAI-compatible endpoint
    apiKey: ${CUSTOM_LLM_KEY}
    baseUrl: http://my-server:8080/v1

# NEW: Model registry overrides (optional, for custom/fine-tuned models)
modelRegistry:
  my-coding-model:
    provider: custom
    modelId: my-fine-tuned-coder-v2
    contextWindow: 32768
    supportsTools: true
    supportsStreaming: true
    costPer1kInput: 0.001
    costPer1kOutput: 0.002
```

### Model Name Convention
```
provider/model-name

Examples:
  anthropic/claude-sonnet-4          → Anthropic API or Claude CLI
  anthropic/claude-opus-4            → Anthropic API or Claude CLI
  openai/gpt-4o                      → OpenAI API
  openai/gpt-4o-mini                 → OpenAI API (cheap)
  google/gemini-2.5-pro              → Google Gemini API
  ollama/llama3.1:70b                → Local Ollama
  ollama/deepseek-coder-v2:236b      → Local Ollama
  together/meta-llama/Llama-3-70b    → Together AI
  groq/llama-3.1-70b-versatile       → Groq (fast)
  deepseek/deepseek-chat             → DeepSeek API
  openrouter/anthropic/claude-3-opus → OpenRouter (any model)
  custom/my-model                    → Custom OpenAI-compat endpoint

Shorthand (backward compatible):
  sonnet  → anthropic/claude-sonnet-4
  opus    → anthropic/claude-opus-4
  haiku   → anthropic/claude-haiku-4-5
```

### Implementation

#### Files to Create
1. `src/core/providers/registry.ts` — Provider registry, model resolution, capability lookup
2. `src/core/providers/types.ts` — Provider interfaces, model metadata, capability flags
3. `src/core/providers/anthropic.ts` — Anthropic API provider (Messages API)
4. `src/core/providers/openai.ts` — OpenAI-compatible provider (works for OpenAI, Ollama, Together, Groq, etc.)
5. `src/core/providers/google.ts` — Google Gemini provider
6. `src/core/providers/claude-cli.ts` — Existing Claude CLI wrapped as a provider (extract from agent-process.ts)
7. `src/core/providers/cost-table.ts` — Per-model pricing for cost tracking

#### Files to Modify
1. `src/core/config.ts` — Parse new `providers` and `models` config sections
2. `src/types.ts` — Add provider types, model metadata types
3. `src/core/agent-process.ts` — Use provider backend instead of hardcoded `spawn('claude', ...)`
4. `src/core/agent-manager.ts` — Route to correct backend per agent's model
5. `src/core/pipeline.ts` — Resolve per-stage model from config

#### Tasks
- [ ] Define `LLMProvider` interface: `chat()`, `stream()`, `streamWithTools()`, `estimateCost()`
- [ ] Define `ModelCapabilities`: `supportsTools`, `supportsStreaming`, `supportsThinking`, `maxContextWindow`, `maxOutputTokens`
- [ ] Define `ModelMetadata`: `provider`, `modelId`, `capabilities`, `costPerInputToken`, `costPerOutputToken`
- [ ] Build `ProviderRegistry` class: `register()`, `resolve(modelString)`, `getProvider(modelString)`
- [ ] Build shorthand resolver: `sonnet` → `anthropic/claude-sonnet-4`
- [ ] Build env var expansion for API keys: `${OPENAI_API_KEY}` → `process.env.OPENAI_API_KEY`
- [ ] Validate API keys on startup (quick ping test)
- [ ] Error messages: "No API key configured for provider X. Set OPENAI_API_KEY or add it to .swarm/config.yaml"

---

## P2: API Provider — OpenAI-Compatible Backend (Impact: 10/10)

### Problem
Need an HTTP-based agent backend that works with any OpenAI-compatible API.

### Solution
A provider that makes Chat Completions API calls, handles streaming, and normalizes responses.

### The OpenAI-Compatible Provider

This single provider handles: **OpenAI, Ollama, Together, Groq, Fireworks, vLLM, llama.cpp, LocalAI, DeepSeek, and any custom endpoint**.

```typescript
interface OpenAICompatibleConfig {
  baseUrl: string;       // e.g., https://api.openai.com/v1
  apiKey?: string;       // Bearer token
  modelId: string;       // e.g., gpt-4o
  organization?: string; // OpenAI org ID
  headers?: Record<string, string>; // Custom headers
}
```

### Implementation

#### Tasks
- [ ] Create `src/core/providers/openai-compat.ts`
  - `chat(messages, options)` → single response
  - `stream(messages, options)` → async iterable of chunks
  - `streamWithTools(messages, tools, options)` → async iterable with tool call detection
  - Handle SSE parsing (`data: {...}\n\n` format)
  - Handle `[DONE]` sentinel
  - Extract token usage from response
  - Calculate cost from token counts × model pricing
  - Timeout + retry with exponential backoff
  - Connection error → clear error message ("Cannot connect to Ollama at localhost:11434. Is it running?")
- [ ] Normalize tool calling:
  - Send `tools` array in OpenAI format
  - Parse `tool_calls` from assistant messages
  - Handle `tool_choice: "auto"` / `"required"` / `"none"`
- [ ] Normalize streaming:
  - Emit events: `text`, `tool_call_start`, `tool_call_delta`, `tool_call_end`, `done`
  - Map to Swarm's internal event format (same as what AgentProcess emits)
- [ ] Handle provider-specific quirks:
  - Ollama: no `organization` header, may not support all tool formats
  - Together/Groq: standard OpenAI format, different rate limits
  - Azure: different auth header (`api-key` vs `Authorization: Bearer`), deployment-based URL

---

## P3: Anthropic API Provider (Impact: 9/10)

### Problem
Anthropic's Messages API has a different format from OpenAI. Need native support for using Claude via API (without CLI) for when users want API-mode Claude.

### Solution
Dedicated Anthropic provider that speaks the Messages API natively.

### Why Not Just Use OpenAI-Compat for Anthropic?
- Anthropic's native API supports **thinking blocks** (extended thinking) — not available via OpenAI format
- Native API has **prompt caching** with cache control headers — significant cost savings
- **Content blocks** format is richer than OpenAI's string-based content
- Direct API = no proxy latency, proper error messages

### Implementation

#### Tasks
- [ ] Create `src/core/providers/anthropic-api.ts`
  - Uses Anthropic Messages API format directly
  - `system` as top-level field (not a message)
  - Content as block arrays (`[{type: "text", text: "..."}]`)
  - Tool calling via `tool_use` / `tool_result` blocks
  - Streaming via Anthropic's SSE format (`content_block_delta`)
  - Support `thinking` blocks for extended reasoning
  - Prompt caching headers for cost optimization
  - `max_tokens` always set (required by Anthropic)
- [ ] Map Anthropic streaming events to Swarm's internal event format
- [ ] Cost calculation with cache-aware pricing (cache read = 90% discount)

---

## P4: Google Gemini Provider (Impact: 7/10)

### Problem
Gemini has a unique API format. It's increasingly competitive for coding tasks and very cheap.

### Solution
Dedicated Gemini provider, or use Gemini's OpenAI compatibility layer.

### Implementation

#### Tasks
- [ ] Create `src/core/providers/google.ts`
  - Option A: Use Gemini's native API (`generateContent`)
  - Option B: Use Gemini's OpenAI-compatible endpoint (simpler, less control)
  - Recommend Option B initially, with native API for thinking mode later
- [ ] Handle Gemini-specific features:
  - `thinkingConfig` for reasoning mode
  - Function calling via `functionDeclarations`
  - Large context window (up to 1M tokens for Gemini 1.5 Pro)

---

## P5: Swarm Tool Executor — Agentic Layer for API Models (Impact: 10/10)

### Problem
When using non-Claude models via API, they can generate text and request tool calls, but they can't actually execute those tools. Claude CLI handles tool execution internally (file read/write, shell commands, etc.). For API models, Swarm needs to provide this layer.

### Solution
A tool executor that receives tool call requests from any LLM and executes them against the local filesystem/shell.

### Tool Executor Design

```
LLM API returns: tool_calls: [{name: "read_file", args: {path: "src/app.ts"}}]
                         │
                         ▼
              ┌─────────────────────┐
              │  Swarm Tool Executor │
              │                     │
              │  read_file()        │ → fs.readFileSync()
              │  write_file()       │ → fs.writeFileSync()
              │  edit_file()        │ → apply diff/patch
              │  run_command()      │ → child_process.exec()
              │  search_files()     │ → glob/grep
              │  list_files()       │ → fs.readdirSync()
              └─────────┬───────────┘
                        │
                        ▼
              Tool results sent back to LLM as next message
              LLM generates next response (may call more tools)
              Loop until LLM returns text-only response (done)
```

### Tool Definitions (OpenAI Format)

```typescript
const SWARM_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' },
          startLine: { type: 'number', description: 'Start reading from this line' },
          endLine: { type: 'number', description: 'Stop reading at this line' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file (creates or overwrites)',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          content: { type: 'string', description: 'File content' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace a specific string in a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          oldText: { type: 'string', description: 'Text to find (must be unique in file)' },
          newText: { type: 'string', description: 'Replacement text' },
        },
        required: ['path', 'oldText', 'newText'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a shell command and return output',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          cwd: { type: 'string', description: 'Working directory (optional)' },
          timeout: { type: 'number', description: 'Timeout in milliseconds (default 30000)' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search file contents using regex pattern',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for' },
          path: { type: 'string', description: 'Directory to search in (default: project root)' },
          glob: { type: 'string', description: 'File glob filter (e.g., "*.ts")' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files matching a glob pattern',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (e.g., "src/**/*.ts")' },
        },
        required: ['pattern'],
      },
    },
  },
];
```

### Agentic Loop

```typescript
async function runAgenticLoop(provider: LLMProvider, systemPrompt: string, userPrompt: string) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const maxIterations = 50; // Safety limit

  for (let i = 0; i < maxIterations; i++) {
    const response = await provider.streamWithTools(messages, SWARM_TOOLS);

    // Collect response
    messages.push({ role: 'assistant', content: response.content, tool_calls: response.toolCalls });

    // If no tool calls, we're done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      return response.content; // Final text response
    }

    // Execute each tool call
    for (const toolCall of response.toolCalls) {
      const result = await executeToolCall(toolCall);
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      });
    }
    // Loop: send tool results back to LLM for next response
  }
}
```

### Implementation

#### Files to Create
1. `src/core/tools/executor.ts` — Tool execution engine
2. `src/core/tools/definitions.ts` — Tool definitions in OpenAI format
3. `src/core/tools/sandbox.ts` — Safety: working directory restrictions, command allowlists
4. `src/core/agent-loop.ts` — The agentic tool-calling loop for API-based models

#### Tasks
- [ ] Implement all 6 core tools: `read_file`, `write_file`, `edit_file`, `run_command`, `search_files`, `list_files`
- [ ] Safety sandbox:
  - Restrict file operations to project directory (no `../../etc/passwd`)
  - Command timeout (default 30s, configurable)
  - Command blocklist (no `rm -rf /`, no `sudo`)
  - File size limits for reads/writes
- [ ] Agentic loop with streaming:
  - Stream text tokens as they arrive
  - Emit tool call events (so dashboard can show "Reading src/app.ts...")
  - Emit tool result events
  - Handle partial tool calls (streaming tool arguments)
  - Handle multiple parallel tool calls in one response
- [ ] Conversation history management:
  - Keep full history for multi-turn
  - Truncate old messages when approaching context limit
  - Summarize earlier conversation when needed
- [ ] Map agentic loop events to Swarm's `AgentActivity` format (so dashboard shows the same UI)

---

## P6: Modified AgentProcess — Backend Selection (Impact: 10/10)

### Problem
`AgentProcess` hardcodes `spawn('claude', ...)`. Need to route to the correct backend.

### Solution
AgentProcess becomes a thin dispatcher that delegates to the appropriate backend.

### New AgentProcess Architecture

```typescript
class AgentProcess {
  private backend: AgentBackend; // Claude CLI or API-based

  constructor(config: AgentConfig) {
    const provider = registry.resolve(config.model); // e.g., 'openai/gpt-4o'

    if (provider.type === 'claude-cli') {
      this.backend = new ClaudeCLIBackend(config);  // Existing spawn('claude', ...) logic
    } else if (provider.capabilities.supportsTools) {
      this.backend = new APIAgentBackend(provider, config); // New: API + tool loop
    } else {
      this.backend = new APITextBackend(provider, config);  // New: text-only
    }
  }

  async start() { return this.backend.start(); }
  async sendInput(text: string) { return this.backend.sendInput(text); }
  kill() { return this.backend.kill(); }
  // Events: 'output', 'activity', 'cost', 'done', 'error' — same interface regardless of backend
}
```

### Implementation

#### Tasks
- [ ] Define `AgentBackend` interface: `start()`, `sendInput()`, `kill()`, event emitter
- [ ] Extract existing Claude CLI logic into `ClaudeCLIBackend` class
- [ ] Create `APIAgentBackend` class using the agentic loop from P5
- [ ] Create `APITextBackend` class for text-only stages
- [ ] Ensure all backends emit the same events (so dashboard/pipeline work unchanged)
- [ ] Handle session management:
  - Claude CLI: uses `--resume`
  - API backends: maintain conversation history in memory
- [ ] Handle cost tracking:
  - Claude CLI: reads from `result` event
  - API backends: calculate from token usage × model pricing
- [ ] Test: pipeline with mixed models (Ollama for analyst, GPT-4o for architect, Claude for engineer)

---

## P7: Dashboard — Model Configuration UI (Impact: 9/10)

### Problem
Users need a way to configure models, providers, and API keys from the dashboard — not just YAML files.

### Solution
A Settings page in the dashboard for model configuration.

### Settings Page Design

```
/settings/models

┌─────────────────────────────────────────────────────────┐
│ ⚙️ Model Configuration                                  │
│                                                          │
│ ┌──── Per-Stage Models ─────────────────────────────┐   │
│ │                                                     │   │
│ │  Analyst      [ollama/llama3.1:70b     ▾] [Test]  │   │
│ │  Architect    [openai/gpt-4o            ▾] [Test]  │   │
│ │  Lead         [openai/gpt-4o            ▾] [Test]  │   │
│ │  Engineer     [anthropic/claude-sonnet-4 ▾] [Test]  │   │
│ │  Tester       [anthropic/claude-sonnet-4 ▾] [Test]  │   │
│ │                                                     │   │
│ │  💡 Analyst/Architect/Lead only generate text —     │   │
│ │     any model works. Engineer/Tester need tool      │   │
│ │     calling for file editing.                       │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                          │
│ ┌──── Providers ────────────────────────────────────┐   │
│ │                                                     │   │
│ │  Anthropic   [CLI mode ▾]  Key: ●●●●●●ak-1234     │   │
│ │              ✅ Connected                           │   │
│ │                                                     │   │
│ │  OpenAI      Key: [________________] [Save] [Test]  │   │
│ │              ❌ No API key                           │   │
│ │                                                     │   │
│ │  Ollama      URL: http://localhost:11434             │   │
│ │              ✅ Running (3 models available)         │   │
│ │                                                     │   │
│ │  Google      Key: [________________] [Save] [Test]  │   │
│ │              ❌ No API key                           │   │
│ │                                                     │   │
│ │  [+ Add Provider]                                   │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                          │
│ ┌──── Available Models ─────────────────────────────┐   │
│ │                                                     │   │
│ │  Provider     Model              Context  Tools     │   │
│ │  ─────────────────────────────────────────────      │   │
│ │  Anthropic    claude-sonnet-4    200K     ✅        │   │
│ │  Anthropic    claude-opus-4      200K     ✅        │   │
│ │  Anthropic    claude-haiku-4-5   200K     ✅        │   │
│ │  OpenAI       gpt-4o             128K     ✅        │   │
│ │  OpenAI       gpt-4o-mini        128K     ✅        │   │
│ │  Ollama       llama3.1:70b       128K     ✅        │   │
│ │  Ollama       deepseek-coder     128K     ✅        │   │
│ │  Ollama       codellama:34b      16K      ❌        │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                          │
│ ┌──── Cost Comparison ──────────────────────────────┐   │
│ │                                                     │   │
│ │  Your current config estimated cost per pipeline:   │   │
│ │                                                     │   │
│ │  All Claude Sonnet:  $3.00 - $8.00                 │   │
│ │  Your mix:           $0.80 - $3.50  (60% savings)  │   │
│ │  All local (Ollama): $0.00          (free!)        │   │
│ │                                                     │   │
│ │  ⚠️ Local models are slower and may produce lower   │   │
│ │  quality results for complex engineering tasks.     │   │
│ └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Implementation

#### Files to Create
1. `packages/dashboard/src/views/ModelSettingsView.tsx` — Model configuration page
2. `packages/dashboard/src/components/ModelPicker.tsx` — Dropdown with provider/model selection
3. `packages/dashboard/src/components/ProviderCard.tsx` — Provider config card with key input + test
4. `packages/dashboard/src/components/CostEstimator.tsx` — Cost comparison widget

#### Tasks
- [ ] Model picker dropdown: grouped by provider, shows capabilities (tools ✅/❌, context window)
- [ ] Provider configuration cards: API key input (masked), base URL, test connection button
- [ ] Per-stage model assignment: dropdown per stage with capability validation
- [ ] "Test" button per model: sends a quick "Hello" message to verify connectivity
- [ ] Available models list: dynamically discovered from all configured providers via `ModelCatalog` (P8.5) — Ollama `/api/tags`, OpenAI `/v1/models`, etc. No hardcoded model lists.
- [ ] Cost estimator: show estimated pipeline cost for current model mix vs. all-Claude
- [ ] Save config: writes to `.swarm/config.yaml` via WebSocket command
- [ ] Validation: warn if engineer/tester stage assigned a model without tool support
- [ ] Add route `/settings/models` and sidebar item

---

## P8: CLI Commands — `swarm models` (Impact: 7/10)

### Problem
Users need CLI access to model management, not just dashboard.

### Solution
New CLI command for model listing, testing, and configuration.

### Commands

```bash
# List configured models and providers
swarm models

# List available models from all configured providers
swarm models list

# Test a specific model
swarm models test openai/gpt-4o

# Set model for a stage
swarm models set engineer anthropic/claude-opus-4

# Add a provider
swarm models add-provider openai --key sk-...

# Show cost estimate for current config
swarm models cost
```

### Implementation

#### Tasks
- [ ] Create `src/commands/models.ts` with subcommands: list, test, set, add-provider, cost
- [ ] Register in `bin/swarm.ts`
- [ ] `list`: query each configured provider for available models
- [ ] `test`: send test message, measure latency, verify tool support
- [ ] `set`: update `.swarm/config.yaml` model mapping
- [ ] `add-provider`: configure new provider with API key
- [ ] `cost`: estimate pipeline cost for current model mix

---

## P8.5: Dynamic Model Discovery — Eliminate Hardcoded Model Names (Impact: 9/10)

### Problem
Model names are hardcoded as string literals throughout the codebase. Every command that accepts `--model` defaults to `'sonnet'` or lists `'sonnet, opus, haiku'` as the only options. This means:

1. **Adding a new model requires editing 20+ files** — every command with `--model` has a hardcoded default and description
2. **Model names are stale** — the strings `'sonnet'`, `'opus'`, `'haiku'` refer to Claude Code shorthands; when Anthropic releases new models (or when users configure OpenAI, Gemini, etc.), these literals are wrong
3. **No single source of truth** — each command independently defaults to `'sonnet'`, duplicating the knowledge
4. **Dashboard model dropdowns will need the same list** — the model picker UI (P7) can't just hardcode another static list

### Current Hardcoded Locations (26 files)

```
packages/cli/src/commands/inbox.ts      → .option('-m, --model <model>', '...', 'sonnet')
packages/cli/src/commands/migrate.ts    → .option('-m, --model <model>', '...sonnet)')
packages/cli/src/commands/mentor.ts     → .option('-m, --model <model>', '...sonnet)') ×3
packages/cli/src/commands/mayday.ts     → 'haiku', 'sonnet', 'opus' hardcoded in --lean/--smart
packages/cli/src/commands/build.ts      → .option('-m, --model <model>', '...sonnet, opus, haiku)')
packages/cli/src/commands/fix.ts        → .option('-m, --model <model>', '...sonnet, opus, haiku)')
packages/cli/src/commands/review.ts     → opts.model || 'sonnet'
packages/cli/src/commands/secure.ts     → .option('--model <model>', '...', 'sonnet')
packages/cli/src/commands/pair.ts       → opts.model || 'sonnet' ×2
packages/cli/src/commands/watch.ts      → opts.model || 'sonnet'
packages/cli/src/commands/architect.ts  → .option('-m, --model <model>', '...sonnet, opus, haiku)')
packages/cli/src/commands/babysit-prs.ts → opts.model || 'sonnet'
packages/cli/src/commands/teach.ts      → .option('--model <base>', '...', 'haiku')
packages/cli/src/core/config.ts         → defaultModel: 'sonnet'
packages/cli/src/core/pipeline.ts       → model name references in stage logic
packages/dashboard/src/views/ModelSettingsView.tsx (P7) — will need dynamic list
```

### Solution
A centralized model registry that:
1. **Provides the single source of truth** for default model, available models, and model metadata
2. **Dynamically discovers available models** from configured providers at runtime
3. **Never hardcodes model names** in CLI commands — commands read from the registry
4. **Allows the user to set their own default** in `.swarm/config.yaml`
5. **Auto-updates** when providers add new models (Ollama `/api/tags`, OpenAI `/v1/models`, etc.)

### Model Discovery Sources

| Provider | Discovery Method | Endpoint |
|----------|-----------------|----------|
| **Anthropic** | Provider SDK / known models list refreshed from API | `GET /v1/models` |
| **OpenAI** | API model listing | `GET /v1/models` |
| **Google Gemini** | API model listing | `GET /v1beta/models` |
| **Ollama** | Local API | `GET /api/tags` |
| **Together AI** | OpenAI-compat model listing | `GET /v1/models` |
| **Groq** | OpenAI-compat model listing | `GET /v1/models` |
| **DeepSeek** | OpenAI-compat model listing | `GET /v1/models` |
| **Custom** | User-provided in `modelRegistry` config | N/A (static config) |

### Implementation

#### Files to Create
1. `src/core/providers/model-catalog.ts` — Dynamic model catalog with discovery, caching, and fallback

#### Files to Modify
1. `src/core/providers/registry.ts` (from P1) — Add `listModels()`, `getDefaultModel()`, `discoverModels()` methods
2. `src/core/config.ts` — Replace `defaultModel: 'sonnet'` with `defaultModel` read from config → registry fallback
3. **All 20+ command files** — Replace hardcoded `'sonnet'` defaults with `registry.getDefaultModel()` and model descriptions with dynamic options

#### Design

```typescript
// src/core/providers/model-catalog.ts

interface DiscoveredModel {
  id: string;              // e.g., 'openai/gpt-4o' or 'ollama/llama3.1:70b'
  provider: string;        // e.g., 'openai'
  name: string;            // Human-readable: 'GPT-4o'
  contextWindow: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsThinking: boolean;
  costPer1kInput: number;
  costPer1kOutput: number;
  tier: 1 | 2 | 3;        // Capability tier from architecture design
  tags: string[];          // e.g., ['fast', 'cheap', 'coding', 'reasoning']
}

class ModelCatalog {
  private cache: Map<string, DiscoveredModel[]> = new Map();
  private cacheExpiry: number = 0;
  private static CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get all available models across all configured providers.
   * Results are cached to avoid repeated API calls.
   */
  async listAll(): Promise<DiscoveredModel[]>;

  /**
   * Discover models from a specific provider.
   * Calls the provider's model listing API.
   */
  async discoverFromProvider(provider: string): Promise<DiscoveredModel[]>;

  /**
   * Get the user's configured default model.
   * Falls back to 'anthropic/claude-sonnet-4' if not configured.
   * NEVER returns a bare string like 'sonnet' — always provider/model format.
   */
  getDefaultModel(): string;

  /**
   * Get shorthand aliases. User-configurable + built-in defaults.
   * Built-in: { sonnet: 'anthropic/claude-sonnet-4', opus: 'anthropic/claude-opus-4', ... }
   * Users can add their own: { fast: 'groq/llama-3.1-70b-versatile', cheap: 'ollama/llama3.1:8b' }
   */
  getAliases(): Record<string, string>;

  /**
   * Resolve a model string to a full provider/model ID.
   * 'sonnet' → 'anthropic/claude-sonnet-4'
   * 'gpt-4o' → 'openai/gpt-4o'
   * 'openai/gpt-4o' → 'openai/gpt-4o' (passthrough)
   */
  resolve(modelString: string): string;

  /**
   * Get CLI option description with available models listed dynamically.
   * Returns something like: 'Model (default: sonnet). Available: sonnet, opus, haiku, openai/gpt-4o, ollama/llama3'
   * Used by all --model CLI options.
   */
  getCliModelDescription(): string;
}
```

#### Command File Refactoring Pattern

**Before (hardcoded):**
```typescript
.option('-m, --model <model>', 'Model override (sonnet, opus, haiku)')
// ...
config.model = opts.model || 'sonnet';
```

**After (dynamic):**
```typescript
import { getModelCatalog } from '../core/providers/model-catalog.js';

const catalog = getModelCatalog();
.option('-m, --model <model>', catalog.getCliModelDescription())
// ...
config.model = catalog.resolve(opts.model || catalog.getDefaultModel());
```

#### Mayday Smart/Lean Mode Refactoring

**Before (hardcoded model tiers):**
```typescript
stageModels = { analyst: 'haiku', architect: 'haiku', lead: 'haiku', tester: 'haiku' }; // lean
stageModels = { analyst: 'sonnet', architect: 'sonnet', lead: 'sonnet', tester: 'sonnet', engineer: 'opus' }; // smart
```

**After (tier-based from registry):**
```typescript
const catalog = getModelCatalog();
// lean: cheapest available model for text stages, default for engineer
stageModels = catalog.suggestForTier('lean'); // { analyst: cheapest, ..., engineer: default }
// smart: mid-tier for text stages, best for engineer
stageModels = catalog.suggestForTier('smart'); // { analyst: mid, ..., engineer: best }
```

#### Config Extension

```yaml
# .swarm/config.yaml

# User sets their own default (replaces hardcoded 'sonnet')
model: sonnet  # or 'openai/gpt-4o' or 'ollama/llama3'

# Custom aliases
aliases:
  fast: groq/llama-3.1-70b-versatile
  cheap: ollama/llama3.1:8b
  best: anthropic/claude-opus-4

# Then use anywhere: swarm build -m fast
```

#### Tasks
- [ ] Create `ModelCatalog` class with `listAll()`, `discoverFromProvider()`, `getDefaultModel()`, `resolve()`
- [ ] Implement discovery for each provider:
  - Anthropic: `GET /v1/models` (or fallback to known list)
  - OpenAI: `GET /v1/models` → filter chat models
  - Ollama: `GET /api/tags` → map to model catalog format
  - Others: `GET /v1/models` (OpenAI-compat)
- [ ] Add `aliases` config section for user-defined shorthands
- [ ] Add `suggestForTier('lean' | 'smart' | 'balanced')` for automatic stage model assignment
- [ ] Cache discovery results (5min TTL) to avoid API spam
- [ ] Graceful fallback: if discovery fails, use last cached results or built-in known models
- [ ] Refactor ALL 20+ command files to use `catalog.getDefaultModel()` instead of `'sonnet'`
- [ ] Refactor all `--model` option descriptions to use `catalog.getCliModelDescription()`
- [ ] Refactor mayday `--lean`/`--smart` to use `catalog.suggestForTier()`
- [ ] Dashboard model picker (P7) reads from same catalog via WS command `list-models`
- [ ] Add WS command `list-models` → returns `catalog.listAll()` for dashboard consumption
- [ ] `swarm models list` (P8) uses the same catalog internally

---

## P9: Prompt Adaptation Layer (Impact: 8/10)

### Problem
Persona prompts in `prompts/` are written for Claude Code — they reference Claude-specific tools, behaviors, and formats. Other models need adapted prompts.

### Solution
A prompt adaptation layer that adjusts persona prompts based on the target model's capabilities.

### Implementation

#### Tasks
- [ ] Create `src/core/providers/prompt-adapter.ts`
- [ ] For Tier 1 (text-only) stages:
  - Strip tool-use instructions from persona prompts
  - Add explicit output format instructions ("Output a markdown document titled REQUIREMENTS.md")
  - Add file content inline (since model can't read files itself)
- [ ] For Tier 2 (API + tools) stages:
  - Replace Claude Code tool references with Swarm tool names (`Read` → `read_file`, `Edit` → `edit_file`)
  - Add tool usage examples in the system prompt
  - Adjust instructions for different tool calling patterns
- [ ] For Tier 3 (Claude CLI):
  - No adaptation needed — use existing prompts as-is
- [ ] Model-specific adjustments:
  - GPT-4o: tends to be verbose — add "be concise" instructions
  - Gemini: prefers structured prompts — add section headers
  - Llama/open models: may need more explicit formatting guidance
  - DeepSeek: excellent at code, adjust for code-heavy responses

---

## P10: Unified Cost Tracking (Impact: 7/10)

### Problem
Cost tracking currently relies on Claude CLI's `total_cost_usd` field. API-based models need external cost calculation.

### Solution
A cost calculator that works across all providers.

### Implementation

#### Files to Create
1. `src/core/providers/cost-table.ts` — Pricing data per model

#### Cost Table

**Important:** This table serves as a **fallback only**. Pricing should be fetched dynamically from the `ModelCatalog` (P8.5) whenever possible. Many providers include pricing in their `/v1/models` response or publish pricing APIs. The static table below is used when:
- The provider doesn't expose pricing
- The user is offline / discovery fails
- Custom/self-hosted models (user sets pricing in `modelRegistry` config)

```typescript
const FALLBACK_COST_TABLE: Record<string, { input: number; output: number; cacheRead?: number }> = {
  // Anthropic (per 1M tokens)
  'anthropic/claude-opus-4':     { input: 15.00, output: 75.00, cacheRead: 1.50 },
  'anthropic/claude-sonnet-4':   { input: 3.00,  output: 15.00, cacheRead: 0.30 },
  'anthropic/claude-haiku-4-5':  { input: 0.80,  output: 4.00,  cacheRead: 0.08 },

  // OpenAI
  'openai/gpt-4o':               { input: 2.50,  output: 10.00 },
  'openai/gpt-4o-mini':          { input: 0.15,  output: 0.60 },
  'openai/o3':                   { input: 10.00, output: 40.00 },

  // Google
  'google/gemini-2.5-pro':       { input: 1.25,  output: 10.00 },
  'google/gemini-2.5-flash':     { input: 0.15,  output: 0.60 },

  // DeepSeek
  'deepseek/deepseek-chat':      { input: 0.14,  output: 0.28 },
  'deepseek/deepseek-reasoner':  { input: 0.55,  output: 2.19 },

  // Local (free)
  'ollama/*':                    { input: 0, output: 0 },
};

// NOTE: When a new model is discovered via ModelCatalog.discoverFromProvider(),
// pricing is populated from the provider API response or the user's modelRegistry config.
// This table is NOT the authoritative source — it's the last resort.
```

#### Tasks
- [ ] Build cost calculator: `calculateCost(model, inputTokens, outputTokens, cacheTokens?)`
- [ ] Update `CostInfo` type to support multi-provider cost data
- [ ] Keep Claude CLI cost tracking as-is (it self-reports)
- [ ] For API providers: extract `usage.prompt_tokens` and `usage.completion_tokens` from responses
- [ ] Dashboard cost display works for all providers
- [ ] `swarm stats` aggregates costs across providers

---

## Implementation Order

| # | Feature | Impact | Effort | Dependencies | Week |
|---|---------|--------|--------|-------------|------|
| P1 | Provider registry & config | 10/10 | 2 weeks | None | 1-2 |
| P2 | OpenAI-compatible provider | 10/10 | 2 weeks | P1 | 1-3 |
| P3 | Anthropic API provider | 9/10 | 1 week | P1 | 2-3 |
| P5 | Swarm tool executor | 10/10 | 3 weeks | P2 | 2-5 |
| P6 | Modified AgentProcess | 10/10 | 2 weeks | P1, P2, P5 | 4-6 |
| P8.5 | Dynamic model discovery | 9/10 | 1 week | P1 | 3-4 |
| P9 | Prompt adaptation | 8/10 | 1 week | P6 | 5-6 |
| P10 | Unified cost tracking | 7/10 | 1 week | P2, P3, P8.5 | 5-6 |
| P4 | Google Gemini provider | 7/10 | 1 week | P1 | 6-7 |
| P7 | Dashboard model settings | 9/10 | 2 weeks | P1, P6, P8.5 | 6-8 |
| P8 | CLI `swarm models` command | 7/10 | 1 week | P1, P8.5 | 7-8 |

**Total: 8 weeks** (with parallelization)

**Critical path: P1 → P2 → P5 → P6** (provider registry → API provider → tool executor → agent process)

**Second critical path: P1 → P8.5 → P7/P8** (registry → dynamic discovery → dashboard/CLI model UIs)

---

## Migration Strategy

### Phase 1: Foundation (Weeks 1-3)
- Build provider registry, OpenAI-compat provider, Anthropic API provider
- **Zero breaking changes** — existing Claude CLI mode works exactly as before
- New config fields are optional; old `model: sonnet` still works

### Phase 2: Agentic Layer (Weeks 3-6)
- Build tool executor and agentic loop
- Modify AgentProcess to support API backends
- Test with mixed-model pipelines
- **Opt-in** — users enable multi-model by adding `providers:` to config

### Phase 3: Polish (Weeks 6-8)
- Dashboard model settings UI
- CLI model management commands
- Prompt adaptation layer
- Cost tracking across providers
- Ollama auto-discovery
- Comprehensive testing with: GPT-4o, Gemini, Llama 3, DeepSeek

### Backward Compatibility
- `model: sonnet` still works (maps to `anthropic/claude-sonnet-4` via CLI)
- No `providers:` config = Claude CLI mode only (existing behavior)
- All WebSocket commands unchanged
- Dashboard works with or without multi-model config
- Existing `.swarm/config.yaml` files are fully compatible

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Supported providers | 1 (Claude CLI) | 8+ (Anthropic, OpenAI, Google, Ollama, Together, Groq, DeepSeek, custom) |
| Per-stage model selection | No | Yes — different model per pipeline stage |
| Local model support | No | Yes — Ollama, vLLM, llama.cpp |
| API key management | N/A | Dashboard UI + CLI + env vars |
| Cost with mixed models | $3-8/pipeline | $0.80-3.50/pipeline (60% savings with cheap analyst/architect) |
| Free local pipeline | Impossible | Possible (all Ollama) |
| Model test from dashboard | No | Yes — one-click connectivity test |
| Provider auto-discovery | No | Yes — Ollama model listing |

---

## The End State

After Wave 8:

1. **Claude remains the default** — `swarm "Add a login page"` just works with Claude CLI, zero config
2. **Any model can participate** — `swarm "Add a login page" --model openai/gpt-4o` for the whole pipeline
3. **Mix and match** — cheap models for analysis, smart models for architecture, Claude for coding
4. **Local models** — `ollama/llama3.1:70b` for completely free, offline pipelines
5. **Dashboard config** — point-and-click model selection per stage, with cost estimates
6. **One API key format** — environment variables or config file, never hardcoded
7. **Zero hardcoded model names** — model lists are discovered dynamically from providers, not baked into source code. New models appear automatically.
8. **Graceful degradation** — if a model can't do tools, fall back to text-only mode for that stage
9. **Transparent costs** — see per-model, per-stage cost breakdown regardless of provider

**No more vendor lock-in. Claude is the best, but it's not the only option.**
