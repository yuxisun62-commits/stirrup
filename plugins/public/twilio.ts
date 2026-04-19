/**
 * Stirrup Plugin: Twilio
 * Node types: twilio-sms, twilio-whatsapp, twilio-call, twilio-verify
 * Tools: twilio-sms
 *
 * Auth: Basic auth with Account SID (username) and Auth Token (password).
 * Stored under service "twilio" as "<accountSid>:<authToken>". The handler
 * splits that combined string back out before making requests.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";

function authHeader(credentials: string): Record<string, string> {
  // credentials format: "<sid>:<token>"
  return { Authorization: `Basic ${Buffer.from(credentials).toString("base64")}` };
}

function accountSidFromCredentials(creds: string): string {
  return creds.split(":")[0];
}

async function callMessages(
  credentials: string,
  payload: Record<string, string | undefined>,
): Promise<Record<string, unknown>> {
  const sid = accountSidFromCredentials(credentials);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined) body.set(k, String(v));
  }
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        ...authHeader(credentials),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
  );
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(`Twilio API ${res.status}: ${data.message ?? JSON.stringify(data)}`);
  return data;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("twilio-sms", async (config, execCtx) => {
    const { token, from, to, body, mediaUrl } = { ...execCtx.inputs, ...config } as {
      token: string; from: string; to: string; body: string; mediaUrl?: string;
    };
    const data = await callMessages(token, {
      From: from, To: to, Body: body, MediaUrl: mediaUrl,
    });
    return {
      sid: data.sid,
      status: data.status,
      dateCreated: data.date_created,
      numSegments: data.num_segments,
    };
  });

  // WhatsApp uses the same Messages resource but From/To are prefixed
  // with "whatsapp:". Twilio sandbox requires the recipient to have
  // joined the sandbox first; production requires an approved sender.
  ctx.registerNodeType("twilio-whatsapp", async (config, execCtx) => {
    const { token, from, to, body } = { ...execCtx.inputs, ...config } as {
      token: string; from: string; to: string; body: string;
    };
    const normFrom = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;
    const normTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
    const data = await callMessages(token, { From: normFrom, To: normTo, Body: body });
    return { sid: data.sid, status: data.status };
  });

  ctx.registerNodeType("twilio-call", async (config, execCtx) => {
    const { token, from, to, url, twiml, timeout } = { ...execCtx.inputs, ...config } as {
      token: string; from: string; to: string;
      url?: string; twiml?: string; timeout?: number;
    };
    if (!url && !twiml) throw new Error("twilio-call requires url (TwiML URL) or twiml (inline)");
    const sid = accountSidFromCredentials(token);
    const body = new URLSearchParams();
    body.set("From", from);
    body.set("To", to);
    if (url) body.set("Url", url);
    if (twiml) body.set("Twiml", twiml);
    if (timeout) body.set("Timeout", String(timeout));
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
      method: "POST",
      headers: {
        ...authHeader(token),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(`Twilio call ${res.status}: ${data.message ?? JSON.stringify(data)}`);
    return { sid: data.sid, status: data.status };
  });

  // Twilio Verify — send a verification code via SMS/call. Useful for
  // 2FA flows. Requires a Verify Service SID (separate from Account SID).
  ctx.registerNodeType("twilio-verify", async (config, execCtx) => {
    const { token, serviceSid, to, channel } = { ...execCtx.inputs, ...config } as {
      token: string; serviceSid: string; to: string; channel?: "sms" | "call" | "email";
    };
    const body = new URLSearchParams({ To: to, Channel: channel ?? "sms" });
    const res = await fetch(
      `https://verify.twilio.com/v2/Services/${serviceSid}/Verifications`,
      {
        method: "POST",
        headers: {
          ...authHeader(token),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      },
    );
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(`Twilio verify ${res.status}: ${data.message ?? JSON.stringify(data)}`);
    return { sid: data.sid, status: data.status };
  });

  ctx.registerTool({
    name: "twilio-sms",
    description: "Send an SMS via Twilio",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Twilio phone number (E.164)" },
        to: { type: "string", description: "Recipient phone number (E.164)" },
        body: { type: "string", description: "SMS body, up to 1600 chars" },
      },
      required: ["from", "to", "body"],
    },
    handler: async (input) => {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      if (!sid || !authToken) throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set");
      const credentials = `${sid}:${authToken}`;
      const { from, to, body } = input as { from: string; to: string; body: string };
      const data = await callMessages(credentials, { From: from, To: to, Body: body });
      return { sid: data.sid };
    },
  });
}
