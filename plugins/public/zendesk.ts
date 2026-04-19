/**
 * Stirrup Plugin: Zendesk Support
 * Node types: zendesk-create-ticket, zendesk-update-ticket,
 *             zendesk-get-ticket, zendesk-search-tickets,
 *             zendesk-add-comment, zendesk-list-users
 *
 * Auth: API token under service "zendesk", stored as
 * "<subdomain>|<email>|<api-token>" — Zendesk requires all three:
 * the subdomain identifies the instance, email identifies the user,
 * and the token authorizes. Basic auth sends `email/token:token`.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";

interface ZendeskAuth {
  subdomain: string;
  email: string;
  token: string;
}

function parseAuth(tokenValue: string): ZendeskAuth {
  const parts = tokenValue.split("|");
  if (parts.length !== 3) {
    throw new Error(
      'Zendesk token must be "<subdomain>|<email>|<api-token>". Paste it that way in Connections.',
    );
  }
  return { subdomain: parts[0], email: parts[1], token: parts[2] };
}

function authHeader(auth: ZendeskAuth): Record<string, string> {
  const creds = Buffer.from(`${auth.email}/token:${auth.token}`).toString("base64");
  return { Authorization: `Basic ${creds}`, "Content-Type": "application/json" };
}

async function call<T>(
  auth: ZendeskAuth,
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const url = `https://${auth.subdomain}.zendesk.com/api/v2${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeader(auth), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Zendesk API ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json() as Promise<T>;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("zendesk-create-ticket", async (config, execCtx) => {
    const { token, subject, comment, requesterEmail, requesterName, priority, type, tags, assigneeId } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; subject: string;
      comment: { body: string; public?: boolean };
      requesterEmail?: string; requesterName?: string;
      priority?: "low" | "normal" | "high" | "urgent";
      type?: "problem" | "incident" | "question" | "task";
      tags?: string[]; assigneeId?: number;
    };
    const auth = parseAuth(token);
    const data = await call<{ ticket: { id: number; url: string; status: string } }>(
      auth, "/tickets.json",
      {
        method: "POST",
        body: JSON.stringify({
          ticket: {
            subject,
            comment,
            requester: requesterEmail
              ? { email: requesterEmail, name: requesterName }
              : undefined,
            priority, type, tags,
            assignee_id: assigneeId,
          },
        }),
      },
    );
    return { ticketId: data!.ticket.id, url: data!.ticket.url, status: data!.ticket.status };
  });

  ctx.registerNodeType("zendesk-update-ticket", async (config, execCtx) => {
    const { token, ticketId, fields, newComment } = { ...execCtx.inputs, ...config } as {
      token: string; ticketId: number;
      fields?: Record<string, unknown>;
      newComment?: { body: string; public?: boolean };
    };
    const auth = parseAuth(token);
    const ticketUpdate: Record<string, unknown> = { ...(fields ?? {}) };
    if (newComment) ticketUpdate.comment = newComment;
    const data = await call<{ ticket: Record<string, unknown> }>(
      auth, `/tickets/${ticketId}.json`,
      { method: "PUT", body: JSON.stringify({ ticket: ticketUpdate }) },
    );
    return { ticket: data!.ticket };
  });

  ctx.registerNodeType("zendesk-get-ticket", async (config, execCtx) => {
    const { token, ticketId } = { ...execCtx.inputs, ...config } as {
      token: string; ticketId: number;
    };
    const data = await call<{ ticket: Record<string, unknown> }>(
      parseAuth(token), `/tickets/${ticketId}.json`,
    );
    return { ticket: data!.ticket };
  });

  ctx.registerNodeType("zendesk-search-tickets", async (config, execCtx) => {
    const { token, query, sortBy, sortOrder } = { ...execCtx.inputs, ...config } as {
      token: string; query: string; sortBy?: string; sortOrder?: "asc" | "desc";
    };
    const params = new URLSearchParams({ query: `type:ticket ${query}` });
    if (sortBy) params.set("sort_by", sortBy);
    if (sortOrder) params.set("sort_order", sortOrder);
    const data = await call<{ results: Array<Record<string, unknown>>; count: number }>(
      parseAuth(token), `/search.json?${params.toString()}`,
    );
    return { tickets: data!.results, count: data!.count };
  });

  ctx.registerNodeType("zendesk-add-comment", async (config, execCtx) => {
    const { token, ticketId, body, public: isPublic, authorId } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; ticketId: number; body: string;
      public?: boolean; authorId?: number;
    };
    const data = await call<{ ticket: Record<string, unknown> }>(
      parseAuth(token), `/tickets/${ticketId}.json`,
      {
        method: "PUT",
        body: JSON.stringify({
          ticket: {
            comment: { body, public: isPublic ?? true, author_id: authorId },
          },
        }),
      },
    );
    return { ticket: data!.ticket, added: true };
  });

  ctx.registerNodeType("zendesk-list-users", async (config, execCtx) => {
    const { token, role, perPage } = { ...execCtx.inputs, ...config } as {
      token: string; role?: "end-user" | "agent" | "admin"; perPage?: number;
    };
    const params = new URLSearchParams();
    if (role) params.set("role", role);
    params.set("per_page", String(perPage ?? 100));
    const data = await call<{ users: Array<Record<string, unknown>>; count: number }>(
      parseAuth(token), `/users.json?${params.toString()}`,
    );
    return { users: data!.users, count: data!.count };
  });
}
