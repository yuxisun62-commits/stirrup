/**
 * Stirrup Plugin: HTTP Auth
 * Node types: oauth-token, api-key-request, jwt-decode, basic-auth-request
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("oauth-token", async (config, execCtx) => {
    const {
      tokenUrl, clientId, clientSecret, grantType, scope, username, password, refreshToken,
    } = { ...execCtx.inputs, ...config } as {
      tokenUrl: string; clientId: string; clientSecret: string;
      grantType?: string; scope?: string; username?: string; password?: string;
      refreshToken?: string;
    };

    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: grantType ?? "client_credentials",
    });
    if (scope) params.set("scope", scope);
    if (username) params.set("username", username);
    if (password) params.set("password", password);
    if (refreshToken) params.set("refresh_token", refreshToken);

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) throw new Error(`OAuth error ${res.status}: ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;

    return {
      accessToken: data.access_token,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
      refreshToken: data.refresh_token,
      scope: data.scope,
    };
  });

  ctx.registerNodeType("api-key-request", async (config, execCtx) => {
    const {
      url, method, apiKey, keyHeader, keyParam, body, headers: customHeaders,
    } = { ...execCtx.inputs, ...config } as {
      url: string; method?: string; apiKey: string;
      keyHeader?: string; keyParam?: string;
      body?: unknown; headers?: Record<string, string>;
    };

    let finalUrl = url;
    const hdrs: Record<string, string> = { "Content-Type": "application/json", ...customHeaders };

    if (keyParam) {
      const separator = url.includes("?") ? "&" : "?";
      finalUrl = `${url}${separator}${keyParam}=${apiKey}`;
    } else {
      hdrs[keyHeader ?? "X-API-Key"] = apiKey;
    }

    const res = await fetch(finalUrl, {
      method: method ?? "GET",
      headers: hdrs,
      body: body && method !== "GET" ? JSON.stringify(body) : undefined,
    });

    const contentType = res.headers.get("content-type") ?? "";
    const responseBody = contentType.includes("json") ? await res.json() : await res.text();

    return { status: res.status, body: responseBody };
  });

  ctx.registerNodeType("jwt-decode", async (config, execCtx) => {
    const { token } = { ...execCtx.inputs, ...config } as { token: string };

    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid JWT format");

    const decode = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString());
    const header = decode(parts[0]);
    const payload = decode(parts[1]);

    return {
      header,
      payload,
      isExpired: payload.exp ? Date.now() / 1000 > payload.exp : undefined,
      expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : undefined,
      issuer: payload.iss,
      subject: payload.sub,
    };
  });

  ctx.registerNodeType("basic-auth-request", async (config, execCtx) => {
    const { url, method, username, password, body } = { ...execCtx.inputs, ...config } as {
      url: string; method?: string; username: string; password: string; body?: unknown;
    };

    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    const res = await fetch(url, {
      method: method ?? "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: body && method !== "GET" ? JSON.stringify(body) : undefined,
    });

    const contentType = res.headers.get("content-type") ?? "";
    const responseBody = contentType.includes("json") ? await res.json() : await res.text();

    return { status: res.status, body: responseBody };
  });
}
