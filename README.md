<p align="center">
  <img src="./docs/stirrup-infographic.png" alt="Stirrup — AI Workflow Engine" width="680" />
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/stirrup-ai?style=flat-square&color=0ea5e9" alt="npm version" />
  <img src="https://img.shields.io/github/license/PrincipalForce/stirrup?style=flat-square&color=22c55e" alt="license" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-417e38?style=flat-square" alt="node version" />
  <img src="https://img.shields.io/badge/tests-48%20passing-22c55e?style=flat-square" alt="tests" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square" alt="typescript" />
</p>

<h1 align="center">Stirrup</h1>
<h3 align="center">AI Workflow Engine</h3>

<p align="center">
Build, visualize, and execute <b>AI-powered automation pipelines</b> with a visual node editor.<br/>
Connect LLMs, code generators, APIs, and integrations into production-ready workflows.
</p>

<p align="center">
  <b>20+ Templates</b> &nbsp;&bull;&nbsp; <b>8 Node Types</b> &nbsp;&bull;&nbsp; <b>YAML Format</b> &nbsp;&bull;&nbsp; <b>CLI + UI</b>
</p>

```bash
npm install -g stirrup-ai
```

---

## Powerful Node Types

Mix AI and deterministic nodes to build workflows that think, fetch, branch, and deploy.

| | Type | What it does |
|---|---|---|
| **AI** | `llm-prompt` | Send a templated prompt to Claude, get text or structured JSON back |
| **AI** | `code-generation` | AI writes code in JS/TS/Python, optionally executes it in a sandbox |
| **AI** | `decision-routing` | AI evaluates data and picks the next branch from labeled options |
| **AI** | `agent-tool-use` | Autonomous agent with access to registered tools in a loop |
| **Deterministic** | `transform` | Evaluate a JavaScript expression on inputs |
| **Deterministic** | `condition` | Branch the workflow based on an expression result |
| **Deterministic** | `http` | Make HTTP requests to any API |
| **Deterministic** | `script` | Run JavaScript in a sandboxed VM with fetch, URL, and await support |

