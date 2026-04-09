<p align="center">
  <img src="https://img.shields.io/npm/v/stirrup-ai?style=flat-square&color=0ea5e9" alt="npm version" />
  <img src="https://img.shields.io/github/license/PrincipalForce/stirrup?style=flat-square&color=22c55e" alt="license" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-417e38?style=flat-square" alt="node version" />
  <img src="https://img.shields.io/badge/tests-40%20passing-22c55e?style=flat-square" alt="tests" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square" alt="typescript" />
</p>

# Stirrup

**The interface between you and AI-powered automation.**

Stirrup is a workflow engine that lets you define deterministic DAG pipelines with AI-powered nodes. Design workflows visually, run them from the CLI, deploy as services, or let AI agents build and execute them programmatically.

```bash
npm install -g stirrup-ai
```

---

## Why Stirrup

Most AI automation tools force a choice: either you get rigid, step-by-step pipelines with no intelligence, or you get unpredictable AI agents with no structure. Stirrup gives you both.

- **Deterministic when you need it.** HTTP calls, data transforms, conditional branching, and scripts execute exactly as defined.
- **Intelligent where it matters.** LLM prompts, autonomous agents, AI-powered routing, and code generation handle the parts that require reasoning.
- **Visible and controllable.** Every execution is persisted. Pause, inspect, resume, or retry any workflow at any step.

---

## Quick Start

```bash
# Set your API key
stirrup config set anthropicApiKey sk-ant-...

# Create a workflow from a template
stirrup init

# Run it with parameters
stirrup run workflows/pr-review.yaml \
  --set repo=myorg/myrepo \
  --set prNumber=42

# Launch the visual editor
stirrup ui

# Deploy as a persistent service
stirrup serve
```

---

## How It Works

Workflows are YAML files that describe a directed acyclic graph. Each node is either deterministic (always produces the same output for the same input) or AI-powered (uses Claude to reason, decide, or generate).

```yaml
id: review-pipeline
name: Automated Code Review
version: "1.0"

params:
  - name: repo
    type: string
    required: true
    description: "GitHub repository (owner/repo)"
  - name: prNumber
    type: number
    required: true

triggers:
  webhook:
    source: github
    events: [pull_request.opened]

nodes:
  - id: fetch-diff
    type: http
    name: Fetch PR Diff
    inputs:
      - from: context.repo
        to: repo
      - from: context.prNumber
        to: pr
    outputs: [body]
    config:
      url: "https://api.github.com/repos/{{repo}}/pulls/{{pr}}"
      method: GET

  - id: review
    type: llm-prompt
    name: AI Code Review
    inputs:
      - from: nodes.fetch-diff.outputs.body
        to: diff
    outputs: [response]
    config:
      promptTemplate: |
        Review this pull request for bugs, security issues,
        and code quality problems:

        {{diff}}
      systemPrompt: "You are an expert code reviewer."
      responseFormat: json

  - id: route
    type: decision-routing
    name: Severity Check
    inputs:
      - from: nodes.review.outputs.response
        to: review
    outputs: [selectedBranch]
    config:
      promptTemplate: "Are there critical issues? {{review}}"
      branches:
        block: "Critical issues that must be fixed"
        approve: "No critical issues"

edges:
  - from: fetch-diff
    to: review
  - from: review
    to: route
```

The engine executes this as a parallel DAG — independent nodes run concurrently, conditional branches are evaluated at runtime, and every step's state is persisted for inspection or resumption.

---

## Node Types

Stirrup ships with 8 built-in node types across two categories.

### Deterministic Nodes

| Type | Purpose | Key Config |
|------|---------|------------|
| **transform** | Evaluate a JavaScript expression on inputs | `expression` |
| **condition** | Branch the workflow based on an expression result | `expression` returning a branch name |
| **http** | Make HTTP requests to external APIs | `url`, `method`, `headers`, `body` |
| **script** | Execute arbitrary JavaScript in a sandboxed VM | `code`, `timeoutMs` |

### AI-Powered Nodes

| Type | Purpose | Key Config |
|------|---------|------------|
| **llm-prompt** | Send a templated prompt to Claude | `promptTemplate`, `systemPrompt`, `responseFormat` |
| **agent-tool-use** | Autonomous agent with tool access in a loop | `systemPrompt`, `taskTemplate`, `tools[]` |
| **decision-routing** | AI evaluates data and picks the next branch | `promptTemplate`, `branches` |
| **code-generation** | AI generates code, optionally executes it | `promptTemplate`, `language`, `execute` |

