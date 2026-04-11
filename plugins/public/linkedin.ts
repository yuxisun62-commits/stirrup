/**
 * Stirrup Plugin: LinkedIn (linkedin.com)
 *
 * Direct LinkedIn API integration for posting and engagement workflows.
 * Complements the typefully + buffer plugins — those handle scheduling,
 * this handles immediate publishing and stats-fetching that the scheduler
 * plugins can't do (LinkedIn's own API has no scheduling endpoint).
 *
 * Node types:
 *   linkedin-get-me          — fetch the authenticated user's profile and URN
 *   linkedin-create-post     — publish a text post (optionally with a link preview)
 *   linkedin-create-org-post — publish a post on behalf of an organization page
 *   linkedin-get-post-stats  — fetch likes/comments count for a specific post URN
 *   linkedin-list-posts      — list the user's recent shares
 *
 * Tools (for agent-tool-use):
 *   linkedin-create-post     — same as the node, exposed for agent use
 *
 * Auth: LinkedIn requires OAuth with a developer-registered app. Unlike
 * GitHub, there is no public client ID Stirrup can use — each user must
 * create their own LinkedIn Developer app, run through the OAuth auth
 * code flow once to get an access token, and paste it.
 *
 *   - LINKEDIN_ACCESS_TOKEN env var, or
 *   - `accessToken` in node config, or
 *   - Saved via the Connections panel (manual paste flow)
 *
 * The access token must have these OAuth scopes at minimum:
 *   - w_member_social  (post on the authenticated user's behalf)
 *   - r_liteprofile    (fetch /v2/me for the URN)
 * For org posts add:
 *   - w_organization_social
 *   - rw_organization_admin
 *
 * API base: https://api.linkedin.com/v2
 *
 * IMPORTANT API quirks:
 * - Every request needs `X-Restli-Protocol-Version: 2.0.0`
 * - Post IDs come back as URNs like `urn:li:share:1234567890`
 * - Author field must be the full URN (`urn:li:person:ABCD1234`), not just the ID
 * - There is NO scheduling endpoint — use the typefully or buffer plugin for that
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";

const API_BASE = "https://api.linkedin.com/v2";

interface LinkedInProfile {
  id: string;
  localizedFirstName?: string;
  localizedLastName?: string;
  vanityName?: string;
}

interface LinkedInUgcPostResponse {
  id: string;
}

interface LinkedInSocialActions {
  target: string;
  commentsSummary?: { aggregatedTotalComments?: number; totalFirstLevelComments?: number };
  likesSummary?: { aggregatedTotalLikes?: number; totalLikes?: number };
}

function liApi(token: string) {
  return async (
    method: string,
    path: string,
    body?: unknown
  ): Promise<Record<string, unknown>> => {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`LinkedIn API ${res.status}: ${errBody.slice(0, 400)}`);
    }
    // LinkedIn often returns 201 Created with body, 204 No Content for some calls
    if (res.status === 204) return { ok: true };
    const text = await res.text();
    if (!text) return { ok: true };
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  };
}

function getToken(config: Record<string, unknown>): string {
  const token =
    (config.accessToken as string) ??
    (config.token as string) ??
    process.env.LINKEDIN_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "LinkedIn access token required: set LINKEDIN_ACCESS_TOKEN env var or pass `accessToken` in node config. Create a developer app at https://www.linkedin.com/developers/apps to get one."
    );
  }
  return token;
}

/** Build a standard UGC post body. Shared between personal and org posts. */
function buildUgcPostBody(
  authorUrn: string,
  text: string,
  link?: { url: string; title?: string; description?: string; thumbnailUrl?: string },
  visibility: "PUBLIC" | "CONNECTIONS" = "PUBLIC",
): Record<string, unknown> {
  const specificContent: Record<string, unknown> = {
    "com.linkedin.ugc.ShareContent": {
      shareCommentary: { text },
      shareMediaCategory: link ? "ARTICLE" : "NONE",
      ...(link
        ? {
            media: [
              {
                status: "READY",
                originalUrl: link.url,
                ...(link.title
                  ? { title: { text: link.title } }
                  : {}),
                ...(link.description
                  ? { description: { text: link.description } }
                  : {}),
                ...(link.thumbnailUrl
                  ? { thumbnails: [{ url: link.thumbnailUrl }] }
                  : {}),
              },
            ],
          }
        : {}),
    },
  };

  return {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent,
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": visibility,
    },
  };
}

