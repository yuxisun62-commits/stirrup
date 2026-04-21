/**
 * Stirrup Plugin: Jira (Cloud)
 * Node types: jira-create-issue, jira-update-issue, jira-get-issue,
 *             jira-search, jira-add-comment, jira-transition
 *
 * Auth: Atlassian Cloud API token (service: "jira"), stored as
 * "<email>:<apiToken>". We send Basic auth to
 * https://<site>.atlassian.net/rest/api/3/*. The Jira site URL is
 * per-node `baseUrl` config because token alone doesn't identify the site.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../safeFetch.js";

function authHeaders(credentials: string): Record<string, string> {
  // credentials format: "<email>:<apiToken>"
  return {
    Authorization: `Basic ${Buffer.from(credentials).toString("base64")}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function call<T>(
  baseUrl: string,
  credentials: string,
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const url = `${baseUrl.replace(/\/$/, "")}/rest/api/3${path}`;
  const res = await safeFetch(url, {
    ...init,
    headers: { ...authHeaders(credentials), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Jira API ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json() as Promise<T>;
}

/**
 * Jira uses ADF (Atlassian Document Format) for rich text fields like
 * description and comments. We provide a trivial helper that wraps a
 * plain string in the minimum ADF wrapper Jira will accept. Users with
 * richer needs pass their own ADF object.
 */
function plainToAdf(text: string): Record<string, unknown> {
  return {
    type: "doc", version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("jira-create-issue", async (config, execCtx) => {
    const { token, baseUrl, projectKey, issueType, summary, description, labels, assigneeAccountId, priority } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; baseUrl: string; projectKey: string; issueType: string;
      summary: string; description?: string | Record<string, unknown>;
      labels?: string[]; assigneeAccountId?: string; priority?: string;
    };

    const body: Record<string, unknown> = {
      fields: {
        project: { key: projectKey },
        issuetype: { name: issueType },
        summary,
        ...(description
          ? { description: typeof description === "string" ? plainToAdf(description) : description }
          : {}),
        ...(labels ? { labels } : {}),
        ...(assigneeAccountId ? { assignee: { accountId: assigneeAccountId } } : {}),
        ...(priority ? { priority: { name: priority } } : {}),
      },
    };

    const data = await call<{ id: string; key: string; self: string }>(
      baseUrl, token, "/issue", { method: "POST", body: JSON.stringify(body) },
    );
    return { issueId: data!.id, key: data!.key, url: data!.self };
  });

  ctx.registerNodeType("jira-update-issue", async (config, execCtx) => {
    const { token, baseUrl, issueKey, fields } = { ...execCtx.inputs, ...config } as {
      token: string; baseUrl: string; issueKey: string; fields: Record<string, unknown>;
    };
    await call<void>(
      baseUrl, token,
      `/issue/${encodeURIComponent(issueKey)}`,
      { method: "PUT", body: JSON.stringify({ fields }) },
    );
    return { issueKey, updated: true };
  });

  ctx.registerNodeType("jira-get-issue", async (config, execCtx) => {
    const { token, baseUrl, issueKey, fields } = { ...execCtx.inputs, ...config } as {
      token: string; baseUrl: string; issueKey: string; fields?: string[];
    };
    const params = fields ? `?fields=${fields.join(",")}` : "";
    const issue = await call<Record<string, unknown>>(
      baseUrl, token,
      `/issue/${encodeURIComponent(issueKey)}${params}`,
    );
    return { issue };
  });

  ctx.registerNodeType("jira-search", async (config, execCtx) => {
    const { token, baseUrl, jql, fields, maxResults, startAt } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; baseUrl: string; jql: string;
      fields?: string[]; maxResults?: number; startAt?: number;
    };
    const data = await call<{ issues: Array<Record<string, unknown>>; total: number; startAt: number }>(
      baseUrl, token, "/search",
      {
        method: "POST",
        body: JSON.stringify({
          jql, fields: fields ?? ["summary", "status", "assignee"],
          maxResults: maxResults ?? 50, startAt: startAt ?? 0,
        }),
      },
    );
    return { issues: data!.issues, total: data!.total, startAt: data!.startAt };
  });

  ctx.registerNodeType("jira-add-comment", async (config, execCtx) => {
    const { token, baseUrl, issueKey, body } = { ...execCtx.inputs, ...config } as {
      token: string; baseUrl: string; issueKey: string; body: string | Record<string, unknown>;
    };
    const data = await call<{ id: string; created: string }>(
      baseUrl, token,
      `/issue/${encodeURIComponent(issueKey)}/comment`,
      {
        method: "POST",
        body: JSON.stringify({
          body: typeof body === "string" ? plainToAdf(body) : body,
        }),
      },
    );
    return { commentId: data!.id, created: data!.created };
  });

  // Move an issue through the workflow — the transition ID can be found by
  // GETing `/issue/{key}/transitions` in advance. Jira workflows differ
  // per-project so we don't hardcode status names.
  ctx.registerNodeType("jira-transition", async (config, execCtx) => {
    const { token, baseUrl, issueKey, transitionId, comment } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; baseUrl: string; issueKey: string;
      transitionId: string; comment?: string;
    };
    const body: Record<string, unknown> = { transition: { id: transitionId } };
    if (comment) body.update = { comment: [{ add: { body: plainToAdf(comment) } }] };
    await call<void>(
      baseUrl, token,
      `/issue/${encodeURIComponent(issueKey)}/transitions`,
      { method: "POST", body: JSON.stringify(body) },
    );
    return { issueKey, transitioned: true };
  });
}
