/**
 * Stirrup Plugin: Launchmatic (launchmatic.io)
 *
 * Full integration with the Launchmatic deployment platform.
 * Covers projects, services, deployments, databases, domains,
 * environment variables, browser automation, and the Lightspeed AI feature.
 *
 * Node types:
 *   Deployment: lm-deploy, lm-quicklaunch, lm-rollback, lm-status
 *   Projects:   lm-create-project, lm-list-projects
 *   Services:   lm-create-service, lm-delete-service
 *   Databases:  lm-db-create, lm-db-query, lm-db-seed, lm-db-credentials
 *   Domains:    lm-domain-add, lm-domain-verify, lm-domain-list
 *   Env Vars:   lm-env-set, lm-env-list
 *   Browser:    lm-browser-screenshot, lm-browser-test, lm-browser-pdf
 *   AI:         lm-lightspeed
 *   Logs:       lm-logs
 *
 * Tools (for agent-tool-use nodes):
 *   lm-deploy-service, lm-get-status, lm-run-query, lm-get-logs, lm-screenshot
 *
 * Auth: Set LAUNCHMATIC_TOKEN env var or pass token in config.
 * API Base: https://api.launchmatic.io/api
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../safeFetch.js";

const API_BASE = process.env.LAUNCHMATIC_API_BASE ?? "https://api.launchmatic.io/api";

type LmApiError = Error & { status: number; body: unknown };

function lmApi(token: string) {
  return async (method: string, path: string, body?: unknown): Promise<any> => {
    const res = await safeFetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      let parsed: unknown = errText;
      try { parsed = JSON.parse(errText); } catch { /* keep as text */ }
      const err = new Error(`Launchmatic API ${res.status}: ${errText}`) as LmApiError;
      err.status = res.status;
      err.body = parsed;
      throw err;
    }
    if (res.status === 204) return { ok: true };
    const json = await res.json();
    if (json && typeof json === "object" && "success" in json && "data" in json) {
      if ((json as any).success === false) {
        throw new Error(`Launchmatic API error: ${String((json as any).error ?? "unknown")}`);
      }
      return (json as any).data;
    }
    return json;
  };
}

async function resolveTeamId(
  api: (method: string, path: string, body?: unknown) => Promise<any>,
  explicit?: string,
): Promise<string> {
  if (explicit) return explicit;
  const envTeam = process.env.LAUNCHMATIC_TEAM_ID;
  if (envTeam) return envTeam;
  const list = await api("GET", "/teams");
  const arr = Array.isArray(list) ? list : [];
  if (arr.length === 0) {
    throw new Error("Launchmatic: no teams found for this token; pass teamId in config or set LAUNCHMATIC_TEAM_ID");
  }
  if (arr.length > 1) {
    const ids = arr.map((t: any) => `${t.id}(${t.name ?? ""})`).join(", ");
    throw new Error(`Launchmatic: multiple teams available, pick one via teamId config or LAUNCHMATIC_TEAM_ID. Teams: ${ids}`);
  }
  return String((arr[0] as any).id);
}

function getToken(source: Record<string, unknown>, inputs?: Record<string, unknown>): string {
  // Token can arrive three ways, in priority order: (1) input mapping from
  // workflow context (the canonical path for `service: launchmatic` params),
  // (2) explicit config value, (3) LAUNCHMATIC_TOKEN env var. Without the
  // inputs check, templates using `from: context.lmToken, to: token` would
  // fail with "token required" unless the env var happened to be set too.
  const token = (inputs?.token as string) ?? (source.token as string) ?? process.env.LAUNCHMATIC_TOKEN;
  if (!token) throw new Error("Launchmatic token required: set LAUNCHMATIC_TOKEN or pass token via input/config");
  return token;
}

async function getPlaywright() {
  try {
    return await import("playwright");
  } catch {
    throw new Error("playwright is required for browser commands: npm install playwright");
  }
}

const PROXY_DOMAIN = process.env.LAUNCHMATIC_PROXY_DOMAIN ?? "launchmatic.io";

function computeServiceUrl(service: Record<string, unknown>): string {
  const subdomain = (service.subdomain as string) || "";
  if (!subdomain) return "";
  return `https://${subdomain}.apps.${PROXY_DOMAIN}`;
}

