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
 * API Base: https://api.launchmatic.io/v1
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";

const API_BASE = "https://api.launchmatic.io/v1";

function lmApi(token: string) {
  return async (method: string, path: string, body?: unknown): Promise<Record<string, unknown>> => {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Launchmatic API ${res.status}: ${errBody}`);
    }
    if (res.status === 204) return { ok: true };
    return (await res.json()) as Record<string, unknown>;
  };
}

function getToken(config: Record<string, unknown>): string {
  const token = (config.token as string) ?? process.env.LAUNCHMATIC_TOKEN;
  if (!token) throw new Error("Launchmatic token required: set LAUNCHMATIC_TOKEN or pass token in config");
  return token;
}

async function getPlaywright() {
  try {
    return await import("playwright");
  } catch {
    throw new Error("playwright is required for browser commands: npm install playwright");
  }
}

export default function register(ctx: PluginContext) {
  // ─────────────────────── Deployment ───────────────────────

  ctx.registerNodeType("lm-deploy", async (config, execCtx) => {
    const { serviceId } = { ...execCtx.inputs, ...config } as { serviceId: string };
    const api = lmApi(getToken(config));
    const deployment = await api("POST", `/services/${serviceId}/deploy`);
    return {
      deploymentId: deployment.id,
      status: deployment.status,
      serviceId,
      url: deployment.url,
      createdAt: deployment.createdAt,
    };
  });

  ctx.registerNodeType("lm-quicklaunch", async (config, execCtx) => {
    const { projectSlug, name, runtime, repo, branch } = { ...execCtx.inputs, ...config } as {
      projectSlug: string; name: string; runtime?: string; repo?: string; branch?: string;
    };
    const api = lmApi(getToken(config));
    const service = await api("POST", `/projects/${projectSlug}/services`, {
      name, runtime, repo, branch: branch ?? "main",
    });
    const deployment = await api("POST", `/services/${service.id}/deploy`);
    return {
      serviceId: service.id,
      serviceName: name,
      deploymentId: deployment.id,
      status: deployment.status,
      url: deployment.url,
    };
  });

  ctx.registerNodeType("lm-status", async (config, execCtx) => {
    const { serviceId } = { ...execCtx.inputs, ...config } as { serviceId: string };
    const api = lmApi(getToken(config));
    const service = await api("GET", `/services/${serviceId}`);
    const deployments = await api("GET", `/services/${serviceId}/deployments`);
    const list = Array.isArray(deployments) ? deployments : (deployments.data as any[]) ?? [];
    const latest = list[0] as Record<string, unknown> | undefined;
    return {
      serviceId: service.id, name: service.name, status: service.status,
      url: service.url, runtime: service.runtime,
      latestDeployment: latest ? { id: latest.id, status: latest.status, createdAt: latest.createdAt } : null,
    };
  });

  ctx.registerNodeType("lm-rollback", async (config, execCtx) => {
    const { serviceId, deploymentId } = { ...execCtx.inputs, ...config } as {
      serviceId: string; deploymentId: string;
    };
    const api = lmApi(getToken(config));
    const result = await api("POST", `/services/${serviceId}/deploy`, { rollbackTo: deploymentId });
    return { deploymentId: result.id, status: result.status, rolledBackTo: deploymentId };
  });

  // ─────────────────────── Projects ───────────────────────

  ctx.registerNodeType("lm-create-project", async (config, execCtx) => {
    const { name, slug } = { ...execCtx.inputs, ...config } as { name: string; slug?: string };
    const api = lmApi(getToken(config));
    const project = await api("POST", "/projects", { name, slug });
    return { projectId: project.id, slug: project.slug, name: project.name };
  });

  ctx.registerNodeType("lm-list-projects", async (config) => {
    const api = lmApi(getToken(config));
    const projects = await api("GET", "/projects");
    const list = Array.isArray(projects) ? projects : (projects.data as any[]) ?? [];
    return { projects: list.map((p: any) => ({ id: p.id, name: p.name, slug: p.slug })), count: list.length };
  });

  // ─────────────────────── Services ───────────────────────

  ctx.registerNodeType("lm-create-service", async (config, execCtx) => {
    const { projectSlug, name, runtime, repo, branch, dockerfile } = { ...execCtx.inputs, ...config } as {
      projectSlug: string; name: string; runtime?: string; repo?: string; branch?: string; dockerfile?: string;
    };
    const api = lmApi(getToken(config));
    const service = await api("POST", `/projects/${projectSlug}/services`, { name, runtime, repo, branch, dockerfile });
    return { serviceId: service.id, name: service.name, status: service.status };
  });

  ctx.registerNodeType("lm-delete-service", async (config, execCtx) => {
    const { serviceId } = { ...execCtx.inputs, ...config } as { serviceId: string };
    const api = lmApi(getToken(config));
    await api("DELETE", `/services/${serviceId}`);
    return { deleted: true, serviceId };
  });

  // ─────────────────────── Databases ───────────────────────

  ctx.registerNodeType("lm-db-create", async (config, execCtx) => {
    const { name, engine, serviceId } = { ...execCtx.inputs, ...config } as {
      name: string; engine?: string; serviceId?: string;
    };
    const api = lmApi(getToken(config));
    const db = await api("POST", "/databases", { name, engine: engine ?? "postgres" });
    if (serviceId && db.id) {
      try { await api("POST", `/databases/${db.id}/link`, { serviceId }); } catch { /* optional */ }
    }
    return { databaseId: db.id, name: db.name, engine: db.engine, status: db.status, connectionString: db.connectionString };
  });

  ctx.registerNodeType("lm-db-query", async (config, execCtx) => {
    const { databaseId, sql, params } = { ...execCtx.inputs, ...config } as {
      databaseId: string; sql: string; params?: unknown[];
    };
    const api = lmApi(getToken(config));
    const dbInfo = await api("GET", `/databases/${databaseId}`);
    const connString = dbInfo.connectionString as string;
    if (!connString) throw new Error("Could not retrieve connection string");

    const pg = await import("pg").catch(() => { throw new Error("pg required: npm install pg"); });
    const Pool = pg.default?.Pool ?? (pg as any).Pool;
    const pool = new Pool({ connectionString: connString });
    try {
      const result = await pool.query(sql, params);
      return { rows: result.rows, rowCount: result.rowCount, fields: result.fields?.map((f: any) => f.name) };
    } finally { await pool.end(); }
  });

  ctx.registerNodeType("lm-db-seed", async (config, execCtx) => {
    const { databaseId, sql } = { ...execCtx.inputs, ...config } as { databaseId: string; sql: string };
    const api = lmApi(getToken(config));
    const dbInfo = await api("GET", `/databases/${databaseId}`);
    const pg = await import("pg").catch(() => { throw new Error("pg required"); });
    const Pool = pg.default?.Pool ?? (pg as any).Pool;
    const pool = new Pool({ connectionString: dbInfo.connectionString as string });
    try {
      const stmts = sql.split(";").map((s) => s.trim()).filter(Boolean);
      for (const stmt of stmts) await pool.query(stmt);
      return { executed: stmts.length, databaseId };
    } finally { await pool.end(); }
  });

  ctx.registerNodeType("lm-db-credentials", async (config, execCtx) => {
    const { databaseId } = { ...execCtx.inputs, ...config } as { databaseId: string };
    const api = lmApi(getToken(config));
    const db = await api("GET", `/databases/${databaseId}`);
    return {
      databaseId: db.id, engine: db.engine, host: db.host, port: db.port,
      username: db.username, password: db.password, database: db.database,
      connectionString: db.connectionString, internalDns: db.internalDns,
    };
  });

  // ─────────────────────── Domains ───────────────────────

  ctx.registerNodeType("lm-domain-add", async (config, execCtx) => {
    const { serviceId, domain } = { ...execCtx.inputs, ...config } as { serviceId: string; domain: string };
    const api = lmApi(getToken(config));
    const result = await api("POST", `/services/${serviceId}/domains`, { domain });
    return { domainId: result.id, domain: result.domain, verified: result.verified, sslStatus: result.sslStatus, dnsRecords: result.dnsRecords };
  });

  ctx.registerNodeType("lm-domain-verify", async (config, execCtx) => {
    const { domainId } = { ...execCtx.inputs, ...config } as { domainId: string };
    const api = lmApi(getToken(config));
    const result = await api("GET", `/domains/${domainId}/verify`);
    return { domainId, verified: result.verified, sslStatus: result.sslStatus, dnsCorrect: result.dnsCorrect };
  });

  ctx.registerNodeType("lm-domain-list", async (config, execCtx) => {
    const { serviceId } = { ...execCtx.inputs, ...config } as { serviceId: string };
    const api = lmApi(getToken(config));
    const service = await api("GET", `/services/${serviceId}`);
    return { domains: service.domains ?? [], serviceId };
  });

  // ─────────────────────── Environment Variables ───────────────────────

  ctx.registerNodeType("lm-env-set", async (config, execCtx) => {
    const { serviceId, variables } = { ...execCtx.inputs, ...config } as {
      serviceId: string; variables: Record<string, string>;
    };
    const api = lmApi(getToken(config));
    await api("PATCH", `/services/${serviceId}`, { env: variables });
    return { serviceId, set: Object.keys(variables), count: Object.keys(variables).length };
  });

  ctx.registerNodeType("lm-env-list", async (config, execCtx) => {
    const { serviceId } = { ...execCtx.inputs, ...config } as { serviceId: string };
    const api = lmApi(getToken(config));
    const service = await api("GET", `/services/${serviceId}`);
    const env = (service.env ?? {}) as Record<string, string>;
    const masked: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      masked[k] = v.length > 8 ? v.slice(0, 4) + "..." + v.slice(-4) : "***";
    }
    return { variables: masked, count: Object.keys(env).length, serviceId };
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
          const r = await fetch(link, { method: "HEAD", signal: AbortSignal.timeout(5000) });
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
    const { serviceId, prompt } = { ...execCtx.inputs, ...config } as { serviceId: string; prompt: string };
    const api = lmApi(getToken(config));
    const result = await api("POST", `/services/${serviceId}/lightspeed`, { prompt });
    return { serviceId, prompt, changes: result.changes, deploymentId: result.deploymentId, status: result.status };
  });

  // ─────────────────────── Logs ───────────────────────

  ctx.registerNodeType("lm-logs", async (config, execCtx) => {
    const { serviceId, deploymentId, lines } = { ...execCtx.inputs, ...config } as {
      serviceId?: string; deploymentId?: string; lines?: number;
    };
    const api = lmApi(getToken(config));
    if (!serviceId && !deploymentId) throw new Error("serviceId or deploymentId required");

    const path = deploymentId
      ? `/deployments/${deploymentId}/logs?lines=${lines ?? 100}`
      : `/services/${serviceId}/deployments`;
    const result = await api("GET", path);
    const logs = result.logs ?? result.data ?? result;
    return { logs: Array.isArray(logs) ? logs : [logs], lineCount: Array.isArray(logs) ? logs.length : 1 };
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
      "POST", `/services/${input.serviceId}/deploy`
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
      return { id: service.id, name: service.name, status: service.status, url: service.url };
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
      const db = await lmApi(getToken({}))("GET", `/databases/${input.databaseId}`);
      const pg = await import("pg").catch(() => { throw new Error("pg required"); });
      const Pool = pg.default?.Pool ?? (pg as any).Pool;
      const pool = new Pool({ connectionString: db.connectionString as string });
      try {
        const r = await pool.query(input.sql as string);
        return { rows: r.rows?.slice(0, 50), rowCount: r.rowCount };
      } finally { await pool.end(); }
    },
  });

  ctx.registerTool({
    name: "lm-get-logs",
    description: "Fetch recent logs from a Launchmatic service deployment.",
    inputSchema: {
      type: "object",
      properties: {
        serviceId: { type: "string", description: "Service ID" },
        lines: { type: "number", description: "Number of lines (default 50)" },
      },
      required: ["serviceId"],
    },
    handler: async (input) => {
      const api = lmApi(getToken({}));
      const deps = await api("GET", `/services/${input.serviceId}/deployments`);
      const list = Array.isArray(deps) ? deps : (deps.data as any[]) ?? [];
      if (list.length === 0) return { logs: [], message: "No deployments" };
      return api("GET", `/deployments/${(list[0] as any).id}/logs?lines=${input.lines ?? 50}`);
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
