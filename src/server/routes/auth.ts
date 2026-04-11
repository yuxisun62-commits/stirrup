import { Router } from "express";
import { listTokens, removeToken, getToken, getTokenStoreLocation } from "../../auth/tokenStore.js";
import { startGithubDeviceFlow, getGithubUser } from "../../auth/github.js";
import { setToken } from "../../auth/tokenStore.js";
import {
  detectLaunchmaticCli, createLaunchmaticApiKey,
  detectGithubCli, getGithubCliToken,
  detectStripeCli, getStripeCliToken,
  detectAwsCli, getAwsCliCredentials,
  detectGcloudCli, getGcloudToken,
  spawnCliLogin,
} from "../../auth/cliDetect.js";

interface DeviceFlowSession {
  deviceCode: string;
  service: string;
  scope: string;
  expiresAt: number;
}

const activeFlows = new Map<string, DeviceFlowSession>();

/** In-memory cache of the user's GitHub repo list. Refreshed every 60s. */
interface GithubRepoCacheEntry {
  repos: Array<{
    fullName: string;
    name: string;
    owner: string;
    private: boolean;
    description: string | null;
    updatedAt: string;
    defaultBranch: string;
  }>;
  fetchedAt: number;
}
const REPO_CACHE_TTL_MS = 60 * 1000;
const githubRepoCache = new Map<string, GithubRepoCacheEntry>();

// Services that support full OAuth device flow (no manual token needed)
const OAUTH_CAPABLE_SERVICES = new Set(["github"]);

// Map service → CLI name for auto-detection
const CLI_TOOLS: Record<string, { cli: string; cmd?: string }> = {
  github: { cli: "gh", cmd: "gh auth login" },
  launchmatic: { cli: "lm", cmd: "npm i -g @launchmatic/cli && lm login" },
  stripe: { cli: "stripe", cmd: "stripe login" },
  aws: { cli: "aws", cmd: "aws configure" },
  gcloud: { cli: "gcloud", cmd: "gcloud auth login" },
};

/** Detect if a service has a local CLI session */
async function detectServiceCli(service: string) {
  switch (service) {
    case "launchmatic": return await detectLaunchmaticCli();
    case "github": return await detectGithubCli();
    case "stripe": return await detectStripeCli();
    case "aws": return await detectAwsCli();
    case "gcloud": return await detectGcloudCli();
    default: return { available: false, authenticated: false };
  }
}

/** Connect using a local CLI session */
async function connectViaCli(service: string): Promise<{ userName?: string } | null> {
  switch (service) {
    case "launchmatic": {
      const apiKey = await createLaunchmaticApiKey("stirrup");
      const detection = await detectLaunchmaticCli();
      setToken(service, { accessToken: apiKey, userName: detection.user });
      return { userName: detection.user };
    }
    case "github": {
      const token = await getGithubCliToken();
      const user = await getGithubUser(token);
      setToken(service, {
        accessToken: token,
        userName: user.login,
        userId: String(user.id),
      });
      return { userName: user.login };
    }
    case "stripe": {
      const token = await getStripeCliToken();
      setToken(service, { accessToken: token });
      return {};
    }
    case "aws": {
      const creds = await getAwsCliCredentials();
      const detection = await detectAwsCli();
      setToken(service, { accessToken: creds, userName: detection.user });
      return { userName: detection.user };
    }
    case "gcloud": {
      const token = await getGcloudToken();
      const detection = await detectGcloudCli();
      setToken(service, { accessToken: token, userName: detection.user });
      return { userName: detection.user };
    }
    default: return null;
  }
}

/**
 * Services whose CLI ships an interactive `<cli> login` command.
 * For these we can spawn the CLI's own OAuth flow (which already knows how to
 * talk to the third party — typically via GitHub OAuth in the case of lm) and
 * then harvest the resulting credentials. The user only needs to be logged
 * into github.com in their browser; the CLI handles everything else.
 */
const CLI_LOGIN_PROVIDERS: Record<
  string,
  {
    cli: string;
    args?: string[];
    /** Called after `<cli> login` exits successfully. Should save the token. */
    afterLogin: () => Promise<{ userName?: string }>;
  }
