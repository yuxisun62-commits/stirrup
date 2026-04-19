import { describe, it, expect } from "vitest";
import { importN8nWorkflow } from "../../src/import/n8n.js";

function importOne(nodeType: string, parameters: Record<string, unknown>) {
  return importN8nWorkflow({
    name: "single",
    nodes: [{ id: "1", name: "Node", type: nodeType, parameters }],
  });
}

describe("Google Sheets mapper", () => {
  it.each([
    ["read", "sheets-read"],
    ["append", "sheets-append"],
    ["update", "sheets-update"],
    ["clear", "sheets-clear"],
  ])("%s → %s", (op, expected) => {
    const { workflow, report } = importOne("n8n-nodes-base.googleSheets", {
      operation: op,
      documentId: { value: "abc123" },
      sheetName: { value: "Sheet1" },
      values: [[1, 2, 3]],
    });
    expect(workflow.nodes[0].type).toBe(expected);
    expect(workflow.nodes[0].config.spreadsheetId).toBe("abc123");
    expect(report.credentialsNeeded).toContain("google-sheets");
  });

  it("builds A1 range from sheetName when range unspecified", () => {
    const { workflow } = importOne("n8n-nodes-base.googleSheets", {
      operation: "read",
      documentId: { value: "abc" },
      sheetName: "Sheet2",
    });
    expect(workflow.nodes[0].config.range).toBe("Sheet2!A:Z");
  });
});

describe("Notion mapper", () => {
  it("page.create with database parent", () => {
    const { workflow, report } = importOne("n8n-nodes-base.notion", {
      resource: "page",
      operation: "create",
      parentType: "database",
      databaseId: "db-1",
      title: "New thing",
    });
    expect(workflow.nodes[0].type).toBe("notion-create-page");
    expect(workflow.nodes[0].config.parentDatabaseId).toBe("db-1");
    expect(workflow.nodes[0].config.parentPageId).toBeUndefined();
    expect(report.credentialsNeeded).toContain("notion");
  });

  it("databasepage resource → query-database", () => {
    const { workflow } = importOne("n8n-nodes-base.notion", {
      resource: "databasepage",
      operation: "getall",
      databaseId: "db-1",
      limit: 50,
    });
    expect(workflow.nodes[0].type).toBe("notion-query-database");
    expect(workflow.nodes[0].config.pageSize).toBe(50);
  });
});

describe("Airtable mapper", () => {
  it.each([
    ["list", "airtable-list"],
    ["create", "airtable-create"],
    ["update", "airtable-update"],
    ["delete", "airtable-delete"],
    ["upsert", "airtable-upsert"],
  ])("%s → %s", (op, expected) => {
    const { workflow, report } = importOne("n8n-nodes-base.airtable", {
      operation: op,
      application: { value: "app1" },
      table: { value: "tbl1" },
      id: "rec1",
      fields: { Name: "Test" },
      records: [{ Name: "A" }],
      fieldsToMergeOn: ["Name"],
    });
    expect(workflow.nodes[0].type).toBe(expected);
    expect(workflow.nodes[0].config.baseId).toBe("app1");
    expect(report.credentialsNeeded).toContain("airtable");
  });
});

describe("Linear mapper", () => {
  it("issue.create → linear-create-issue", () => {
    const { workflow, report } = importOne("n8n-nodes-base.linear", {
      resource: "issue",
      operation: "create",
      teamId: "TEAM",
      title: "Bug: thing broken",
      additionalFields: { priority: 2, description: "details" },
    });
    const node = workflow.nodes[0];
    expect(node.type).toBe("linear-create-issue");
    expect(node.config.teamId).toBe("TEAM");
    expect(node.config.priority).toBe(2);
    expect(report.credentialsNeeded).toContain("linear");
  });

  it("issue.search → linear-search", () => {
    const { workflow } = importOne("n8n-nodes-base.linear", {
      resource: "issue",
      operation: "search",
      searchQuery: "login bug",
      limit: 10,
    });
    expect(workflow.nodes[0].type).toBe("linear-search");
    expect(workflow.nodes[0].config.query).toBe("login bug");
  });
});

describe("Jira mapper", () => {
  it("issue.create → jira-create-issue", () => {
    const { workflow, report } = importOne("n8n-nodes-base.jira", {
      resource: "issue",
      operation: "create",
      baseUrl: "https://acme.atlassian.net",
      project: { value: "ABC" },
      issueType: { value: "Bug" },
      summary: "Broken thing",
      additionalFields: { description: "details", labels: ["bug"] },
    });
    const node = workflow.nodes[0];
    expect(node.type).toBe("jira-create-issue");
    expect(node.config.projectKey).toBe("ABC");
    expect(node.config.issueType).toBe("Bug");
    expect(report.credentialsNeeded).toContain("jira");
  });

  it("issue.search → jira-search with JQL", () => {
    const { workflow } = importOne("n8n-nodes-base.jira", {
      resource: "issue",
      operation: "search",
      baseUrl: "https://acme.atlassian.net",
      jql: "project = ABC AND status = Open",
      limit: 25,
    });
    expect(workflow.nodes[0].type).toBe("jira-search");
    expect(workflow.nodes[0].config.jql).toBe("project = ABC AND status = Open");
    expect(workflow.nodes[0].config.maxResults).toBe(25);
  });

  it("alias jiraSoftwareCloud uses the same mapper", () => {
    const { workflow } = importOne("n8n-nodes-base.jiraSoftwareCloud", {
      resource: "issue",
      operation: "create",
      project: { value: "P" },
      issueType: { value: "Task" },
      summary: "hi",
    });
    expect(workflow.nodes[0].type).toBe("jira-create-issue");
  });
});