function slugify(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "app";
}

function parseRepo(repo?: string): { owner?: string; name?: string } {
  if (!repo) return {};
  const [owner, name] = repo.split("/");
  return { owner, name };
}

async function findProjectBySlug(
  api: (method: string, path: string, body?: unknown) => Promise<unknown>,
  teamId: string,
  slug: string,
): Promise<Record<string, unknown> | null> {
  // lmApi unwraps { success, data } → so GET /projects returns the array directly
  const res = await api("GET", `/projects?teamId=${encodeURIComponent(teamId)}`);
  const arr = Array.isArray(res) ? res : [];
  return (arr.find((p: any) => p.slug === slug) as Record<string, unknown>) ?? null;
}

async function findServiceBySlug(
  api: (method: string, path: string, body?: unknown) => Promise<unknown>,
  projectId: string,
  slug: string,
): Promise<Record<string, unknown> | null> {
  const res = await api("GET", `/services?projectId=${encodeURIComponent(projectId)}`);
  const arr = Array.isArray(res) ? res : [];
  return (arr.find((s: any) => s.slug === slug) as Record<string, unknown>) ?? null;
}

export default function register(ctx: PluginContext) {
  // ─────────────────────── Deployment ───────────────────────

  ctx.registerNodeType("lm-deploy", async (config, execCtx) => {
    const { serviceId, branch, commitSha } = { ...execCtx.inputs, ...config } as {
      serviceId: string; branch?: string; commitSha?: string;
    };
    const api = lmApi(getToken(config, execCtx.inputs));
    const deployment = await api("POST", "/deployments", { serviceId, branch, commitSha });
    return {
      deploymentId: deployment.id,
      status: deployment.status,
      serviceId,
      branch: deployment.branch,
      commitSha: deployment.commitSha,
      createdAt: deployment.createdAt,
    };
  });

  ctx.registerNodeType("lm-quicklaunch", async (config, execCtx) => {
    const { projectId: projectIdIn, projectSlug, name, repo, branch, framework, port } = {
      ...execCtx.inputs, ...config,
    } as {
      projectId?: string; projectSlug?: string; name: string;
      repo?: string; branch?: string; framework?: string; port?: number;
    };
    const api = lmApi(getToken(config, execCtx.inputs));

    // Resolve projectId: explicit input wins, else look up by slug within the team
    let projectId = projectIdIn;
    if (!projectId) {
      if (!projectSlug) throw new Error("lm-quicklaunch: projectId or projectSlug is required");
      const teamId = await resolveTeamId(api);
      const project = await findProjectBySlug(api, teamId, projectSlug);
      if (!project) throw new Error(`lm-quicklaunch: no project with slug '${projectSlug}' in team`);
      projectId = String((project as any).id);
    }

    const { owner: repoOwner, name: repoName } = parseRepo(repo);
    const serviceSlug = slugify(name);

    // Idempotent: if a service with this slug already exists in the project,
    // reuse it and just trigger a new deployment. Avoids 500s on the service
    // POST when the unique constraint on (projectId, slug) collides.
    const existingService = await findServiceBySlug(api, projectId, serviceSlug);
    const reused = !!existingService;
    const service: Record<string, unknown> = existingService ?? await api("POST", "/services", {
      name,
      slug: serviceSlug,
      type: "WEB",
      projectId,
      repoOwner,
      repoName,
      repoBranch: branch ?? "main",
      port: port ?? 3000,
      framework,
    });

    const deployment = await api("POST", "/deployments", {
      serviceId: service.id,
      branch: branch ?? "main",
    });
    return {
      serviceId: service.id,
      serviceName: service.name,
      serviceSlug: service.slug,
      deploymentId: deployment.id,
      status: deployment.status,
      url: computeServiceUrl(service),
      subdomain: service.subdomain,
      reused,
    };
  });

  ctx.registerNodeType("lm-status", async (config, execCtx) => {
    const { serviceId } = { ...execCtx.inputs, ...config } as { serviceId: string };
    const api = lmApi(getToken(config, execCtx.inputs));
    const service = await api("GET", `/services/${serviceId}`);
    const deployments = await api("GET", `/deployments?serviceId=${encodeURIComponent(serviceId)}&limit=1`);
    const list = Array.isArray(deployments) ? deployments : [];
    const latest = list[0] as Record<string, unknown> | undefined;
    return {
      serviceId: service.id, name: service.name, slug: service.slug,
      url: computeServiceUrl(service), framework: service.framework,
      latestDeployment: latest ? { id: latest.id, status: latest.status, createdAt: latest.createdAt } : null,
    };
  });

  ctx.registerNodeType("lm-rollback", async (config, execCtx) => {
    const { deploymentId } = { ...execCtx.inputs, ...config } as { deploymentId: string };
    const api = lmApi(getToken(config, execCtx.inputs));
    const result = await api("POST", `/deployments/${deploymentId}/rollback`);
    return { deploymentId: result.id, status: result.status, rolledBackFromId: result.rollbackFromId ?? deploymentId };
  });

  // ─────────────────────── Projects ───────────────────────

  ctx.registerNodeType("lm-create-project", async (config, execCtx) => {
    const { name, slug, teamId: teamIdIn } = { ...execCtx.inputs, ...config } as {
      name: string; slug?: string; teamId?: string;
    };
    const api = lmApi(getToken(config, execCtx.inputs));
    const teamId = await resolveTeamId(api, teamIdIn);
    const resolvedSlug = slug ?? slugify(name);

    // Look up first: the API returns 500 (not 409) on unique-slug collisions
    // in some environments, so probing beforehand is the only reliable way
    // to make this node idempotent across reruns.
    const preexisting = await findProjectBySlug(api, teamId, resolvedSlug);
    if (preexisting) {
      return { projectId: preexisting.id, slug: preexisting.slug, name: preexisting.name, teamId, reused: true };
    }

    try {
      const project = await api("POST", "/projects", { name, slug: resolvedSlug, teamId });
      return { projectId: project.id, slug: project.slug, name: project.name, teamId, reused: false };
    } catch (err) {
      // Concurrent create → re-list. Also covers the case where the server
      // returns a non-specific error code for a duplicate.
      const existing = await findProjectBySlug(api, teamId, resolvedSlug);
      if (existing) {
        return { projectId: existing.id, slug: existing.slug, name: existing.name, teamId, reused: true };
      }
      throw err;
    }
  });

  ctx.registerNodeType("lm-list-projects", async (config, execCtx) => {
    const { teamId: teamIdIn } = { ...execCtx.inputs, ...config } as { teamId?: string };
    const api = lmApi(getToken(config, execCtx.inputs));
    const teamId = await resolveTeamId(api, teamIdIn);
    const list = await api("GET", `/projects?teamId=${encodeURIComponent(teamId)}`);
    const arr = Array.isArray(list) ? list : [];
    return {
      projects: arr.map((p: any) => ({ id: p.id, name: p.name, slug: p.slug, teamId: p.teamId })),
      count: arr.length,
      teamId,
    };
  });

  // ─────────────────────── Services ───────────────────────

  ctx.registerNodeType("lm-create-service", async (config, execCtx) => {
    const {
      projectId: projectIdIn, projectSlug, teamId: teamIdIn,
      name, repo, branch, framework, port,
    } = {
      ...execCtx.inputs, ...config,
    } as {
      projectId?: string; projectSlug?: string; teamId?: string;
      name: string; repo?: string;
      branch?: string; framework?: string; port?: number;
    };
    if (!projectIdIn && !projectSlug) {
      throw new Error("lm-create-service: projectId or projectSlug is required");
    }
    const api = lmApi(getToken(config, execCtx.inputs));

    // Resolve projectSlug → projectId when the caller only has the slug.
    // self-deploy-launchmatic drives the whole flow off the slug (users see
    // slugs in the Launchmatic UI; IDs are internal UUIDs), so this is the
    // hot path for template-driven deploys. Direct projectId still wins
    // when supplied, so lm-create-project→lm-create-service chains keep
    // working without an extra round-trip.
    let projectId = projectIdIn;
    if (!projectId) {
      const teamId = await resolveTeamId(api, teamIdIn);
      const found = await findProjectBySlug(api, teamId, projectSlug!);
      if (!found) {
        throw new Error(
          `lm-create-service: no project with slug "${projectSlug}" in team ${teamId}. ` +
          `Create it first via lm-create-project, or pass projectId directly.`
        );
      }
      projectId = String((found as { id: unknown }).id);
    }

    const { owner: repoOwner, name: repoName } = parseRepo(repo);
    const service = await api("POST", "/services", {
      name,
      slug: slugify(name),
      type: "WEB",
      projectId,
      repoOwner,
      repoName,
      repoBranch: branch ?? "main",
      port: port ?? 3000,
      framework,
    });
    return {
      serviceId: service.id, name: service.name, slug: service.slug,
      subdomain: service.subdomain, url: computeServiceUrl(service),
    };
  });

  ctx.registerNodeType("lm-delete-service", async (config, execCtx) => {
    const { serviceId } = { ...execCtx.inputs, ...config } as { serviceId: string };
    const api = lmApi(getToken(config, execCtx.inputs));
    await api("DELETE", `/services/${serviceId}`);
    return { deleted: true, serviceId };
  });

  // ─────────────────────── Databases ───────────────────────

  ctx.registerNodeType("lm-db-create", async (config, execCtx) => {
    const { name, engine, projectId, serviceId, version, storageSize } = {
      ...execCtx.inputs, ...config,
    } as {
      name: string; engine?: string; projectId?: string; serviceId?: string;
      version?: string; storageSize?: number;
    };
    // Launchmatic accepts POSTGRESQL | REDIS | MONGODB (enum uppercase)
    const engineUpper = (engine ?? "POSTGRESQL").toUpperCase();
    const api = lmApi(getToken(config, execCtx.inputs));
    const db = await api("POST", "/databases", {
      name, engine: engineUpper, projectId, serviceId, version, storageSize,
    });
    if (serviceId && db.id && !projectId) {
      try { await api("POST", `/databases/${db.id}/link`, { serviceId }); } catch { /* optional */ }
    }
    return { databaseId: db.id, name: db.name, engine: db.engine, status: db.status };
  });

  ctx.registerNodeType("lm-db-query", async (config, execCtx) => {
    const { databaseId, sql, params } = { ...execCtx.inputs, ...config } as {
      databaseId: string; sql: string; params?: unknown[];
    };
    const api = lmApi(getToken(config, execCtx.inputs));
    const creds = await api("GET", `/databases/${databaseId}/credentials`);
    const connString = (creds.connectionString as string) || (creds.externalUrl as string);
    if (!connString) throw new Error("Could not retrieve connection string from /credentials");

    const pg: any = await import("pg" as any).catch(() => { throw new Error("pg required: npm install pg"); });
    const Pool = pg.default?.Pool ?? (pg as any).Pool;
    const pool = new Pool({ connectionString: connString });
    try {
      const result = await pool.query(sql, params);
      return { rows: result.rows, rowCount: result.rowCount, fields: result.fields?.map((f: any) => f.name) };
    } finally { await pool.end(); }
  });

  ctx.registerNodeType("lm-db-seed", async (config, execCtx) => {
    const { databaseId, sql } = { ...execCtx.inputs, ...config } as { databaseId: string; sql: string };
    const api = lmApi(getToken(config, execCtx.inputs));
    const creds = await api("GET", `/databases/${databaseId}/credentials`);
    const connString = (creds.connectionString as string) || (creds.externalUrl as string);
    if (!connString) throw new Error("Could not retrieve connection string from /credentials");
    const pg: any = await import("pg" as any).catch(() => { throw new Error("pg required"); });
    const Pool = pg.default?.Pool ?? (pg as any).Pool;
    const pool = new Pool({ connectionString: connString });
    try {
      const stmts = sql.split(";").map((s) => s.trim()).filter(Boolean);
      for (const stmt of stmts) await pool.query(stmt);
      return { executed: stmts.length, databaseId };
    } finally { await pool.end(); }
  });

  ctx.registerNodeType("lm-db-credentials", async (config, execCtx) => {
    const { databaseId } = { ...execCtx.inputs, ...config } as { databaseId: string };
    const api = lmApi(getToken(config, execCtx.inputs));
    const creds = await api("GET", `/databases/${databaseId}/credentials`);
    return {
      databaseId, engine: creds.engine, host: creds.host, port: creds.port,
      username: creds.username, password: creds.password, database: creds.database,
      connectionString: creds.connectionString, externalUrl: creds.externalUrl,
      internalDns: creds.internalDns,
    };
  });

  // ─────────────────────── Domains ───────────────────────

  ctx.registerNodeType("lm-domain-add", async (config, execCtx) => {
    const { serviceId, domain, hostname } = { ...execCtx.inputs, ...config } as {
      serviceId: string; domain?: string; hostname?: string;
    };
    const host = hostname ?? domain;
    if (!host) throw new Error("lm-domain-add: hostname (or domain) is required");
    const api = lmApi(getToken(config, execCtx.inputs));
    const result = await api("POST", "/domains", { hostname: host, serviceId });
    return {
      domainId: result.id, hostname: result.hostname,
      verified: result.verified, sslStatus: result.sslStatus, dnsStatus: result.dnsStatus,
    };
  });

  ctx.registerNodeType("lm-domain-verify", async (config, execCtx) => {
    const { domainId } = { ...execCtx.inputs, ...config } as { domainId: string };
    const api = lmApi(getToken(config, execCtx.inputs));
    const result = await api("POST", `/domains/${domainId}/verify`);
    return { domainId, verified: result.verified, sslStatus: result.sslStatus, dnsStatus: result.dnsStatus };
  });

  ctx.registerNodeType("lm-domain-list", async (config, execCtx) => {
    const { serviceId } = { ...execCtx.inputs, ...config } as { serviceId: string };
    const api = lmApi(getToken(config, execCtx.inputs));
    const list = await api("GET", `/domains?serviceId=${encodeURIComponent(serviceId)}`);
    const arr = Array.isArray(list) ? list : [];
    return { domains: arr, count: arr.length, serviceId };
  });

  // ─────────────────────── Environment Variables ───────────────────────

  ctx.registerNodeType("lm-env-set", async (config, execCtx) => {
    const { serviceId, variables } = { ...execCtx.inputs, ...config } as {
      serviceId: string; variables: Record<string, string>;
    };
    const api = lmApi(getToken(config, execCtx.inputs));
    const vars = Object.entries(variables).map(([key, value]) => ({ key, value }));
    await api("PUT", `/services/${serviceId}/env`, { vars });
    return { serviceId, set: Object.keys(variables), count: Object.keys(variables).length };
  });

  ctx.registerNodeType("lm-env-list", async (config, execCtx) => {
    const { serviceId } = { ...execCtx.inputs, ...config } as { serviceId: string };
    const api = lmApi(getToken(config, execCtx.inputs));
    const list = await api("GET", `/services/${serviceId}/env`);
    const arr = Array.isArray(list) ? list : [];
    const masked: Record<string, string> = {};
    for (const row of arr) {
      const k = (row as any).key as string;
      const v = String((row as any).value ?? "");
      masked[k] = v.length > 8 ? v.slice(0, 4) + "..." + v.slice(-4) : "***";
    }
    return { variables: masked, count: arr.length, serviceId };
  });

  // ─────────────────────── Browser Automation ───────────────────────

  ctx.registerNodeType("lm-browser-screenshot", async (config, execCtx) => {
    const { url, device, fullPage, outputPath } = { ...execCtx.inputs, ...config } as {
      url: string; device?: string; fullPage?: boolean; outputPath?: string;
    };
    const pw = await getPlaywright();
    const browser = await pw.chromium.launch();
    const browserCtx = device
      ? await browser.newContext((pw.devices as any)[device] ?? {})
      : await browser.newContext();
    const page = await browserCtx.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    const buf = await page.screenshot({ fullPage: fullPage ?? false, type: "png" });
    await browser.close();

    const path = outputPath ?? `screenshot_${Date.now()}.png`;
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, buf);
    return { path, url, device: device ?? "desktop", fullPage: fullPage ?? false, size: buf.length };
  });

  ctx.registerNodeType("lm-browser-test", async (config, execCtx) => {
    const { url, checkLinks, timeout } = { ...execCtx.inputs, ...config } as {
      url: string; checkLinks?: boolean; timeout?: number;
    };
    const pw = await getPlaywright();
    const browser = await pw.chromium.launch();
    const page = await browser.newPage();
    const jsErrors: string[] = [];
    const warnings: string[] = [];

    page.on("pageerror", (err: Error) => jsErrors.push(err.message));
    page.on("console", (msg: any) => {
      if (msg.type() === "error") jsErrors.push(msg.text());
      if (msg.type() === "warning") warnings.push(msg.text());
    });

    const start = Date.now();
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: timeout ?? 30000 });
    const loadTime = Date.now() - start;
    const title = await page.title();
    const contentLength = (await page.content()).length;

    const results: Record<string, unknown> = {
      url, status: response?.status(), loadTimeMs: loadTime, title,
      jsErrors, consoleWarnings: warnings, isHttps: url.startsWith("https"),
      hasContent: contentLength > 100,
    };

    if (checkLinks) {
      const linkEls = await page.locator("a[href]").all();
      const links: string[] = [];
      for (const el of linkEls) {
        const href = await el.getAttribute("href");
        if (href?.startsWith("http")) links.push(href);
      }
      const broken: string[] = [];
      for (const link of links.slice(0, 20)) {
        try {
          const r = await safeFetch(link, { method: "HEAD", signal: AbortSignal.timeout(5000) });
          if (r.status >= 400) broken.push(`${link} (${r.status})`);
        } catch { broken.push(`${link} (unreachable)`); }
      }
      results.linksChecked = links.length;
      results.brokenLinks = broken;
    }

    await browser.close();
    return { ...results, passed: jsErrors.length === 0 && (response?.status() ?? 500) < 400 };
  });

  ctx.registerNodeType("lm-browser-pdf", async (config, execCtx) => {
    const { url, outputPath, format } = { ...execCtx.inputs, ...config } as {
      url: string; outputPath?: string; format?: string;
    };
    const pw = await getPlaywright();
    const browser = await pw.chromium.launch();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    const buf = await page.pdf({ format: (format ?? "A4") as any, printBackground: true });
    await browser.close();

    const path = outputPath ?? `page_${Date.now()}.pdf`;
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, buf);
    return { path, url, size: buf.length, format: format ?? "A4" };
  });

  // ─────────────────────── AI — Lightspeed ───────────────────────

  ctx.registerNodeType("lm-lightspeed", async (config, execCtx) => {
    const { prompt, projectId } = { ...execCtx.inputs, ...config } as {
      prompt: string; projectId?: string;
    };
    const api = lmApi(getToken(config, execCtx.inputs));
    const gen = await api("POST", "/lightspeed/generate", { prompt, projectId });
    return {
      generationId: gen.id ?? gen.generationId,
      prompt,
      status: gen.status,
      plan: gen.plan,
      projectId: gen.projectId,
    };
  });

  // ─────────────────────── Logs ───────────────────────
  // NOTE: Launchmatic log streams are WebSocket-only (/ws/logs/:deploymentId,
  // /ws/runtime-logs/:serviceId). There is no REST endpoint that returns a
  // snapshot of recent lines, so this node returns deployment metadata + a
  // connection URL for callers that want to subscribe themselves.

  ctx.registerNodeType("lm-logs", async (config, execCtx) => {
    const { serviceId, deploymentId, lines } = { ...execCtx.inputs, ...config } as {
      serviceId?: string; deploymentId?: string; lines?: number;
    };
    const api = lmApi(getToken(config, execCtx.inputs));
    if (!serviceId && !deploymentId) throw new Error("serviceId or deploymentId required");

    if (deploymentId) {
      const dep = await api("GET", `/deployments/${deploymentId}`);
      return {
        deploymentId,
        status: dep.status,
        logsWebsocketUrl: `wss://api.launchmatic.io/ws/logs/${deploymentId}`,
        note: "Launchmatic logs are streamed via WebSocket; this node returns deployment metadata and the WS URL",
        lines: lines ?? 100,
      };
    }
    const list = await api("GET", `/deployments?serviceId=${encodeURIComponent(serviceId!)}&limit=1`);
    const arr = Array.isArray(list) ? list : [];
    if (arr.length === 0) return { logs: [], message: "No deployments for service" };
    const latestId = (arr[0] as any).id as string;
    return {
      deploymentId: latestId,
      status: (arr[0] as any).status,
      logsWebsocketUrl: `wss://api.launchmatic.io/ws/logs/${latestId}`,
      runtimeLogsWebsocketUrl: `wss://api.launchmatic.io/ws/runtime-logs/${serviceId}`,
      note: "Launchmatic logs are streamed via WebSocket; this node returns deployment metadata and WS URLs",
    };
  });

  // ─────────────────────── Tools (for agent-tool-use nodes) ───────────────────────

  ctx.registerTool({
    name: "lm-deploy-service",
    description: "Deploy a Launchmatic service. Triggers a new deployment build.",
    inputSchema: {
      type: "object",
      properties: { serviceId: { type: "string", description: "Service ID to deploy" } },
      required: ["serviceId"],
    },
    handler: async (input) => lmApi(getToken({}))(
      "POST", "/deployments", { serviceId: input.serviceId }
    ),
  });

  ctx.registerTool({
    name: "lm-get-status",
    description: "Get the current status of a Launchmatic service including latest deployment.",
    inputSchema: {
      type: "object",
      properties: { serviceId: { type: "string", description: "Service ID to check" } },
      required: ["serviceId"],
    },
    handler: async (input) => {
      const service = await lmApi(getToken({}))("GET", `/services/${input.serviceId}`);
      return { id: service.id, name: service.name, slug: service.slug, url: computeServiceUrl(service) };
    },
  });

  ctx.registerTool({
    name: "lm-run-query",
    description: "Run a SQL query against a Launchmatic-provisioned PostgreSQL database.",
    inputSchema: {
      type: "object",
      properties: {
        databaseId: { type: "string", description: "Database ID" },
        sql: { type: "string", description: "SQL query" },
      },
      required: ["databaseId", "sql"],
    },
    handler: async (input) => {
      const api = lmApi(getToken({}));
      const creds = await api("GET", `/databases/${input.databaseId}/credentials`);
      const connString = (creds.connectionString as string) || (creds.externalUrl as string);
      if (!connString) throw new Error("Could not retrieve connection string from /credentials");
      const pg: any = await import("pg" as any).catch(() => { throw new Error("pg required"); });
      const Pool = pg.default?.Pool ?? (pg as any).Pool;
      const pool = new Pool({ connectionString: connString });
      try {
        const r = await pool.query(input.sql as string);
        return { rows: r.rows?.slice(0, 50), rowCount: r.rowCount };
      } finally { await pool.end(); }
    },
  });

  ctx.registerTool({
    name: "lm-get-logs",
    description: "Return deployment metadata and a WebSocket URL for streaming logs (Launchmatic logs are WS-only).",
    inputSchema: {
      type: "object",
      properties: {
        serviceId: { type: "string", description: "Service ID" },
        lines: { type: "number", description: "Hint for number of lines (not enforced server-side)" },
      },
      required: ["serviceId"],
    },
    handler: async (input) => {
      const api = lmApi(getToken({}));
      const deps = await api("GET", `/deployments?serviceId=${encodeURIComponent(input.serviceId as string)}&limit=1`);
      const list = Array.isArray(deps) ? deps : [];
      if (list.length === 0) return { logs: [], message: "No deployments" };
      const latestId = (list[0] as any).id as string;
      return {
        deploymentId: latestId,
        status: (list[0] as any).status,
        logsWebsocketUrl: `wss://api.launchmatic.io/ws/logs/${latestId}`,
        runtimeLogsWebsocketUrl: `wss://api.launchmatic.io/ws/runtime-logs/${input.serviceId}`,
      };
    },
  });

  ctx.registerTool({
    name: "lm-screenshot",
    description: "Take a screenshot of a URL using Playwright browser automation.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to screenshot" },
        device: { type: "string", description: "Device to emulate (e.g., 'iPhone 14')" },
        fullPage: { type: "boolean", description: "Capture full scrollable page" },
      },
      required: ["url"],
    },
    handler: async (input) => {
      const pw = await getPlaywright();
      const browser = await pw.chromium.launch();
      const ctx = input.device
        ? await browser.newContext((pw.devices as any)[input.device as string] ?? {})
        : await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(input.url as string, { waitUntil: "networkidle" });
      const buf = await page.screenshot({ fullPage: !!input.fullPage, type: "png" });
      await browser.close();
      const path = `screenshot_${Date.now()}.png`;
      const { writeFileSync } = await import("node:fs");
      writeFileSync(path, buf);
      return { path, size: buf.length };
    },
  });
}
