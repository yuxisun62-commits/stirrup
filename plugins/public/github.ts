/**
 * Stirrup Plugin: GitHub
 * Node types: github-get-pr, github-create-issue, github-post-comment, github-list-files, github-create-repo
 * Tools: github-search-code, github-get-repo
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";

export default function register(ctx: PluginContext) {
  const headers = (token?: string) => ({
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "stirrup-github-plugin",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  ctx.registerNodeType("github-get-pr", async (config, execCtx) => {
    const { repo, prNumber, token } = { ...execCtx.inputs, ...config } as {
      repo: string; prNumber: number; token?: string;
    };
    const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, {
      headers: headers(token),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const pr = await res.json() as Record<string, unknown>;

    // Also fetch the diff
    const diffRes = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, {
      headers: { ...headers(token), Accept: "application/vnd.github.v3.diff" },
    });
    const diff = diffRes.ok ? await diffRes.text() : "";

    return {
      title: pr.title,
      body: pr.body,
      state: pr.state,
      author: (pr.user as any)?.login,
      branch: (pr.head as any)?.ref,
      baseBranch: (pr.base as any)?.ref,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files,
      diff,
      url: pr.html_url,
    };
  });

  ctx.registerNodeType("github-create-issue", async (config, execCtx) => {
    const { repo, token, title, body, labels, assignees } = { ...execCtx.inputs, ...config } as {
      repo: string; token: string; title: string; body?: string;
      labels?: string[]; assignees?: string[];
    };
    const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, labels, assignees }),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const issue = await res.json() as Record<string, unknown>;
    return { issueNumber: issue.number, url: issue.html_url };
  });

  ctx.registerNodeType("github-post-comment", async (config, execCtx) => {
    const { repo, token, issueNumber, body } = { ...execCtx.inputs, ...config } as {
      repo: string; token: string; issueNumber: number; body: string;
    };
    const res = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`, {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const comment = await res.json() as Record<string, unknown>;
    return { commentId: comment.id, url: comment.html_url };
  });

  ctx.registerNodeType("github-list-files", async (config, execCtx) => {
    const { repo, token, prNumber } = { ...execCtx.inputs, ...config } as {
      repo: string; token: string; prNumber: number;
    };
    const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}/files`, {
      headers: headers(token),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const files = await res.json() as Array<Record<string, unknown>>;
    return {
      files: files.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
      })),
      fileCount: files.length,
    };
  });

  ctx.registerNodeType("github-create-repo", async (config, execCtx) => {
    const { token, name, description, isPrivate, org } = { ...execCtx.inputs, ...config } as {
      token: string; name: string; description?: string; isPrivate?: boolean; org?: string;
    };
    if (!token) throw new Error("GitHub token required to create a repository");
    if (!name) throw new Error("Repository name is required");

    // Create under org or authenticated user
    const url = org
      ? `https://api.github.com/orgs/${org}/repos`
      : "https://api.github.com/user/repos";

    const res = await fetch(url, {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description: description ?? "",
        private: isPrivate ?? false,
        auto_init: false,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub create repo ${res.status}: ${body}`);
    }

    const repo = await res.json() as Record<string, unknown>;
    return {
      fullName: repo.full_name,
      cloneUrl: repo.clone_url,
      sshUrl: repo.ssh_url,
      htmlUrl: repo.html_url,
      defaultBranch: repo.default_branch ?? "main",
    };
  });

  ctx.registerTool({
    name: "github-search-code",
    description: "Search for code in GitHub repositories",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        repo: { type: "string", description: "Optional: restrict to repo (owner/name)" },
      },
      required: ["query"],
    },
    handler: async (input) => {
      const q = input.repo ? `${input.query} repo:${input.repo}` : input.query as string;
      const res = await fetch(`https://api.github.com/search/code?q=${encodeURIComponent(q)}`, {
        headers: headers(process.env.GITHUB_TOKEN),
      });
      const data = await res.json() as Record<string, unknown>;
      return { totalCount: data.total_count, items: (data.items as any[])?.slice(0, 10) };
    },
  });
}
