import { describe, it, expect } from "vitest";
import { importMakeBlueprint } from "../../src/import/make.js";

function importOne(moduleType: string, mapper: Record<string, unknown>, parameters: Record<string, unknown> = {}) {
  return importMakeBlueprint({
    name: "blueprint",
    flow: [{ id: 1, module: moduleType, mapper, parameters }],
  });
}

describe("Make service mappings", () => {
  it("slack:CreateMessage → slack-send", () => {
    const { workflow, report } = importOne("slack:CreateMessage", {
      channel: "#deploys",
      text: "Hello from Make",
    });
    expect(workflow.nodes[0].type).toBe("slack-send");
    expect(workflow.nodes[0].config.channel).toBe("#deploys");
    expect(report.credentialsNeeded).toContain("slack");
  });

  it("gmail:ActionSendEmail → gmail-send with html detection", () => {
    const { workflow, report } = importOne("gmail:ActionSendEmail", {
      to: "u@x.com",
      subject: "hi",
      html: "<p>hi</p>",
      type: "html",
    });
    expect(workflow.nodes[0].type).toBe("gmail-send");
    expect(workflow.nodes[0].config.html).toBe(true);
    expect(report.credentialsNeeded).toContain("gmail");
  });

  it("airtable:ActionCreateRecord → airtable-create", () => {
    const { workflow, report } = importOne("airtable:ActionCreateRecord", {
      base: "appABC",
      table: "Users",
      record: { Name: "Alice" },
    });
    expect(workflow.nodes[0].type).toBe("airtable-create");
    expect(workflow.nodes[0].config.baseId).toBe("appABC");
    expect(report.credentialsNeeded).toContain("airtable");
  });

  it("notion:createPage → notion-create-page", () => {
    const { workflow, report } = importOne("notion:createPage", {
      databaseId: "db-1",
      title: "Ticket",
    });
    expect(workflow.nodes[0].type).toBe("notion-create-page");
    expect(workflow.nodes[0].config.parentDatabaseId).toBe("db-1");
    expect(report.credentialsNeeded).toContain("notion");
  });

  it("openai:CreateChatCompletion → llm-prompt with joined messages", () => {
    const { workflow, report } = importOne("openai:CreateChatCompletion", {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Summarize." },
      ],
    });
    expect(workflow.nodes[0].type).toBe("llm-prompt");
    expect(workflow.nodes[0].config.model).toBe("gpt-4o-mini");
    expect(workflow.nodes[0].config.prompt).toContain("system: Be brief.");
    expect(workflow.nodes[0].config.prompt).toContain("user: Summarize.");
    expect(report.credentialsNeeded).toContain("openai");
  });

  it("stripe:createCharge → stripe-create-charge", () => {
    const { workflow, report } = importOne("stripe:createCharge", {
      amount: 2500,
      currency: "usd",
      customer: "cus_abc",
    });
    expect(workflow.nodes[0].type).toBe("stripe-create-charge");
    expect(report.credentialsNeeded).toContain("stripe");
  });

  it("telegram-bot:sendTextMessage → telegram-send", () => {
    const { workflow, report } = importOne("telegram-bot:sendTextMessage", {
      chatId: "@me",
      text: "hi",
    });
    expect(workflow.nodes[0].type).toBe("telegram-send");
    expect(report.credentialsNeeded).toContain("telegram");
  });
});

describe("Make filter translation", () => {
  it("builtin:BasicFilter compiles real conditions + flag", () => {
    const { workflow } = importMakeBlueprint({
      name: "filt",
      flow: [
        { id: 1, module: "util:SetVariables", mapper: {}, parameters: {} },
        {
          id: 2,
          module: "builtin:BasicFilter",
          filter: {
            conditions: [[{ a: "{{1.amount}}", o: "number:greater", b: 100 }]],
          },
          mapper: {},
          parameters: {},
        },
      ],
    });
    const filterNode = workflow.nodes.find((n) => n.type === "condition")!;
    expect(filterNode).toBeDefined();
    expect((filterNode.config as Record<string, unknown>)._makeCondition).toBe(true);
    // Module 1 is referenced — input mapping gets emitted
    expect(filterNode.inputs.some((i) => i.to === "__makeModule_1")).toBe(true);
  });

  it("builtin:BasicRouter compiles each route's filter", () => {
    const { workflow } = importMakeBlueprint({
      name: "rt",
      flow: [
        { id: 1, module: "util:SetVariables", mapper: {}, parameters: {} },
        {
          id: 2,
          module: "builtin:BasicRouter",
          mapper: {},
          parameters: {},
          routes: [
            {
              flow: [{ id: 3, module: "util:NoOp", mapper: {}, parameters: {} } as any],
              parameters: {} as any,
              filter: {
                conditions: [[{ a: "{{1.status}}", o: "text:equal", b: "ok" }]],
              } as any,
            },
            {
              flow: [{ id: 4, module: "util:NoOp", mapper: {}, parameters: {} } as any],
              parameters: {} as any,
            },
          ],
        },
      ],
    });
    const router = workflow.nodes.find((n) => n.type === "condition" && (n.config as any).metadata?.kind === "router");
    expect(router).toBeDefined();
    expect((router!.config as Record<string, unknown>)._makeCondition).toBe(true);
    // Routes produce branch names; both route0 and route1 should exist
    expect(Object.keys(router!.branches ?? {})).toEqual(expect.arrayContaining(["route0", "route1", "fallback"]));
  });
});

describe("Make trigger extraction", () => {
  it("gateway:CustomWebHook → workflow.triggers.http", () => {
    const { workflow } = importMakeBlueprint({
      name: "hook",
      flow: [
        {
          id: 1,
          module: "gateway:CustomWebHook",
          mapper: {},
          parameters: { hook: { name: "incoming" } },
        },
      ],
    });
    expect(workflow.triggers?.http).toBeDefined();
    expect(workflow.triggers!.http!.path).toBe("/incoming");
  });
});
