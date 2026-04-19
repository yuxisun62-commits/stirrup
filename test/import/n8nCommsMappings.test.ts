import { describe, it, expect } from "vitest";
import { importN8nWorkflow } from "../../src/import/n8n.js";

function importOne(nodeType: string, parameters: Record<string, unknown>, credentials?: Record<string, unknown>) {
  return importN8nWorkflow({
    name: "single",
    nodes: [{ id: "1", name: "Node", type: nodeType, parameters, credentials }],
  });
}

describe("Gmail mapper", () => {
  it("send → gmail-send with body and html flag", () => {
    const { workflow, report } = importOne("n8n-nodes-base.gmail", {
      operation: "send",
      toEmail: "a@b.com",
      subject: "hi",
      htmlBody: "<p>hi</p>",
      emailType: "html",
    });
    const node = workflow.nodes[0];
    expect(node.type).toBe("gmail-send");
    expect(node.config.to).toBe("a@b.com");
    expect(node.config.html).toBe(true);
    expect(report.credentialsNeeded).toContain("gmail");
  });

  it("list/getAll → gmail-list-messages", () => {
    const { workflow } = importOne("n8n-nodes-base.gmail", {
      operation: "getAll",
      q: "is:unread",
      limit: 20,
    });
    expect(workflow.nodes[0].type).toBe("gmail-list-messages");
    expect(workflow.nodes[0].config.query).toBe("is:unread");
    expect(workflow.nodes[0].config.maxResults).toBe(20);
  });
});

describe("Discord mapper", () => {
  it("webhook auth → webhook-send (URL-only post)", () => {
    const { workflow } = importOne("n8n-nodes-base.discord", {
      authentication: "webhook",
      webhookUri: "https://discord.com/api/webhooks/abc/def",
      text: "Hello",
    });
    expect(workflow.nodes[0].type).toBe("webhook-send");
  });

  it("bot auth → discord-send (real bot call)", () => {
    const { workflow, report } = importOne("n8n-nodes-base.discord", {
      authentication: "oAuth2Api",
      operation: "sendMessage",
      channelId: "123456",
      content: "Hi there",
    });
    expect(workflow.nodes[0].type).toBe("discord-send");
    expect(workflow.nodes[0].config.channelId).toBe("123456");
    expect(report.credentialsNeeded).toContain("discord");
  });
});

describe("Telegram mapper", () => {
  it("sendMessage → telegram-send", () => {
    const { workflow, report } = importOne("n8n-nodes-base.telegram", {
      operation: "sendMessage",
      chatId: "@mychannel",
      text: "Hi",
      additionalFields: { parse_mode: "Markdown" },
    });
    expect(workflow.nodes[0].type).toBe("telegram-send");
    expect(workflow.nodes[0].config.parseMode).toBe("Markdown");
    expect(report.credentialsNeeded).toContain("telegram");
  });

  it("sendPhoto → telegram-send-photo", () => {
    const { workflow } = importOne("n8n-nodes-base.telegram", {
      operation: "sendPhoto",
      chatId: "123",
      photo: "https://example.com/cat.png",
      additionalFields: { caption: "meow" },
    });
    expect(workflow.nodes[0].type).toBe("telegram-send-photo");
    expect(workflow.nodes[0].config.caption).toBe("meow");
  });
});

describe("SendGrid mapper", () => {
  it("send → sendgrid-send with from/to/subject", () => {
    const { workflow, report } = importOne("n8n-nodes-base.sendGrid", {
      operation: "send",
      fromEmail: "noreply@example.com",
      toEmail: "user@example.com",
      subject: "Welcome",
      contentValue: "Welcome to the app",
    });
    expect(workflow.nodes[0].type).toBe("sendgrid-send");
    expect(workflow.nodes[0].config.text).toBe("Welcome to the app");
    expect(report.credentialsNeeded).toContain("sendgrid");
  });
});

describe("Twilio mapper", () => {
  it("SMS send → twilio-sms", () => {
    const { workflow, report } = importOne("n8n-nodes-base.twilio", {
      operation: "send",
      from: "+15550001111",
      to: "+15550002222",
      message: "Your code is 123",
    });
    expect(workflow.nodes[0].type).toBe("twilio-sms");
    expect(workflow.nodes[0].config.from).toBe("+15550001111");
    expect(report.credentialsNeeded).toContain("twilio");
  });

  it("WhatsApp flag → twilio-whatsapp", () => {
    const { workflow } = importOne("n8n-nodes-base.twilio", {
      operation: "send",
      from: "+14155238886",
      to: "+15550002222",
      message: "Hello",
      toWhatsapp: true,
    });
    expect(workflow.nodes[0].type).toBe("twilio-whatsapp");
  });
});
