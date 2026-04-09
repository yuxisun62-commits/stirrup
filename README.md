# Stirrup

A TypeScript engine for building and executing deterministic DAG workflows with AI-powered nodes. Design workflows visually or in YAML, run them from the CLI, deploy as services, or let AI agents build and execute them programmatically.

## Features

- **DAG Execution Engine** — parallel execution, conditional branching, joins, retry policies
- **8 Node Types** — 4 deterministic (transform, condition, HTTP, script) + 4 AI-powered (LLM prompt, agent tool-use, decision routing, code generation)
- **Visual Editor** — React Flow-based UI with drag-and-drop, type-aware config forms, live execution status
- **CLI** — run, validate, init, serve, export workflows from the terminal
- **MCP Server** — AI agents (Claude, etc.) can create and execute workflows via Model Context Protocol
- **Plugin System** — extend with custom node types and tools
- **State Persistence** — SQLite-backed, pause/resume/retry any execution
- **Deploy Anywhere** — serve as HTTP microservice, export as standalone project, embed as SDK

## Quick Start

```bash
# Install
npm install -g stirrup

# Create a workflow from a template
stirrup init

# Run it
stirrup run workflows/my-workflow.yaml --set param=value

# Launch the visual editor
stirrup ui

# Deploy as a service
stirrup serve
```

## Workflow Definition

Workflows are YAML/JSON files describing a directed acyclic graph of nodes:

```yaml
id: my-pipeline
name: My Pipeline
version: "1.0"

params:
  - name: inputData
    type: string
    required: true
    description: "Data to process"

nodes:
  - id: process
    type: transform
    name: Process Input
    inputs:
      - from: context.inputData
        to: data
    outputs: [result]
    config:
      expression: "({ result: inputs.data.toUpperCase() })"

  - id: analyze
    type: llm-prompt
    name: AI Analysis
    inputs:
      - from: nodes.process.outputs.result
        to: text
    outputs: [response]
    config:
      promptTemplate: "Analyze this text: {{text}}"
      responseFormat: json

edges:
  - from: process
    to: analyze
```

## Node Types

| Type | Category | Description |
|------|----------|-------------|
| `transform` | Deterministic | Evaluate a JS expression on inputs |
| `condition` | Deterministic | Branch based on expression result |
| `http` | Deterministic | HTTP requests to external APIs |
| `script` | Deterministic | Run JS in a sandboxed VM |
| `llm-prompt` | AI | Send templated prompts to Claude |
| `agent-tool-use` | AI | Autonomous AI agent with tool loop |
| `decision-routing` | AI | AI picks the next branch |
| `code-generation` | AI | AI generates and optionally executes code |

## CLI Commands

```
stirrup run <workflow>         Execute a workflow
stirrup list                   List available workflows
stirrup status [execution-id]  Show execution state
stirrup resume <execution-id>  Resume paused/failed execution
stirrup validate <file>        Validate a workflow file
stirrup init                   Scaffold from templates
stirrup ui                     Launch visual editor
stirrup serve                  Run as HTTP service
stirrup export <workflow>      Export as standalone project
stirrup plugin <subcommand>    Manage plugins
```

### Running with Parameters

```bash
# --set flags
stirrup run pr-review --set repo=org/repo --set prNumber=42

# JSON context
stirrup run pr-review -c '{"repo": "org/repo", "prNumber": 42}'

# From file
stirrup run pr-review --context-file params.json

# Interactive — prompts for missing required params
stirrup run pr-review -i
```

## Templates

Built-in workflow templates for common patterns:

| Template | Description |
|----------|-------------|
| PR Review | Fetch PR diff, AI code review, severity routing, post results |
| Content Pipeline | Research, outline, draft, quality gate, revise/publish |
| Data ETL | Extract from API, validate, AI enrich, aggregate, load |
| Incident Triage | Parse alert, classify severity, diagnostics, response plan |
| Code Generation | Analyze spec, generate code + tests, AI review gate |
| Customer Support | Classify ticket, investigate, assess priority, draft response |

## Deployment

### As a Service

```bash
stirrup serve --port 3711
# POST /run/:workflowId — execute any workflow
# POST /webhook/:source — webhook ingress
# GET  /workflows       — list endpoints
# GET  /health          — health check
```

### As a Standalone Project

```bash
stirrup export my-workflow.yaml -o ./deploy --format docker
cd deploy/my-workflow
npm install && npm start
```

### As an Embedded SDK

```typescript
import { WorkflowEngine, WorkflowBuilder } from "stirrup";

const engine = new WorkflowEngine({ definitionsDir: "./workflows" });
const result = await engine.execute("my-workflow", { inputData: "hello" });
```

## Agent Integration

AI agents can build, validate, and execute workflows via:

- **MCP Server** — for Claude Code, Claude Desktop, and MCP-compatible clients
- **REST API** — for LangChain, CrewAI, or any HTTP-based agent
- **SDK** — `WorkflowBuilder` fluent API for programmatic construction

See [AGENT-USAGE.md](./AGENT-USAGE.md) for complete integration guide.

### MCP Setup

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

## Plugin System

Extend with custom node types:

```typescript
// my-plugin/index.ts
export default function register(ctx) {
  ctx.registerNodeType("slack-send", async (config, execCtx) => {
    // your implementation
    return { messageId: "..." };
  });
}
```

```bash
stirrup plugin add ./my-plugin
```

## Architecture

```
src/
  engine/      — DAG scheduler, runner, context manager
  nodes/       — Built-in node type handlers
  ai/          — Anthropic provider, tool manager, prompt templates
  persistence/ — SQLite + file state stores
  validation/  — JSON Schema + cycle detection
  plugins/     — Plugin loader and manifest types
  cli/         — yargs commands
  server/      — Express REST API + SSE
  serve/       — Workflow service (HTTP triggers, webhooks, cron)
  mcp/         — MCP server for AI agents
  agent/       — WorkflowBuilder fluent API
ui/            — React + React Flow visual editor
templates/     — Pre-built workflow templates
schemas/       — JSON Schema for workflow definitions
```

## Development

```bash
git clone https://github.com/PrincipalForce/stirrup
cd stirrup
npm install
cd ui && npm install && cd ..

npm test            # Run tests (40 passing)
npm run build       # Build engine + CLI
npm run build:ui    # Build React UI
npm run build:all   # Build everything
npm run dev:ui      # React dev server with hot reload
```

## License

MIT — see [LICENSE](./LICENSE)

## Open Core

The engine, CLI, and visual editor are fully open source under MIT. Premium features for teams and enterprises (hosted execution, collaboration, audit logs, SSO) are available separately.
