# Agent Usage Guide

This document describes how AI agents can use the Stirrup to design, create, execute, and deploy workflows programmatically.

## Overview

The Stirrup provides three integration surfaces for agents:

| Surface | Best For | Protocol |
|---------|----------|----------|
| **MCP Server** | Claude Code, Claude Desktop, any MCP client | stdio (JSON-RPC) |
| **SDK (WorkflowBuilder)** | Custom agents, scripts, LangChain/CrewAI tools | TypeScript/Node.js import |
| **REST API** | Any HTTP client, cross-language agents | HTTP/JSON |

---

## 1. MCP Server (Claude Code / Claude Desktop)

### Setup

Add to your MCP config (`.claude/settings.json`, `claude_desktop_config.json`, etc.):

```json
{
  "mcpServers": {
    "stirrup": {
      "command": "stirrup-mcp",
      "env": {
        "WORKFLOWS_DIR": "./workflows",
        "DB_PATH": "./stirrup.db"
      }
    }
  }
}
```

### Available Tools

| Tool | Description |
|------|-------------|
| `list_workflows` | List all available workflow definitions with IDs, names, descriptions, and parameter info |
| `get_workflow` | Get the full definition of a workflow by ID, including all nodes, edges, and configuration |
| `create_workflow` | Create a new workflow from a JSON definition. Validates, saves as YAML, and registers with the engine |
| `run_workflow` | Execute a workflow by ID with given parameters. Returns the full execution state including all step outputs |
| `get_execution` | Get the current state of a workflow execution by its execution ID |
| `validate_workflow` | Validate a workflow definition JSON without saving or executing it |
| `list_node_types` | List all available node types with their configuration schemas |

### Example Agent Flow

An agent can:

1. Call `list_node_types` to understand what building blocks are available
2. Call `create_workflow` with a JSON workflow definition
3. Call `run_workflow` with the workflow ID and parameters
4. Call `get_execution` to check results

---

## 2. Programmatic SDK (WorkflowBuilder)

### Install

```bash
npm install stirrup
```

### WorkflowBuilder API

The `WorkflowBuilder` provides a fluent API for constructing workflows in code — no YAML files needed.

```typescript
import {
  WorkflowBuilder,
  WorkflowEngine,
  SqliteStateStore,
  transformHandler,
  conditionHandler,
  httpHandler,
  scriptHandler,
} from "stirrup";

// 1. Build a workflow programmatically
const workflow = new WorkflowBuilder("review-pr", "PR Review Pipeline")
  .setDescription("Fetch a PR, run AI code review, post results")
  .param("repo", "string", { required: true, description: "GitHub repository (owner/repo)" })
  .param("prNumber", "number", { required: true, description: "Pull request number" })
  .param("token", "string", { required: true, description: "GitHub access token" })
  .http("fetch-pr", "Fetch PR Diff", {
    url: "https://api.github.com/repos/{{repo}}/pulls/{{pr}}",
    method: "GET",
    headers: { Authorization: "Bearer {{token}}" },
    inputs: [
      { from: "context.repo", to: "repo" },
      { from: "context.prNumber", to: "pr" },
      { from: "context.token", to: "token" },
    ],
  })
  .llmPrompt("review", "AI Code Review", {
    promptTemplate: "Review this PR diff for bugs and issues:\n\n{{diff}}",
    systemPrompt: "You are an expert code reviewer.",
    responseFormat: "json",
    inputs: [{ from: "nodes.fetch-pr.outputs.body", to: "diff" }],
  })
  .transform("format", "Format Output", {
    expression: '({ summary: inputs.review, reviewedAt: new Date().toISOString() })',
    inputs: [{ from: "nodes.review.outputs.response", to: "review" }],
  })
  .edge("fetch-pr", "review")
  .edge("review", "format")
  .build();

// 2. Set up the engine
const engine = new WorkflowEngine({
  stateStore: new SqliteStateStore("./stirrup.db"),
});

const registry = engine.getRegistry();
registry.register("transform", transformHandler);
registry.register("condition", conditionHandler);
registry.register("http", httpHandler);
registry.register("script", scriptHandler);
// For AI nodes, also register:
// import { AnthropicProvider, createLlmPromptHandler } from "stirrup";
// const provider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY);
// registry.register("llm-prompt", createLlmPromptHandler(provider));

// 3. Register and execute
engine.registerWorkflow(workflow);
const result = await engine.execute("review-pr", {
  repo: "myorg/myrepo",
  prNumber: 42,
  token: process.env.GITHUB_TOKEN,
});

console.log(result.status);      // "completed"
console.log(result.steps);       // per-node results with outputs
```

### WorkflowBuilder Methods

**Metadata:**
- `.setDescription(desc)` — set workflow description
- `.setVersion(v)` — set version string
- `.param(name, type, opts)` — declare a runtime parameter
- `.setContext(obj)` — set initial context values
- `.setTriggers(triggers)` — configure HTTP/webhook/cron triggers
- `.setRetryDefaults(policy)` — set default retry policy

**Node Types (shorthand methods):**
- `.transform(id, name, { expression, inputs?, outputs? })`
- `.condition(id, name, { expression, branches, inputs? })`
- `.http(id, name, { url, method, headers?, body?, inputs? })`
- `.script(id, name, { code, inputs?, outputs?, timeoutMs? })`
- `.llmPrompt(id, name, { promptTemplate, systemPrompt?, model?, responseFormat?, inputs? })`
- `.agentToolUse(id, name, { systemPrompt, taskTemplate, tools, inputs? })`
- `.decisionRouting(id, name, { promptTemplate, branches, nodeBranches, inputs? })`
- `.codeGeneration(id, name, { promptTemplate, language, execute?, inputs? })`
- `.node(id, type, name, config, opts)` — generic node for custom/plugin types

