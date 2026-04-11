import { Router } from "express";
import { listTokens, removeToken, getToken } from "../../auth/tokenStore.js";
import { startGithubDeviceFlow, pollGithubDeviceFlow, getGithubUser } from "../../auth/github.js";
import { setToken } from "../../auth/tokenStore.js";

interface DeviceFlowSession {
  deviceCode: string;
  service: string;
  scope: string;
  expiresAt: number;
}

const activeFlows = new Map<string, DeviceFlowSession>();

// Services that support full OAuth device flow (no manual token needed)
const OAUTH_CAPABLE_SERVICES = new Set(["github"]);

// Documentation links for services that need a manual token
const TOKEN_DOCS: Record<string, { url: string; instructions: string }> = {
  slack: {
    url: "https://api.slack.com/authentication/token-types",
    instructions: "Create a Slack app at api.slack.com/apps and install it to your workspace to get a bot token (xoxb-...).",
  },
  launchmatic: {
    url: "https://app.launchmatic.io",
    instructions: "Install the LaunchMatic CLI (`npm i -g @launchmatic/cli`), run `lm login`, then create an API key with `lm api-key create stirrup` and paste the value here.",
  },
  jira: {
    url: "https://id.atlassian.com/manage-profile/security/api-tokens",
    instructions: "Create an API token from your Atlassian account settings.",
  },
  stripe: {
    url: "https://dashboard.stripe.com/apikeys",
    instructions: "Get a secret API key from your Stripe dashboard.",
  },
  hubspot: {
    url: "https://app.hubspot.com/private-apps",
    instructions: "Create a private app in HubSpot to generate an access token.",
  },
};

export function authRoutes(): Router {
  const router = Router();

  // Get info about a service's auth capabilities
  router.get("/services/:service", (req, res) => {
    const service = req.params.service;
    res.json({
      service,
      oauthSupported: OAUTH_CAPABLE_SERVICES.has(service),
      tokenDocsUrl: TOKEN_DOCS[service]?.url,
      tokenInstructions: TOKEN_DOCS[service]?.instructions,
    });
  });

  // List all known services and their capabilities
  router.get("/services", (_req, res) => {
    const services = [...new Set([...OAUTH_CAPABLE_SERVICES, ...Object.keys(TOKEN_DOCS)])];
    res.json({
      services: services.map((service) => ({
        service,
        oauthSupported: OAUTH_CAPABLE_SERVICES.has(service),
        tokenDocsUrl: TOKEN_DOCS[service]?.url,
        tokenInstructions: TOKEN_DOCS[service]?.instructions,
      })),
    });
  });

  // List authenticated services
  router.get("/status", (_req, res) => {
    const tokens = listTokens();
    const status: Record<string, { authenticated: boolean; userName?: string; userId?: string }> = {};
    for (const t of tokens) {
      status[t.service] = {
        authenticated: true,
        userName: t.userName,
        userId: t.userId,
      };
    }
    res.json({ services: status });
  });

  // Get token info for a specific service (without exposing the token itself)
  router.get("/status/:service", (req, res) => {
    const token = getToken(req.params.service);
    if (!token) {
      res.json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      userName: token.userName,
      userId: token.userId,
      service: token.service,
    });
  });

  // Start a device flow for a service
  router.post("/login/:service/start", async (req, res) => {
    const service = req.params.service;
    const scope = (req.body?.scope as string) ?? "repo read:org";

    if (service !== "github") {
      res.status(400).json({ error: { code: "UNSUPPORTED", message: `Service "${service}" not supported yet. Try: github` } });
      return;
    }

    try {
      const deviceCode = await startGithubDeviceFlow(scope);
      activeFlows.set(deviceCode.device_code, {
        deviceCode: deviceCode.device_code,
        service,
        scope,
        expiresAt: Date.now() + deviceCode.expires_in * 1000,
      });
      res.json({
        userCode: deviceCode.user_code,
        verificationUri: deviceCode.verification_uri,
        deviceCode: deviceCode.device_code,
        expiresIn: deviceCode.expires_in,
        interval: deviceCode.interval,
      });
    } catch (err) {
      res.status(500).json({ error: { code: "OAUTH_FAILED", message: (err as Error).message } });
    }
  });

  // Poll for completion of a device flow
  router.post("/login/:service/poll", async (req, res) => {
    const { deviceCode } = req.body as { deviceCode?: string };
    if (!deviceCode || !activeFlows.has(deviceCode)) {
      res.status(400).json({ error: { code: "INVALID_FLOW", message: "Unknown device code" } });
      return;
    }

    const session = activeFlows.get(deviceCode)!;
    if (Date.now() > session.expiresAt) {
      activeFlows.delete(deviceCode);
      res.status(410).json({ error: { code: "EXPIRED", message: "Device code expired" } });
      return;
    }

    try {
      // Single poll attempt — UI handles the polling loop
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: "178c6fc778ccc68e1d6a",
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });
      const data = await tokenRes.json() as { access_token?: string; error?: string };

      if (data.access_token) {
        const user = await getGithubUser(data.access_token);
        setToken(session.service, {
          accessToken: data.access_token,
          scope: session.scope,
          userId: String(user.id),
          userName: user.login,
        });
        activeFlows.delete(deviceCode);
        res.json({
          status: "completed",
          authenticated: true,
          userName: user.login,
        });
        return;
      }

      if (data.error === "authorization_pending") {
        res.json({ status: "pending" });
        return;
      }
      if (data.error === "slow_down") {
        res.json({ status: "pending", slowDown: true });
        return;
      }
      if (data.error === "expired_token") {
        activeFlows.delete(deviceCode);
        res.status(410).json({ error: { code: "EXPIRED", message: "Code expired" } });
        return;
      }
      if (data.error === "access_denied") {
        activeFlows.delete(deviceCode);
        res.status(403).json({ error: { code: "DENIED", message: "User denied access" } });
        return;
      }

      res.status(500).json({ error: { code: "OAUTH_ERROR", message: data.error ?? "unknown" } });
    } catch (err) {
      res.status(500).json({ error: { code: "POLL_FAILED", message: (err as Error).message } });
    }
  });

  // Save a manual token (for services without OAuth, or BYO tokens)
  router.post("/token/:service", (req, res) => {
    const service = req.params.service;
    const { token, userName } = req.body as { token?: string; userName?: string };
    if (!token || token.length < 8) {
      res.status(400).json({ error: { code: "INVALID_TOKEN", message: "Token is required and must be at least 8 characters" } });
      return;
    }
    setToken(service, {
      accessToken: token,
      userName: userName ?? undefined,
    });
    res.json({ saved: true, service, userName });
  });

  // Logout
  router.delete("/logout/:service", (req, res) => {
    const removed = removeToken(req.params.service);
    res.json({ removed });
  });

  return router;
}
