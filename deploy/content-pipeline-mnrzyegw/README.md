# AI Content Generation Pipeline

Research a topic, generate a draft, review quality, and produce a final polished article

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your API keys
npm start
```

## API

### POST /run

Execute the workflow with parameters.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `topic` | string | Yes | - | The topic to write about |
| `audience` | string | Yes | software engineers | Target audience |
| `tone` | string | No | technical but approachable | Writing tone/style |

### GET /status/:executionId

Check the status of a running or completed execution.

## Example

```bash
curl -X POST http://localhost:3000/run \
  -H "Content-Type: application/json" \
  -d '{"topic":"value","audience":"software engineers"}'
```
