# Contributing to Stirrup

Thanks for your interest in contributing! This project is open core — the engine, CLI, visual editor, and plugin system are open source under MIT.

## Getting Started

```bash
git clone https://github.com/PrincipalForce/stirrup
cd stirrup
npm install
cd ui && npm install && cd ..
npm run build:all
npm test
```

## Development Workflow

1. Create a branch from `main`
2. Make your changes
3. Run tests: `npm test`
4. Type-check: `npx tsc --noEmit`
5. If you changed the UI: `cd ui && npx tsc --noEmit && npm run build`
6. Submit a pull request

## Project Structure

| Directory | Purpose |
|-----------|---------|
| `src/engine/` | DAG scheduler, runner, context manager |
| `src/nodes/` | Built-in node type handlers |
| `src/ai/` | Anthropic provider, tool manager |
| `src/persistence/` | State stores (SQLite, file) |
| `src/validation/` | Schema validation, cycle detection |
| `src/plugins/` | Plugin loader |
| `src/cli/` | CLI commands (yargs) |
| `src/server/` | REST API (Express) |
| `src/serve/` | Workflow service (triggers) |
| `src/mcp/` | MCP server for agents |
| `src/agent/` | WorkflowBuilder SDK |
| `ui/` | React + React Flow visual editor |
| `templates/` | Pre-built workflow templates |
| `schemas/` | JSON Schema definitions |
| `test/` | Vitest test suites |

## Ways to Contribute

### New Node Types
Create a plugin or propose a built-in node type. Each node type needs:
- A handler function in `src/nodes/`
- A config interface in `src/types/nodes.ts`
- A config editor component in `ui/src/components/config/`
- Tests

### Workflow Templates
Add practical templates to `templates/`. Good templates:
- Solve a real-world problem
- Use a mix of deterministic and AI nodes
- Declare params with descriptions
- Include trigger configuration
- Have clear node names and descriptions

### Bug Fixes
- Check existing issues first
- Include a test case that reproduces the bug
- Keep fixes focused — one bug per PR

### Documentation
- Improve README, AGENT-USAGE.md, or inline code comments
- Add examples to `examples/`

## Code Style

- TypeScript strict mode
- ESM (`"type": "module"`)
- No external formatting tools enforced — just be consistent with existing code
- Prefer inline styles in the React UI (no CSS framework)
- Tests use Vitest

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

Tests are in `test/` mirroring the `src/` structure. All PRs should maintain or improve test coverage.

## Releasing

Releases are managed by maintainers. The process:
1. Update version in `package.json`
2. `npm run build:all`
3. `npm test`
4. `npm publish`