All node types are extensible through the [plugin system](#plugins).

---

## Visual Editor

Launch the browser-based workflow designer:

```bash
stirrup ui
```

The editor provides:

- **Drag-and-drop canvas** — React Flow-based DAG editor with node palette
- **Type-aware config forms** — each node type has purpose-built form fields, not raw JSON
- **Live execution** — run workflows and watch node status update in real time via SSE
- **Template browser** — start from pre-built workflow patterns
- **Parameter dialog** — prompted for required values before execution

---

## CLI Reference

```
stirrup <command> [options]

Workflows
  stirrup run <workflow>          Execute a workflow by ID or file path
  stirrup list                    List available workflow definitions
  stirrup validate <file>         Validate a workflow YAML/JSON file
  stirrup init                    Scaffold a new workflow from templates

Execution
  stirrup status [execution-id]   Show execution state(s)
  stirrup resume <execution-id>   Resume a paused or failed execution

Deployment
  stirrup serve                   Run workflows as a persistent HTTP service
  stirrup export <workflow>       Export as a standalone deployable project
  stirrup ui                      Launch the visual editor

Configuration
  stirrup config set <key> <val>  Set a configuration value
  stirrup config get [key]        Show configuration
  stirrup config unset <key>      Remove a configuration value
  stirrup plugin <subcommand>     Manage plugins

Global Options
  -w, --workflows-dir   Workflow definitions directory  [default: "./workflows"]
  -v, --verbose         Enable verbose output
      --store           State backend: sqlite | file    [default: "sqlite"]
      --db              SQLite database path            [default: "./stirrup.db"]
```

### Running Workflows with Parameters

Workflows declare typed parameters. Supply them at runtime via any combination:

```bash
# Named parameters
stirrup run pr-review --set repo=myorg/myrepo --set prNumber=42

# JSON string
stirrup run pr-review -c '{"repo": "myorg/myrepo", "prNumber": 42}'

# JSON file
stirrup run pr-review --context-file params.json

# Interactive mode — prompts for missing required params
stirrup run pr-review -i
```

---

## Deployment

### As a Service

```bash
stirrup serve --port 3711
```

Exposes every workflow as an HTTP endpoint:

```
POST /run/:workflowId     Execute any workflow by ID
POST /webhook/:source     Webhook ingress (GitHub, Slack, etc.)
GET  /workflows           List all available workflow endpoints
GET  /health              Health check
```

Workflows can declare triggers in their YAML:

```yaml
triggers:
  http:
    path: /pr-review
    method: POST
  webhook:
    source: github
    events: [pull_request.opened, pull_request.synchronize]
  cron:
    schedule: "0 */6 * * *"
```

### As a Standalone Project

```bash
stirrup export templates/pr-review.yaml -o ./deploy --format docker
```

Generates a self-contained project:

```
deploy/pr-review/
  package.json      Dependencies and start script
  server.js         Express server with /run and /status
  workflows/        Workflow definition
  Dockerfile        Ready for container deployment
  README.md         API documentation
  .env.example      Environment variable template
```

### As an Embedded SDK

```typescript
import { WorkflowEngine, WorkflowBuilder, SqliteStateStore } from "stirrup-ai";

const engine = new WorkflowEngine({
  definitionsDir: "./workflows",
  stateStore: new SqliteStateStore("./data.db"),
});

// Register node handlers, then execute
const result = await engine.execute("my-workflow", {
  repo: "myorg/myrepo",
  prNumber: 42,
});
```

---

## Agent Integration

Stirrup is built for AI agents to use. An agent can discover available node types, construct workflow definitions, validate them, execute with parameters, and inspect results — all through structured APIs.

### MCP Server

For Claude Code, Claude Desktop, and any MCP-compatible client:

```json
{
  "mcpServers": {
    "stirrup": {
      "command": "stirrup-mcp",
      "env": { "WORKFLOWS_DIR": "./workflows" }
    }
  }
}
```

**Available tools:** `list_workflows`, `get_workflow`, `create_workflow`, `run_workflow`, `get_execution`, `validate_workflow`, `list_node_types`

### WorkflowBuilder API

Fluent TypeScript API for constructing workflows in code:

```typescript
import { WorkflowBuilder } from "stirrup-ai";

const workflow = new WorkflowBuilder("etl-pipeline", "Data ETL")
  .param("sourceUrl", "string", { required: true })
  .http("extract", "Fetch Data", {
    url: "{{sourceUrl}}",
    method: "GET",
    inputs: [{ from: "context.sourceUrl", to: "sourceUrl" }],
  })
  .llmPrompt("enrich", "AI Enrichment", {
    promptTemplate: "Classify this data: {{data}}",
    responseFormat: "json",
    inputs: [{ from: "nodes.extract.outputs.body", to: "data" }],
  })
  .edge("extract", "enrich")
  .build();
```

### REST API

Any HTTP client or agent framework can call the serve endpoints:

```bash
curl -X POST http://localhost:3711/run/my-workflow \
  -H "Content-Type: application/json" \
  -d '{"repo": "myorg/myrepo", "prNumber": 42}'
```

See [AGENT-USAGE.md](./AGENT-USAGE.md) for the complete integration guide.

---

## Templates

Stirrup includes production-ready workflow templates that demonstrate real patterns.

| Template | Nodes | Pattern | Description |
|----------|-------|---------|-------------|
| **PR Review** | 6 | HTTP + AI + Branching | Fetch diff, AI review, severity routing, post results |
| **Content Pipeline** | 6 | Multi-stage AI + Quality Gate | Research, outline, draft, AI quality check, revise/publish |
| **Data ETL** | 5 | Extract + AI Enrich + Load | API extraction, validation, AI enrichment, aggregation |
| **Incident Triage** | 6 | Classification + Agent | Alert parsing, severity classification, agent diagnostics |
| **Code Generation** | 6 | Parallel + Review Gate | Spec analysis, parallel code+test gen, AI review gate |
| **Customer Support** | 5 | Routing + Agent | Ticket classification, auth investigation, response drafting |

```bash
# Browse and scaffold from templates
stirrup init

# Or use in the visual editor
stirrup ui  # Click "Browse Templates"
```

---

## Plugins

Extend Stirrup with custom node types and tools:

```typescript
// my-plugin/index.ts
import type { PluginContext } from "stirrup-ai";

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("slack-notify", async (config, execCtx) => {
    const { channel, message } = config as { channel: string; message: string };
    // Send to Slack...
    return { messageId: "msg_123", channel };
  });

  ctx.registerTool({
    name: "query-database",
    description: "Run a SQL query",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    handler: async (input) => {
      // Execute query...
      return { rows: [] };
    },
  });
}
```

```bash
stirrup plugin add ./my-plugin
```

Plugins can contribute node types, tools for agent nodes, and validators.

---

## Architecture

```
src/
  engine/        DAG scheduler, runner with retry, context manager
  nodes/         Built-in node type handlers (8 types)
  ai/            Anthropic SDK provider, tool manager, prompt templates
  persistence/   SQLite and file-based state stores
  validation/    JSON Schema validation, DAG cycle detection
  plugins/       Dynamic plugin loader with PluginContext API
  cli/           12 yargs commands (run, serve, export, config, etc.)
  server/        Express REST API with SSE for live events
  serve/         Workflow service (HTTP triggers, webhooks, cron)
  mcp/           MCP server for AI agent integration
  agent/         WorkflowBuilder fluent API
ui/              React + React Flow visual editor
templates/       6 pre-built workflow templates
schemas/         JSON Schema for workflow definitions
```

**Key design decisions:**

- **`Promise.race` scheduling** — nodes are I/O-bound (API calls, LLM requests), not CPU-bound. The scheduler dispatches all ready nodes as concurrent promises and reacts as soon as any completes, maximizing throughput.
- **Explicit edges + shared context** — edges define execution order and conditional routing as a first-class concern. Input mappings define data flow. Both are available; neither is mandatory.
- **State after every node** — execution state is persisted after each node completion. Worst case on crash: one node's work is lost.
- **Plugin types bypass schema** — the JSON Schema validates structure, not type names. Plugin node types are validated at runtime via the registry, not at parse time.

---

## Development

```bash
git clone https://github.com/PrincipalForce/stirrup.git
cd stirrup
npm install
cd ui && npm install && cd ..

npm test              # 40 tests across 8 suites
npm run build         # Build engine + CLI
npm run build:ui      # Build React UI
npm run build:all     # Build everything
npm run dev:ui        # Vite dev server with hot reload
```

### Running Locally

```bash
npm run build:all
npm link
stirrup config set anthropicApiKey sk-ant-...
stirrup ui
```

---

## Contributing

We welcome contributions. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup instructions and guidelines.

Good first contributions:
- New workflow templates in `templates/`
- Node type plugins
- UI improvements
- Documentation

---

## License

MIT &mdash; see [LICENSE](./LICENSE)

The engine, CLI, visual editor, and plugin system are fully open source. Premium features for teams and enterprises are developed separately by [PrincipalForce](https://github.com/PrincipalForce).
