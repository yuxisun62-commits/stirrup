/**
 * GitHub OAuth device flow.
 * Uses the public GitHub CLI client ID — no secret needed for device flow.
 * Saves the token via the token store.
 */
import { setToken } from "./tokenStore.js";

// GitHub CLI's public client ID (Device Flow enabled, no secret required).
// Exported so other modules (e.g., src/server/routes/auth.ts) can reference
// a single source of truth instead of hardcoding the string.
export const GH_CLIENT_ID = "178c6fc778ccc68e1d6a";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** Start GitHub OAuth device flow */
export async function startGithubDeviceFlow(scope: string = "repo read:org"): Promise<DeviceCodeResponse> {
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: GH_CLIENT_ID, scope }),
  });
  if (!res.ok) throw new Error(`GitHub device flow failed: ${res.status}`);
  return (await res.json()) as DeviceCodeResponse;
}

/** Poll for the access token. Resolves when the user completes the flow. */
export async function pollGithubDeviceFlow(
  deviceCode: string,
  intervalSec: number,
  onProgress?: (status: string) => void
): Promise<string> {
  let delay = intervalSec * 1000;
  const maxAttempts = 180; // ~15 min at 5s interval

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, delay));

    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: GH_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data = (await res.json()) as TokenResponse;

    if (data.access_token) {
      return data.access_token;
    }

    if (data.error === "authorization_pending") {
      onProgress?.("waiting for authorization...");
      continue;
    }
    if (data.error === "slow_down") {
      delay += 5000;
      continue;
    }
    if (data.error === "expired_token") {
      throw new Error("Device code expired. Try again.");
    }
    if (data.error === "access_denied") {
      throw new Error("Authorization denied by user.");
    }

    throw new Error(`GitHub OAuth error: ${data.error_description ?? data.error ?? "unknown"}`);
  }

  throw new Error("GitHub OAuth timed out");
}

/** Fetch the authenticated user info */
export async function getGithubUser(token: string): Promise<{ login: string; id: number; name?: string }> {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch GitHub user: ${res.status}`);
  return await res.json() as { login: string; id: number; name?: string };
}

/** Complete the full flow and save the token */
export async function authenticateGithub(
  scope: string,
  onDeviceCode: (code: DeviceCodeResponse) => void,
  onProgress?: (status: string) => void
): Promise<{ token: string; user: { login: string; id: number } }> {
  const deviceCode = await startGithubDeviceFlow(scope);
  onDeviceCode(deviceCode);

  const token = await pollGithubDeviceFlow(deviceCode.device_code, deviceCode.interval, onProgress);
  const user = await getGithubUser(token);

  setToken("github", {
    accessToken: token,
    scope,
    userId: String(user.id),
    userName: user.login,
  });

  return { token, user };
}
