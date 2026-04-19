import { describe, it, expect } from "vitest";
import { importN8nWorkflow } from "../../src/import/n8n.js";

function importOne(nodeType: string, parameters: Record<string, unknown>, credentials?: Record<string, unknown>) {
  return importN8nWorkflow({
    name: "single",
    nodes: [
      {
        id: "1",
        name: "Node",
        type: nodeType,
        parameters,
        credentials,
      },
    ],
  });
}

describe("Slack mapper", () => {
  it("translates postMessage → slack-send with channel + text", () => {
    const { workflow, report } = importOne("n8n-nodes-base.slack", {
      operation: "postMessage",
      channel: "#deploys",
      text: "Hello from n8n",
    });
    const node = workflow.nodes[0];
    expect(node.type).toBe("slack-send");
    expect(node.config.channel).toBe("#deploys");
    expect(node.config.text).toBe("Hello from n8n");
    expect(report.credentialsNeeded).toContain("slack");
  });

  it("falls back to passthrough for unsupported operations", () => {
    const { workflow } = importOne("n8n-nodes-base.slack", { operation: "createChannel" });
    expect(workflow.nodes[0].type).toBe("passthrough");
  });
});

describe("OpenAI mapper", () => {
  it("collapses chat messages into llm-prompt", () => {
    const { workflow, report } = importOne("n8n-nodes-base.openAi", {
      resource: "chat",
      messages: { values: [{ role: "user", content: "Hi there" }] },
      model: "gpt-4o-mini",
    });
    const node = workflow.nodes[0];
    expect(node.type).toBe("llm-prompt");
    expect(node.config.model).toBe("gpt-4o-mini");
    expect(node.config.prompt).toContain("user: Hi there");
    expect(report.credentialsNeeded).toContain("openai");
  });

  it("maps the LangChain openAi package under the same key", () => {
    const { workflow } = importOne("@n8n/n8n-nodes-langchain.openAi", {
      messages: "Summarize the meeting notes",
      model: "gpt-4o",
    });
    expect(workflow.nodes[0].type).toBe("llm-prompt");
    expect(workflow.nodes[0].config.prompt).toBe("Summarize the meeting notes");
  });
});

describe("Postgres mapper", () => {
  it("routes executeQuery → pg-query", () => {
    const { workflow, report } = importOne("n8n-nodes-base.postgres", {
      operation: "executeQuery",
      query: "SELECT * FROM users WHERE id = $1",
      queryParams: [42],
    });
    const node = workflow.nodes[0];
    expect(node.type).toBe("pg-query");
    expect(node.config.query).toBe("SELECT * FROM users WHERE id = $1");
    expect(node.config.params).toEqual([42]);
    expect(report.credentialsNeeded).toContain("postgres");
  });

  it("routes insert → pg-insert", () => {
    const { workflow } = importOne("n8n-nodes-base.postgres", {
      operation: "insert",
      table: "events",
      columns: { name: "signup" },
    });
    expect(workflow.nodes[0].type).toBe("pg-insert");
    expect(workflow.nodes[0].config.table).toBe("events");
  });
});

describe("GitHub mapper", () => {
  it("routes issue.create → github-create-issue", () => {
    const { workflow, report } = importOne("n8n-nodes-base.github", {
      resource: "issue",
      operation: "create",
      owner: "acme",
      repository: "things",
      title: "Broken deploy",
      body: "see logs",
      labels: ["bug"],
    });
    const node = workflow.nodes[0];
    expect(node.type).toBe("github-create-issue");
    expect(node.config.owner).toBe("acme");
    expect(node.config.title).toBe("Broken deploy");
    expect(report.credentialsNeeded).toContain("github");
  });

  it("routes repository.create with reuseIfExists idempotency", () => {
    const { workflow } = importOne("n8n-nodes-base.github", {
      resource: "repository",
      operation: "create",
      name: "new-repo",
      private: true,
    });
    expect(workflow.nodes[0].type).toBe("github-create-repo");
    expect(workflow.nodes[0].config.reuseIfExists).toBe(true);
  });
});

describe("Redis mapper", () => {
  it.each([
    ["get", "redis-get"],
    ["set", "redis-set"],
    ["publish", "redis-publish"],
  ])("%s → %s", (op, expected) => {
    const { workflow } = importOne("n8n-nodes-base.redis", {
      operation: op,
      key: "k",
      value: "v",
      channel: "c",
      messageData: "m",
    });
    expect(workflow.nodes[0].type).toBe(expected);
  });
});

describe("S3 mapper", () => {
  it.each([
    ["upload", "s3-put"],
    ["download", "s3-get"],
    ["list", "s3-list"],
    ["delete", "s3-delete"],
  ])("%s → %s", (op, expected) => {
    const { workflow } = importOne("n8n-nodes-base.awsS3", {
      operation: op,
      bucketName: "b",
      fileKey: "k",
    });
    expect(workflow.nodes[0].type).toBe(expected);
  });
});

describe("Credentials extraction", () => {
  it("surfaces services referenced via n8n credentials block", () => {
    const { report } = importN8nWorkflow({
      name: "multi",
      nodes: [
        {
          id: "1",
          name: "Slack",
          type: "n8n-nodes-base.slack",
          parameters: { operation: "postMessage", channel: "#x", text: "hi" },
          credentials: { slackApi: { id: "abc", name: "My Slack" } },
        },
        {
          id: "2",
          name: "HTTP",
          type: "n8n-nodes-base.httpRequest",
          parameters: { url: "https://example.com", method: "GET" },
          credentials: { githubApi: { id: "def", name: "My GitHub" } },
        },
      ],
    });
    expect(report.credentialsNeeded.sort()).toEqual(["github", "slack"]);
    expect(
      report.warnings.some((w) => w.includes("Connect") && w.includes("github") && w.includes("slack")),
    ).toBe(true);
  });
});
