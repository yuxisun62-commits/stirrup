/**
 * Stirrup Plugin: Mailchimp
 * Node types: mailchimp-add-member, mailchimp-update-member,
 *             mailchimp-unsubscribe, mailchimp-get-member,
 *             mailchimp-list-campaigns, mailchimp-send-campaign,
 *             mailchimp-create-campaign
 *
 * Auth: API key (service "mailchimp"). Mailchimp keys encode the data
 * center — `abc123-us14` means the us14 region. We use that suffix to
 * build the per-account hostname. Get a key at
 * admin.mailchimp.com/account/api/.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { createHash } from "node:crypto";

function dcFromKey(apiKey: string): string {
  const dash = apiKey.lastIndexOf("-");
  if (dash === -1) throw new Error('Mailchimp API key must end with "-<dc>" (e.g. "abc123-us14").');
  return apiKey.slice(dash + 1);
}

function headers(apiKey: string): Record<string, string> {
  // Mailchimp uses HTTP Basic auth with any username + the API key as password.
  const creds = Buffer.from(`stirrup:${apiKey}`).toString("base64");
  return {
    Authorization: `Basic ${creds}`,
    "Content-Type": "application/json",
  };
}

async function call<T>(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const dc = dcFromKey(apiKey);
  const url = `https://${dc}.api.mailchimp.com/3.0${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...headers(apiKey), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Mailchimp API ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json() as Promise<T>;
}

/** Mailchimp's member IDs are MD5(lower(email)). */
function memberHash(email: string): string {
  return createHash("md5").update(email.toLowerCase()).digest("hex");
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("mailchimp-add-member", async (config, execCtx) => {
    const { token, listId, email, status, mergeFields, tags, language } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; listId: string; email: string;
      status?: "subscribed" | "unsubscribed" | "cleaned" | "pending" | "transactional";
      mergeFields?: Record<string, unknown>;
      tags?: string[];
      language?: string;
    };
    const data = await call<{ id: string; email_address: string; status: string }>(
      token, `/lists/${listId}/members`,
      {
        method: "POST",
        body: JSON.stringify({
          email_address: email,
          status: status ?? "subscribed",
          merge_fields: mergeFields,
          tags,
          language,
        }),
      },
    );
    return { memberId: data!.id, email: data!.email_address, status: data!.status };
  });

  // Upsert via PUT. Mailchimp uses this pattern a lot because add-member
  // 400s when the address already exists; PUT on the MD5 hash just updates.
  ctx.registerNodeType("mailchimp-update-member", async (config, execCtx) => {
    const { token, listId, email, status, mergeFields, tags } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; listId: string; email: string;
      status?: "subscribed" | "unsubscribed" | "cleaned" | "pending";
      mergeFields?: Record<string, unknown>;
      tags?: string[];
    };
    const hash = memberHash(email);
    const data = await call<{ id: string; email_address: string; status: string }>(
      token, `/lists/${listId}/members/${hash}`,
      {
        method: "PUT",
        body: JSON.stringify({
          email_address: email,
          status_if_new: status ?? "subscribed",
          status,
          merge_fields: mergeFields,
          tags,
        }),
      },
    );
    return { memberId: data!.id, email: data!.email_address, status: data!.status };
  });

  ctx.registerNodeType("mailchimp-unsubscribe", async (config, execCtx) => {
    const { token, listId, email } = { ...execCtx.inputs, ...config } as {
      token: string; listId: string; email: string;
    };
    const hash = memberHash(email);
    await call<void>(
      token, `/lists/${listId}/members/${hash}`,
      { method: "PATCH", body: JSON.stringify({ status: "unsubscribed" }) },
    );
    return { unsubscribed: true, email };
  });

  ctx.registerNodeType("mailchimp-get-member", async (config, execCtx) => {
    const { token, listId, email } = { ...execCtx.inputs, ...config } as {
      token: string; listId: string; email: string;
    };
    const hash = memberHash(email);
    const data = await call<Record<string, unknown>>(
      token, `/lists/${listId}/members/${hash}`,
    );
    return { member: data };
  });

  ctx.registerNodeType("mailchimp-list-campaigns", async (config, execCtx) => {
    const { token, status, count } = { ...execCtx.inputs, ...config } as {
      token: string; status?: "save" | "paused" | "schedule" | "sending" | "sent"; count?: number;
    };
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    params.set("count", String(count ?? 20));
    const data = await call<{ campaigns: Array<Record<string, unknown>> }>(
      token, `/campaigns?${params.toString()}`,
    );
    return { campaigns: data!.campaigns, count: data!.campaigns.length };
  });

  ctx.registerNodeType("mailchimp-create-campaign", async (config, execCtx) => {
    const { token, type, listId, settings } = { ...execCtx.inputs, ...config } as {
      token: string;
      type: "regular" | "plaintext" | "absplit" | "rss" | "variate";
      listId: string;
      settings: { subject_line: string; title?: string; from_name: string; reply_to: string };
    };
    const data = await call<{ id: string; web_id: number; type: string }>(
      token, "/campaigns",
      {
        method: "POST",
        body: JSON.stringify({
          type,
          recipients: { list_id: listId },
          settings,
        }),
      },
    );
    return { campaignId: data!.id, webId: data!.web_id };
  });

  ctx.registerNodeType("mailchimp-send-campaign", async (config, execCtx) => {
    const { token, campaignId } = { ...execCtx.inputs, ...config } as {
      token: string; campaignId: string;
    };
    await call<void>(
      token, `/campaigns/${campaignId}/actions/send`,
      { method: "POST" },
    );
    return { sent: true, campaignId };
  });
}
