/**
 * Stirrup Plugin: Linear
 * Node types: linear-create-issue, linear-update-issue, linear-search,
 *             linear-get-issue, linear-create-comment
 *
 * Auth: Personal API key (service: "linear"). Create at
 * linear.app/settings/api. Linear's API is GraphQL-only, which is why
 * the queries below are hand-written rather than routed through a REST
 * wrapper.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../../src/plugins/safeFetch.js";

const API = "https://api.linear.app/graphql";

function headers(token: string): Record<string, string> {
  // Linear accepts both raw key and Bearer format — bare key is slightly
  // more robust to their auth changes over time.
  return { Authorization: token, "Content-Type": "application/json" };
}

async function gql<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await safeFetch(API, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ query, variables }),
  });
  const data = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (data.errors?.length) {
    throw new Error(`Linear GraphQL error: ${data.errors.map((e) => e.message).join("; ")}`);
  }
  if (!data.data) throw new Error(`Linear API returned no data (HTTP ${res.status})`);
  return data.data;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("linear-create-issue", async (config, execCtx) => {
    const { token, teamId, title, description, priority, stateId, assigneeId, labels, projectId } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; teamId: string; title: string;
      description?: string; priority?: number; stateId?: string;
      assigneeId?: string; labels?: string[]; projectId?: string;
    };
    const mutation = `
      mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier url title state { name } }
        }
      }
    `;
    const data = await gql<{
      issueCreate: {
        success: boolean;
        issue: { id: string; identifier: string; url: string; title: string; state: { name: string } };
      };
    }>(token, mutation, {
      input: {
        teamId, title,
        description,
        priority,
        stateId,
        assigneeId,
        labelIds: labels,
        projectId,
      },
    });
    return { issue: data.issueCreate.issue, success: data.issueCreate.success };
  });

  ctx.registerNodeType("linear-update-issue", async (config, execCtx) => {
    const { token, issueId, title, description, stateId, priority, assigneeId } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; issueId: string;
      title?: string; description?: string;
      stateId?: string; priority?: number; assigneeId?: string;
    };
    const mutation = `
      mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue { id identifier title state { name } }
        }
      }
    `;
    const data = await gql<{
      issueUpdate: { success: boolean; issue: Record<string, unknown> };
    }>(token, mutation, {
      id: issueId,
      input: { title, description, stateId, priority, assigneeId },
    });
    return { issue: data.issueUpdate.issue, success: data.issueUpdate.success };
  });

  ctx.registerNodeType("linear-search", async (config, execCtx) => {
    const { token, query, first } = { ...execCtx.inputs, ...config } as {
      token: string; query: string; first?: number;
    };
    const q = `
      query SearchIssues($term: String!, $first: Int) {
        issueSearch(term: $term, first: $first) {
          nodes {
            id identifier title url
            state { name } priority
            team { key } assignee { name }
          }
        }
      }
    `;
    const data = await gql<{ issueSearch: { nodes: Array<Record<string, unknown>> } }>(
      token,
      q,
      { term: query, first: first ?? 20 },
    );
    return { issues: data.issueSearch.nodes, count: data.issueSearch.nodes.length };
  });

  ctx.registerNodeType("linear-get-issue", async (config, execCtx) => {
    const { token, issueId } = { ...execCtx.inputs, ...config } as {
      token: string; issueId: string;
    };
    const q = `
      query Issue($id: String!) {
        issue(id: $id) {
          id identifier title description url
          state { name type }
          priority priorityLabel
          assignee { name email }
          creator { name }
          team { key name }
          labels { nodes { name } }
          createdAt updatedAt
        }
      }
    `;
    const data = await gql<{ issue: Record<string, unknown> }>(token, q, { id: issueId });
    return { issue: data.issue };
  });

  ctx.registerNodeType("linear-create-comment", async (config, execCtx) => {
    const { token, issueId, body } = { ...execCtx.inputs, ...config } as {
      token: string; issueId: string; body: string;
    };
    const mutation = `
      mutation CommentCreate($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment { id url }
        }
      }
    `;
    const data = await gql<{
      commentCreate: { success: boolean; comment: { id: string; url: string } };
    }>(token, mutation, { input: { issueId, body } });
    return { comment: data.commentCreate.comment, success: data.commentCreate.success };
  });
}