export default function register(ctx: PluginContext) {
  // ─────────────────────── linkedin-get-me ───────────────────────
  /**
   * Fetch the authenticated user's profile. Call this once per workflow to get
   * the person URN, which you need for creating posts.
   *
   * Outputs:
   *   id          — the numeric LinkedIn ID
   *   urn         — the full URN (urn:li:person:XXXX) ready to pass to create-post
   *   firstName, lastName — for display / message templating
   */
  ctx.registerNodeType("linkedin-get-me", async (config, execCtx) => {
    const merged = { ...execCtx.inputs, ...config } as { accessToken?: string };
    const api = liApi(getToken(merged));
    const profile = (await api("GET", "/me")) as unknown as LinkedInProfile;
    return {
      id: profile.id,
      urn: `urn:li:person:${profile.id}`,
      firstName: profile.localizedFirstName ?? "",
      lastName: profile.localizedLastName ?? "",
      vanityName: profile.vanityName ?? null,
    };
  });

  // ─────────────────────── linkedin-create-post ───────────────────────
  /**
   * Publish a text post to the authenticated user's LinkedIn feed.
   * Optionally attach a link preview (article card).
   *
   * Inputs/config:
   *   accessToken  — LinkedIn access token (or LINKEDIN_ACCESS_TOKEN env)
   *   authorUrn    — person URN like "urn:li:person:XXXX" (from linkedin-get-me).
   *                  If omitted, the plugin fetches /me automatically — one extra
   *                  API call per post, but more ergonomic.
   *   text         — the post body (max 3000 chars per LinkedIn)
   *   linkUrl      — optional. If set, posts as an article card with link preview.
   *   linkTitle    — optional title override for the link card
   *   linkDescription — optional description override
   *   linkThumbnailUrl — optional thumbnail image URL
   *   visibility   — "PUBLIC" | "CONNECTIONS" (default "PUBLIC")
   *
   * Outputs:
   *   postId       — the full post URN (urn:li:share:XXXX or urn:li:ugcPost:XXXX)
   *   postUrl      — shareable https://www.linkedin.com/feed/update/<urn> link
   */
  ctx.registerNodeType("linkedin-create-post", async (config, execCtx) => {
    const merged = { ...execCtx.inputs, ...config } as {
      accessToken?: string;
      authorUrn?: string;
      text: string;
      linkUrl?: string;
      linkTitle?: string;
      linkDescription?: string;
      linkThumbnailUrl?: string;
      visibility?: "PUBLIC" | "CONNECTIONS";
    };
    if (!merged.text) throw new Error("linkedin-create-post: `text` is required");

    const api = liApi(getToken(merged));

    // Auto-fetch the author URN if not provided
    let authorUrn = merged.authorUrn;
    if (!authorUrn) {
      const profile = (await api("GET", "/me")) as unknown as LinkedInProfile;
      authorUrn = `urn:li:person:${profile.id}`;
    }

    const body = buildUgcPostBody(
      authorUrn,
      merged.text,
      merged.linkUrl
        ? {
            url: merged.linkUrl,
            title: merged.linkTitle,
            description: merged.linkDescription,
            thumbnailUrl: merged.linkThumbnailUrl,
          }
        : undefined,
      merged.visibility ?? "PUBLIC",
    );

    const result = (await api("POST", "/ugcPosts", body)) as unknown as LinkedInUgcPostResponse;
    const postId = result.id;
    return {
      postId,
      postUrl: postId ? `https://www.linkedin.com/feed/update/${postId}` : null,
      author: authorUrn,
    };
  });

  // ─────────────────────── linkedin-create-org-post ───────────────────────
  /**
   * Publish a post on behalf of an organization page. Same shape as
   * linkedin-create-post but the author URN is an organization, and the token
   * needs `w_organization_social` + `rw_organization_admin` scopes.
   *
   * Inputs/config:
   *   accessToken  — LinkedIn access token with org scopes
   *   organizationId — numeric org ID (from LinkedIn page URL or /v2/organizations)
   *   text         — post body
   *   linkUrl, linkTitle, linkDescription, linkThumbnailUrl — optional link card
   *   visibility   — always PUBLIC for org posts (LinkedIn enforces)
   *
   * Outputs:
   *   postId, postUrl, author (organization URN)
   */
  ctx.registerNodeType("linkedin-create-org-post", async (config, execCtx) => {
    const merged = { ...execCtx.inputs, ...config } as {
      accessToken?: string;
      organizationId: string;
      text: string;
      linkUrl?: string;
      linkTitle?: string;
      linkDescription?: string;
      linkThumbnailUrl?: string;
    };
    if (!merged.organizationId) throw new Error("linkedin-create-org-post: `organizationId` is required");
    if (!merged.text) throw new Error("linkedin-create-org-post: `text` is required");

    const api = liApi(getToken(merged));
    const authorUrn = `urn:li:organization:${merged.organizationId}`;
    const body = buildUgcPostBody(
      authorUrn,
      merged.text,
      merged.linkUrl
        ? {
            url: merged.linkUrl,
            title: merged.linkTitle,
            description: merged.linkDescription,
            thumbnailUrl: merged.linkThumbnailUrl,
          }
        : undefined,
      "PUBLIC",
    );

    const result = (await api("POST", "/ugcPosts", body)) as unknown as LinkedInUgcPostResponse;
    return {
      postId: result.id,
      postUrl: result.id ? `https://www.linkedin.com/feed/update/${result.id}` : null,
      author: authorUrn,
    };
  });

  // ─────────────────────── linkedin-get-post-stats ───────────────────────
  /**
   * Fetch engagement stats (likes + comments count) for a specific post.
   * Use in digest/analytics workflows to find top-performing posts.
   *
   * Inputs/config:
   *   accessToken — LinkedIn access token
   *   postUrn     — full post URN (urn:li:share:XXXX or urn:li:ugcPost:XXXX)
   *
   * Outputs:
   *   likes       — aggregated like count
   *   comments    — aggregated top-level comment count
   *   target      — the URN that was queried (for fan-in workflows)
   */
  ctx.registerNodeType("linkedin-get-post-stats", async (config, execCtx) => {
    const merged = { ...execCtx.inputs, ...config } as {
      accessToken?: string;
      postUrn: string;
    };
    if (!merged.postUrn) throw new Error("linkedin-get-post-stats: `postUrn` is required");

    const api = liApi(getToken(merged));
    // LinkedIn requires URL-encoding the URN in the path
    const encoded = encodeURIComponent(merged.postUrn);
    const result = (await api("GET", `/socialActions/${encoded}`)) as unknown as LinkedInSocialActions;

    return {
      likes:
        result.likesSummary?.aggregatedTotalLikes ??
        result.likesSummary?.totalLikes ??
        0,
      comments:
        result.commentsSummary?.aggregatedTotalComments ??
        result.commentsSummary?.totalFirstLevelComments ??
        0,
      target: result.target ?? merged.postUrn,
    };
  });

  // ─────────────────────── linkedin-list-posts ───────────────────────
  /**
   * List the authenticated user's recent shares. Useful for digest workflows
   * that want to pull "my last 10 posts" and then fan out to get-post-stats.
   *
   * Inputs/config:
   *   accessToken — LinkedIn access token
   *   count       — how many posts to fetch (default 10, max 50)
   *
   * Outputs:
   *   posts       — array of { urn, text, createdAt }
   *   count       — number of posts returned
   */
  ctx.registerNodeType("linkedin-list-posts", async (config, execCtx) => {
    const merged = { ...execCtx.inputs, ...config } as {
      accessToken?: string;
      count?: number;
    };
    const api = liApi(getToken(merged));

    // Fetch /me to get the person URN
    const profile = (await api("GET", "/me")) as unknown as LinkedInProfile;
    const count = Math.min(merged.count ?? 10, 50);

    // Uses the /shares endpoint which lists shares owned by the authenticated user
    const result = (await api(
      "GET",
      `/shares?q=owners&owners=urn:li:person:${profile.id}&sharesPerOwner=${count}&count=${count}`,
    )) as { elements?: Array<{ activity?: string; id?: string; text?: { text?: string }; created?: { time?: number } }> };

    const posts = (result.elements ?? []).map((el) => ({
      urn: el.activity ?? el.id ?? "",
      text: el.text?.text ?? "",
      createdAt: el.created?.time ? new Date(el.created.time).toISOString() : null,
    }));

    return { posts, count: posts.length };
  });

  // ─────────────────────── Tool: linkedin-create-post ───────────────────────
  ctx.registerTool({
    name: "linkedin-create-post",
    description:
      "Publish a text post to LinkedIn on behalf of the authenticated user. Optionally attach a link preview card. Returns the post URN and a shareable URL.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Post body (max 3000 chars)." },
        linkUrl: { type: "string", description: "Optional URL to attach as a link preview card." },
        visibility: {
          type: "string",
          description: "PUBLIC (default) or CONNECTIONS.",
          enum: ["PUBLIC", "CONNECTIONS"],
        },
      },
      required: ["text"],
    },
    handler: async (input) => {
      const token = process.env.LINKEDIN_ACCESS_TOKEN;
      if (!token) throw new Error("LINKEDIN_ACCESS_TOKEN not set");
      const api = liApi(token);
      const profile = (await api("GET", "/me")) as unknown as LinkedInProfile;
      const body = buildUgcPostBody(
        `urn:li:person:${profile.id}`,
        input.text as string,
        input.linkUrl ? { url: input.linkUrl as string } : undefined,
        (input.visibility as "PUBLIC" | "CONNECTIONS") ?? "PUBLIC",
      );
      const result = (await api("POST", "/ugcPosts", body)) as unknown as LinkedInUgcPostResponse;
      return {
        postId: result.id,
        postUrl: result.id ? `https://www.linkedin.com/feed/update/${result.id}` : null,
      };
    },
  });
}