> = {
  launchmatic: {
    cli: "lm",
    args: ["login"],
    afterLogin: async () => {
      const apiKey = await createLaunchmaticApiKey("stirrup");
      const detection = await detectLaunchmaticCli();
      setToken("launchmatic", { accessToken: apiKey, userName: detection.user });
      return { userName: detection.user };
    },
  },
  github: {
    cli: "gh",
    args: ["auth", "login", "--web", "--git-protocol", "https"],
    afterLogin: async () => {
      const token = await getGithubCliToken();
      const user = await getGithubUser(token);
      setToken("github", {
        accessToken: token,
        userName: user.login,
        userId: String(user.id),
      });
      return { userName: user.login };
    },
  },
};

// Documentation links for services that need a manual token
const TOKEN_DOCS: Record<string, { url: string; instructions: string }> = {
  slack: {
    url: "https://api.slack.com/authentication/token-types",
    instructions: "Create a Slack app at api.slack.com/apps and install it to your workspace to get a bot token (xoxb-...).",
  },
  launchmatic: {
    url: "https://app.launchmatic.io",
    instructions: "Install the Launchmatic CLI (`npm i -g @launchmatic/cli`), run `lm login`, then create an API key with `lm api-key create stirrup` and paste the value here.",
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
  typefully: {
    url: "https://typefully.com/settings/integrations",
    instructions: "Open Typefully → Settings → Integrations → API Keys, then create a key and paste it here. Powers the typefully-create-draft node for X/Twitter threads and LinkedIn posts.",
  },
  buffer: {
    url: "https://publish.buffer.com/account/apps",
    instructions: "Open Buffer → Account → Apps & Extras → API Access. Create an access token and paste it here. Powers the buffer-schedule node for LinkedIn, Facebook, Instagram, and Threads.",
  },
  replicate: {
    url: "https://replicate.com/account/api-tokens",
    instructions: "Open Replicate → Account → API Tokens, create a token, and paste it here. Powers the replicate-image node (Flux, SDXL) and the generic replicate-run node for any hosted model.",
  },
  linkedin: {
    url: "https://www.linkedin.com/developers/apps",
    instructions: "Create a LinkedIn Developer App at linkedin.com/developers/apps. Request the 'Share on LinkedIn' and 'Sign In with LinkedIn using OpenID Connect' products, then run the OAuth auth code flow (LinkedIn doesn't support device flow) with scopes `w_member_social r_liteprofile` to get an access token. Paste that token here. Tokens are long-lived (~60 days) and can be refreshed via the same flow.",
  },
  anthropic: {
    url: "https://console.anthropic.com/settings/keys",
    instructions: "Open the Anthropic Console → API Keys → Create Key. Paste the resulting `sk-ant-...` key here. Stirrup uses this for every AI node (llm-prompt, agent-tool-use, decision-routing, code-generation) and for deploy workflows that package AI nodes into standalone services.",
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
      cliTool: CLI_TOOLS[service]?.cli,
      cliCommand: CLI_TOOLS[service]?.cmd,
    });
  });

  // List all known services and their capabilities
  router.get("/services", (_req, res) => {
    const services = [...new Set([...OAUTH_CAPABLE_SERVICES, ...Object.keys(TOKEN_DOCS), ...Object.keys(CLI_TOOLS)])];
    res.json({
      services: services.map((service) => ({
        service,
        oauthSupported: OAUTH_CAPABLE_SERVICES.has(service),
        tokenDocsUrl: TOKEN_DOCS[service]?.url,
        tokenInstructions: TOKEN_DOCS[service]?.instructions,
        cliTool: CLI_TOOLS[service]?.cli,
        cliCommand: CLI_TOOLS[service]?.cmd,
      })),
    });
  });

  // Detect local CLI sessions for a service
  router.get("/cli-detect/:service", async (req, res) => {
    const service = req.params.service;
    try {
      const detection = await detectServiceCli(service);
      res.json({ service, ...detection });
    } catch (err) {
      res.status(500).json({ error: { code: "DETECT_FAILED", message: (err as Error).message } });
    }
  });

  // Auto-create credentials using a detected local CLI session
  router.post("/cli-connect/:service", async (req, res) => {
    const service = req.params.service;
    try {
      const result = await connectViaCli(service);
      if (!result) {
        res.status(400).json({ error: { code: "UNSUPPORTED", message: `CLI auto-connect not supported for ${service}` } });
        return;
      }
      res.json({ saved: true, service, userName: result.userName });
    } catch (err) {
      res.status(500).json({ error: { code: "CLI_CONNECT_FAILED", message: (err as Error).message } });
    }
  });

  /**
   * Trigger an interactive browser login via the service's CLI tool.
   *
   * Spawns e.g. `lm login`, which opens the user's browser and runs its own
   * localhost callback. If the user is already signed into GitHub (which
   * Stirrup's own GitHub OAuth guarantees), this is typically a one-click flow:
   * the user just clicks "Authorize" on Launchmatic's page and the CLI captures
   * the resulting session.
   *
   * After the CLI exits successfully we run the provider's `afterLogin` step
   * (e.g. `lm api-key create stirrup`) and persist the resulting token.
   *
   * This is a long-poll endpoint — it will not respond until the CLI exits or
   * the timeout fires. The UI shows a "Waiting for browser login..." spinner.
   */
  router.post("/cli-login/:service", async (req, res) => {
    const service = req.params.service;
    const provider = CLI_LOGIN_PROVIDERS[service];
    if (!provider) {
      res.status(400).json({
        error: {
          code: "UNSUPPORTED",
          message: `CLI login flow not supported for ${service}. Supported: ${Object.keys(CLI_LOGIN_PROVIDERS).join(", ")}`,
        },
      });
      return;
    }

    try {
      const result = await spawnCliLogin(provider.cli, provider.args);
      if (!result.success) {
        const detail = (result.stderr || result.stdout || "").trim().slice(0, 500);
        res.status(500).json({
          error: {
            code: "CLI_LOGIN_FAILED",
            message: `${provider.cli} ${(provider.args ?? ["login"]).join(" ")} exited with code ${result.exitCode}${detail ? `: ${detail}` : ""}`,
          },
        });
        return;
      }

      const after = await provider.afterLogin();
      res.json({ saved: true, service, userName: after.userName });
    } catch (err) {
      res.status(500).json({ error: { code: "CLI_LOGIN_FAILED", message: (err as Error).message } });
    }
  });

  /**
   * List the authenticated user's GitHub repos. Powers the github-repo
   * picker in the Run Workflow dialog so users can pick a repo from a
   * dropdown instead of typing "owner/name" by hand.
   *
   * Uses the stored GitHub OAuth token. Caches in-memory for 60s to avoid
   * burning the user's API rate limit on every dialog open.
   *
   * Returns up to 100 repos sorted by most recently updated. If you have
   * more than 100, search by typing — we don't paginate (yet).
   */
  router.get("/github/repos", async (_req, res) => {
    const stored = getToken("github");
    if (!stored) {
      res.status(401).json({
        error: { code: "NOT_AUTHENTICATED", message: "Connect GitHub first via the Connections panel." },
      });
      return;
    }

    // Cache key includes the userId so multiple users on the same install don't see each other's repos
    const cacheKey = stored.userId ?? "default";
    const cached = githubRepoCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < REPO_CACHE_TTL_MS) {
      res.json({ repos: cached.repos, cached: true });
      return;
    }

    try {
      const ghRes = await fetch(
        "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
        {
          headers: {
            Authorization: `Bearer ${stored.accessToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Stirrup",
          },
        },
      );
      if (!ghRes.ok) {
        const body = await ghRes.text().catch(() => "");
        res.status(ghRes.status).json({
          error: {
            code: "GITHUB_API_ERROR",
            message: `GitHub API ${ghRes.status}: ${body.slice(0, 300)}`,
          },
        });
        return;
      }
      const raw = (await ghRes.json()) as Array<{
        full_name: string;
        name: string;
        owner: { login: string };
        private: boolean;
        description: string | null;
        updated_at: string;
        default_branch: string;
      }>;
      const repos = raw.map((r) => ({
        fullName: r.full_name,
        name: r.name,
        owner: r.owner.login,
        private: r.private,
        description: r.description,
        updatedAt: r.updated_at,
        defaultBranch: r.default_branch,
      }));
      githubRepoCache.set(cacheKey, { repos, fetchedAt: Date.now() });
      res.json({ repos, cached: false });
    } catch (err) {
      res.status(500).json({ error: { code: "REPO_FETCH_FAILED", message: (err as Error).message } });
    }
  });

  // List authenticated services
  router.get("/status", (_req, res) => {
    const tokens = listTokens();
    const status: Record<string, { authenticated: boolean; userName?: string; userId?: string; savedAt?: number }> = {};
    for (const t of tokens) {
      status[t.service] = {
        authenticated: true,
        userName: t.userName,
        userId: t.userId,
        savedAt: t.savedAt,
      };
    }
    res.json({
      services: status,
      storeLocation: getTokenStoreLocation(),
    });
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