All node types are extensible through the [plugin system](#plugins).

---

## Why Stirrup?

### Visual Node Editor
Build workflows by dragging nodes onto a canvas, connecting them, and configuring each one with purpose-built form editors. No code required to get started.

### AI Generate
Describe what you want in plain English and Claude generates the complete workflow with nodes, connections, and configuration automatically.

### 20+ Templates
Battle-tested templates for common tasks: PR reviews, deployment pipelines, marketing broadcasts, LinkedIn posting, content repurposing, competitor monitoring, SEO briefs, and more.

### Live Execution Monitor
Watch your workflow execute with real-time status updates. Nodes light up as they run, show timing, and display output data inline on the canvas.

### Debug & Inspect
When a node fails, click it to see the exact error, resolved inputs, and stack trace. Click **Analyze with AI** and Claude diagnoses the issue and suggests concrete field edits you can apply with one click.

### Params & Plugins
Define typed workflow parameters with service bindings for auto-injected credentials. Extend with 16 built-in plugins (GitHub, Slack, LinkedIn, Launchmatic, Stripe, Replicate, Buffer, Typefully, and more) or write your own.

### Interactive Tutorial
First-time users get a 15-step guided walkthrough that highlights each feature with a spotlight overlay and opens the real panels at each step. Reopenable anytime from the **?** button.

---

## Quick Start

```bash
# Install globally
npm install -g stirrup-ai

# Set your Anthropic API key
stirrup config set anthropicApiKey sk-ant-...

# Launch the visual editor
stirrup ui

# Or create a workflow from a template via CLI
stirrup init

# Run with parameters
stirrup run workflows/pr-review.yaml \
  --set repo=myorg/myrepo \
  --set prNumber=42
```

---

## How It Works

Workflows are YAML files that describe a directed acyclic graph. Each node is either deterministic or AI-powered. The engine executes them as a parallel DAG — independent nodes run concurrently, conditional branches are evaluated at runtime, and every step's state is persisted.

```yaml
id: review-pipeline
name: Automated Code Review
version: "1.0"

params:
  - name: repo
    type: string
    required: true
    picker: github-repo
  - name: prNumber
    type: number
    required: true
  - name: githubToken
    type: string
    required: true
    service: github

nodes:
  - id: fetch-diff
    type: http
    name: Fetch PR Diff
    inputs:
      - from: context.repo
        to: repo
    config:
      url: "https://api.github.com/repos/{{repo}}/pulls/{{pr}}"
      method: GET

  - id: review
    type: llm-prompt
    name: AI Code Review
    inputs:
      - from: nodes.fetch-diff.outputs.body
        to: diff
    config:
      promptTemplate: |
        Review this pull request for bugs and security issues:
        {{diff}}

  - id: route
    type: decision-routing
    name: Severity Check
    inputs:
      - from: nodes.review.outputs.response
        to: review
    config:
      prompt: "Are there critical issues? {{review}}"
      branches:
        block: "Critical issues found"
        approve: "Clean code"

edges:
  - from: fetch-diff
    to: review
  - from: review
    to: route
```

---

## Template Library

Start building in seconds with ready-made workflow templates.

| Template | What it does |
|----------|-------------|
| **AI Code Gen & Validation** | Generate code, test it, review quality, produce deployment-ready output |
| **GitHub Issue Auto-Triage** | Classify issues, add labels, assign priority, notify in Slack |
| **Blog Multi-Channel Repurposer** | Fetch a blog post, atomize into Twitter thread, LinkedIn, newsletter, YouTube |
| **Deploy & Notify Team** | Deploy to Launchmatic, run smoke tests, post results to Slack |
| **PR Review Pipeline** | Fetch diff, AI review, severity routing, post results |
| **LinkedIn Daily Post** | Topic in, LinkedIn-tailored post out, published directly |
| **Competitor Changelog Watcher** | Fetch RSS, AI summary, strategic brief to Slack |
| **SEO Content Brief** | Keyword research via SERP API, AI generates full content brief |
| **Multi-Platform Launch Broadcast** | Fan out to LinkedIn, X, Facebook, TikTok, YouTube in parallel |
| **Engine Smoke Test** | Exercises all 8 node types in one workflow to verify the engine |

Plus 14 more. Browse them in the UI or run `stirrup init` from the CLI.

---

## Debug & Execution Monitor

Full visibility into every execution. Inspect node-by-node results, see exact inputs and outputs, and diagnose failures with AI assistance.

- **Real-time progress** — SSE-powered node status updates as the workflow runs
- **Node inspector** — click any node to see config, inputs, outputs, and timing
- **AI-powered debugging** — Claude reads the error, config, and inputs, then suggests specific fixes
- **One-click apply** — review the AI's suggested edits with before/after diffs and apply them directly to the workflow
- **Isolated retry** — re-run a single failed node with modified inputs without re-executing the entire workflow

---

## Service Connections

Connect once, use everywhere. Credentials are stored locally (`~/.stirrup/tokens.json`, 0600 permissions) and auto-injected into any workflow that declares a matching `service` param.

| Service | Auth method | What it powers |
|---------|------------|----------------|
| **GitHub** | OAuth device flow or `gh` CLI | PRs, issues, code search, repo picker |
| **Launchmatic** | `lm login` browser flow or manual paste | Deploy, databases, domains, browser tests |
| **Anthropic** | API key (or `ANTHROPIC_API_KEY` env var) | Every AI node |
| **Slack** | Bot User OAuth Token (`xoxb-`) with guided setup | Messages, files, channels |
| **LinkedIn** | OAuth token | Post to feed, org pages, engagement stats |
| **Stripe** | Secret key or `stripe` CLI | Charges, customers, payments |
| **Replicate** | API token | Image generation (Flux), any hosted model |
| **Typefully** | API key | Schedule X/Twitter threads + LinkedIn posts |
| **Buffer** | Access token | Schedule to Facebook, Instagram, Threads |
| **AWS** | `aws configure` CLI | S3, Lambda, DynamoDB |
| **Google Cloud** | `gcloud auth login` CLI | GCS, BigQuery, Cloud Run |

Environment variables (e.g., `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`) are detected automatically — no need to paste them if they're already set in your shell.

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
  stirrup plugin <subcommand>     Manage plugins
```

---

## Deployment

### As a Service

```bash
stirrup serve --port 3711
```

### As a Standalone Project

```bash
stirrup export templates/pr-review.yaml -o ./deploy --format docker
```

### As an Embedded SDK

```typescript
import { WorkflowEngine, WorkflowBuilder, SqliteStateStore } from "stirrup-ai";

const engine = new WorkflowEngine({
  definitionsDir: "./workflows",
  stateStore: new SqliteStateStore("./data.db"),
});

const result = await engine.execute("my-workflow", {
  repo: "myorg/myrepo",
  prNumber: 42,
});
```

### Deploy to Launchmatic

Export and deploy directly from the UI — click Export, choose "Deploy to Launchmatic", and your workflow runs as a persistent hosted service with environment variables auto-configured.

---

## Agent Integration

Stirrup is built for AI agents to use. An agent can discover node types, construct workflows, validate them, execute with parameters, and inspect results — all through structured APIs.

### MCP Server

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

### WorkflowBuilder API

```typescript
import { WorkflowBuilder } from "stirrup-ai";

const workflow = new WorkflowBuilder("etl-pipeline", "Data ETL")
  .param("sourceUrl", "string", { required: true })
  .http("extract", "Fetch Data", {
    url: "{{sourceUrl}}", method: "GET",
    inputs: [{ from: "context.sourceUrl", to: "sourceUrl" }],
  })
  .llmPrompt("enrich", "AI Enrichment", {
    promptTemplate: "Classify this data: {{data}}",
    inputs: [{ from: "nodes.extract.outputs.body", to: "data" }],
  })
  .edge("extract", "enrich")
  .build();
```

See [AGENT-USAGE.md](./AGENT-USAGE.md) for the complete integration guide.

---

## Plugins

16 built-in plugins auto-load on server start. Write your own with the PluginContext API:

```typescript
import type { PluginContext } from "stirrup-ai";

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("my-node", async (config, execCtx) => {
    // Your logic here
    return { result: "done" };
  });

  ctx.registerTool({
    name: "my-tool",
    description: "A tool for agent nodes",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    handler: async (input) => ({ rows: [] }),
  });
}
```

**Built-in plugins:** GitHub, Slack, LinkedIn, Launchmatic, Typefully, Buffer, Replicate, Webhook, Filesystem, CSV/JSON, HTTP Auth, Scheduler, Logger, PostgreSQL, Redis, Email, S3

---

## Development

```bash
git clone https://github.com/PrincipalForce/stirrup.git
cd stirrup
npm install
cd ui && npm install && cd ..

npm test              # 48 tests across 9 suites
npm run build         # Build engine + CLI
npm run build:ui      # Build React UI
npm run build:all     # Build everything
npm run dev:ui        # Vite dev server with hot reload
```

---

## Contributing

We welcome contributions. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup instructions.

Good first contributions:
- New workflow templates in `templates/`
- Node type plugins
- UI improvements
- Documentation

---

## License

MIT — see [LICENSE](./LICENSE)

Open source. Free forever. Self-hosted.

Built by [PrincipalForce](https://github.com/PrincipalForce).
