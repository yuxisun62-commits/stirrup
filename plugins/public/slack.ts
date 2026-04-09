/**
 * Stirrup Plugin: Slack
 * Node types: slack-send, slack-send-blocks, slack-upload-file
 * Tools: slack-post-message, slack-list-channels
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";

export default function register(ctx: PluginContext) {
  const slackApi = async (method: string, token: string, body: Record<string, unknown>) => {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
    return data;
  };

  ctx.registerNodeType("slack-send", async (config, execCtx) => {
    const { token, channel, text, threadTs } = { ...execCtx.inputs, ...config } as {
      token: string; channel: string; text: string; threadTs?: string;
    };
    const body: Record<string, unknown> = { channel, text };
    if (threadTs) body.thread_ts = threadTs;
    const data = await slackApi("chat.postMessage", token, body);
    return { messageTs: data.ts, channel: data.channel };
  });

  ctx.registerNodeType("slack-send-blocks", async (config, execCtx) => {
    const { token, channel, blocks, text } = { ...execCtx.inputs, ...config } as {
      token: string; channel: string; blocks: unknown[]; text?: string;
    };
    const data = await slackApi("chat.postMessage", token, {
      channel,
      blocks,
      text: text ?? "Message from Stirrup workflow",
    });
    return { messageTs: data.ts, channel: data.channel };
  });

  ctx.registerNodeType("slack-upload-file", async (config, execCtx) => {
    const { token, channels, content, filename, title } = { ...execCtx.inputs, ...config } as {
      token: string; channels: string; content: string; filename: string; title?: string;
    };
    const data = await slackApi("files.upload", token, {
      channels, content, filename, title: title ?? filename,
    });
    return { fileId: (data.file as any)?.id, url: (data.file as any)?.permalink };
  });

  ctx.registerTool({
    name: "slack-post-message",
    description: "Post a message to a Slack channel",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel name or ID" },
        text: { type: "string", description: "Message text" },
      },
      required: ["channel", "text"],
    },
    handler: async (input) => {
      const token = process.env.SLACK_BOT_TOKEN;
      if (!token) throw new Error("SLACK_BOT_TOKEN not set");
      return slackApi("chat.postMessage", token, { channel: input.channel, text: input.text });
    },
  });

  ctx.registerTool({
    name: "slack-list-channels",
    description: "List Slack channels",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
    handler: async (input) => {
      const token = process.env.SLACK_BOT_TOKEN;
      if (!token) throw new Error("SLACK_BOT_TOKEN not set");
      const data = await slackApi("conversations.list", token, { limit: input.limit ?? 20 });
      return { channels: (data.channels as any[])?.map((c: any) => ({ id: c.id, name: c.name })) };
    },
  });
}