**Edges:**
- `.edge(from, to, condition?)` — connect two nodes

**Output:**
- `.build()` — returns `WorkflowDefinition` object
- `.toJson(pretty?)` — returns JSON string
- `.toYaml()` — returns YAML string

---

## 3. REST API (Any HTTP Client)

### Start the Server

```bash
# Serve all workflows in a directory
stirrup serve --port 3711 --workflows-dir ./workflows
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check with workflow count and uptime |
| `GET` | `/workflows` | List all workflows with their endpoints and parameter info |
| `POST` | `/run/:workflowId` | Execute any workflow by ID. Body = parameter values |
| `POST` | `/webhook/:source` | Webhook ingress — matches and triggers workflows by source |
| `POST` | Custom paths | Per-workflow HTTP trigger paths (configured in YAML) |

### Example: Run a Workflow

```bash
curl -X POST http://localhost:3711/run/pr-review \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "myorg/myrepo",
    "prNumber": 42,
    "token": "ghp_..."
  }'
```

Response:
```json
{
  "executionId": "abc-123",
  "workflowId": "pr-review",
  "status": "completed",
  "context": { "repo": "myorg/myrepo", "prNumber": 42 },
  "steps": {
    "fetch-pr": { "status": "completed", "outputs": { "body": "..." } },
    "review": { "status": "completed", "outputs": { "response": "..." } }
  }
}
```

### Webhook Triggers

Point external services at `/webhook/:source`:

```bash
# GitHub webhook → triggers any workflow with triggers.webhook.source: "github"
# Configure in GitHub repo settings:
#   Payload URL: https://your-server.com/webhook/github
#   Content type: application/json
#   Events: Pull requests
```

---

## 4. CLI (JSON Output Mode)

For agents that shell out to the CLI:

```bash
# Run with parameters via --set flags
stirrup run pr-review \
  --set repo=myorg/myrepo \
  --set prNumber=42 \
  --set token=$GITHUB_TOKEN \
  --no-interactive

# Run with a JSON context file
echo '{"repo": "myorg/myrepo", "prNumber": 42}' > params.json
stirrup run pr-review --context-file params.json

# Run with inline JSON
stirrup run pr-review \
  --context '{"repo": "myorg/myrepo", "prNumber": 42}'

# Validate before running
stirrup validate workflow.yaml

# List available workflows
stirrup list
```

---

## The Full Agent Loop

An agent running in a dev container can execute the complete lifecycle:

```
1. DISCOVER  →  list_node_types          What building blocks exist?
2. DESIGN    →  create_workflow          Build a workflow from task description
3. VALIDATE  →  validate_workflow        Check the definition is valid
4. EXECUTE   →  run_workflow             Run with real data
5. INSPECT   →  get_execution            Read results, check outputs
6. ITERATE   →  modify + re-run          Fix issues, re-execute
7. DEPLOY    →  stirrup serve   Run as a persistent service
             →  stirrup export  Package as standalone project
```

### Agents Building Agent Workflows

The workflows themselves can contain AI nodes. This means an outer agent (e.g., Claude via MCP) can construct a DAG that includes inner AI nodes (LLM prompts, tool-use agents, decision routers) that execute as part of the pipeline.

For example, an agent could:

1. Receive a task: "Set up automated PR reviews for our repo"
2. Use `create_workflow` to build a workflow with HTTP nodes (fetch PR), LLM nodes (review code), and condition nodes (check severity)
3. Use `run_workflow` to test it against an actual PR
4. Inspect the results and refine the prompt templates
5. Deploy it via `stirrup serve` with a GitHub webhook trigger

The agent designs the automation, the engine executes it deterministically with AI-powered nodes where needed.

---

## Available Node Types

| Type | Category | Description | Key Config Fields |
|------|----------|-------------|-------------------|
| `transform` | Deterministic | Evaluate a JS expression | `expression` |
| `condition` | Deterministic | Branch based on expression result | `expression` |
| `http` | Deterministic | HTTP requests to APIs | `url`, `method`, `headers`, `body` |
| `script` | Deterministic | Run JS in a sandbox | `code`, `timeoutMs` |
| `llm-prompt` | AI | Send a prompt to Claude | `promptTemplate`, `systemPrompt`, `model`, `responseFormat` |
| `agent-tool-use` | AI | Autonomous AI with tool loop | `systemPrompt`, `taskTemplate`, `tools`, `maxIterations` |
| `decision-routing` | AI | AI picks the next branch | `promptTemplate`, `branches` |
| `code-generation` | AI | AI generates and optionally runs code | `promptTemplate`, `language`, `execute` |

## Workflow Parameters

Workflows can declare parameters with types, descriptions, defaults, and required flags:

```yaml
params:
  - name: repo
    type: string
    description: "GitHub repository (owner/repo)"
    required: true
  - name: maxResults
    type: number
    description: "Maximum results to return"
    default: 10
```

Parameters are passed as context values at runtime and are available to nodes via `context.<paramName>` input mappings.

## Workflow Triggers

Workflows can declare how they should be triggered in serve mode:

```yaml
triggers:
  http:
    path: /my-endpoint
    method: POST
  webhook:
    source: github
    events:
      - pull_request.opened
      - pull_request.synchronize
    secret: "${WEBHOOK_SECRET}"
  cron:
    schedule: "0 */6 * * *"
    timezone: "America/New_York"
  watch:
    paths:
      - "./data/*.csv"
    events:
      - create
      - change
```
