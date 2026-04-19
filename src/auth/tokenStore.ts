import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";

/**
 * Local OAuth token store — ~/.stirrup/tokens.json
 * Stores tokens per service with metadata.
 * File is created with 0600 permissions.
 */

export interface StoredToken {
  service: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;  // epoch ms
  scope?: string;
  userId?: string;
  userName?: string;
  savedAt: number;
}

interface TokenStoreData {
  tokens: Record<string, StoredToken>;
}

function getTokenStorePath(): string {
  return resolve(homedir(), ".stirrup", "tokens.json");
}

function loadStore(): TokenStoreData {
  const path = getTokenStorePath();
  if (!existsSync(path)) return { tokens: {} };
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return { tokens: {} };
  }
}

function saveStore(data: TokenStoreData): void {
  const path = getTokenStorePath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
}

export function setToken(service: string, token: Omit<StoredToken, "service" | "savedAt">): void {
  const data = loadStore();
  data.tokens[service] = {
    service,
    savedAt: Date.now(),
    ...token,
  };
  saveStore(data);
}

/**
 * Well-known environment variable names per service. When the token store
 * has no entry for a service, we check these as a fallback. This bridges
 * the gap between "user set ANTHROPIC_API_KEY in their shell profile" and
 * "workflow param declares service: anthropic" — without the user having
 * to paste the same key into the Connections panel.
 *
 * Add entries here as new services are registered. The order within each
 * array matters: the first env var that's set wins.
 */
const ENV_FALLBACKS: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  // Only use the unambiguous GEMINI_API_KEY. GOOGLE_API_KEY is commonly set
  // for other Google services (Maps, Places, Cloud APIs) and using it as a
  // Gemini fallback could surprise users with scoped keys that get routed to
  // the wrong endpoint.
  gemini: ["GEMINI_API_KEY"],
  replicate: ["REPLICATE_API_TOKEN"],
  github: ["GITHUB_TOKEN", "GH_TOKEN"],
  slack: ["SLACK_BOT_TOKEN", "SLACK_TOKEN"],
  stripe: ["STRIPE_SECRET_KEY", "STRIPE_API_KEY"],
  launchmatic: ["LAUNCHMATIC_TOKEN", "LM_TOKEN"],
  linkedin: ["LINKEDIN_ACCESS_TOKEN"],
  typefully: ["TYPEFULLY_API_KEY"],
  buffer: ["BUFFER_ACCESS_TOKEN"],
  telegram: ["TELEGRAM_BOT_TOKEN"],
  gmail: ["GMAIL_ACCESS_TOKEN", "GOOGLE_ACCESS_TOKEN"],
  google: ["GOOGLE_ACCESS_TOKEN"],
  discord: ["DISCORD_BOT_TOKEN"],
  sendgrid: ["SENDGRID_API_KEY"],
  // Twilio creds travel as "<AccountSID>:<AuthToken>" — see plugins/public/twilio.ts.
  // We accept either the combined form (TWILIO_CREDENTIALS) or assemble from the
  // split env vars that Twilio's own docs recommend.
  twilio: ["TWILIO_CREDENTIALS"],
  "google-sheets": ["GOOGLE_ACCESS_TOKEN", "SHEETS_ACCESS_TOKEN"],
  sheets: ["GOOGLE_ACCESS_TOKEN", "SHEETS_ACCESS_TOKEN"],
  notion: ["NOTION_TOKEN", "NOTION_API_KEY"],
  airtable: ["AIRTABLE_TOKEN", "AIRTABLE_API_KEY"],
  linear: ["LINEAR_API_KEY"],
  // Jira creds are "<email>:<apiToken>" — same pattern as Twilio.
  jira: ["JIRA_CREDENTIALS"],
};

export function getToken(service: string): StoredToken | null {
  // 1. Check the persistent token store (~/.stirrup/tokens.json)
  const data = loadStore();
  const token = data.tokens[service];
  if (token) {
    if (token.expiresAt && token.expiresAt < Date.now()) {
      return null;  // expired
    }
    return token;
  }

  // 2. Fall back to well-known environment variables. This lets users who
  //    already have ANTHROPIC_API_KEY (or similar) in their shell profile
  //    skip the Connections panel paste step entirely — the engine's token
  //    injection will pick this up and forward it to the workflow context.
  const envNames = ENV_FALLBACKS[service];
  if (envNames) {
    for (const envName of envNames) {
      const value = process.env[envName];
      if (value) {
        return {
          service,
          accessToken: value,
          savedAt: 0, // sentinel: not persisted, read from env
        };
      }
    }
  }

  return null;
}

export function listTokens(): StoredToken[] {
  return Object.values(loadStore().tokens);
}

export function removeToken(service: string): boolean {
  const data = loadStore();
  if (!data.tokens[service]) return false;
  delete data.tokens[service];
  saveStore(data);
  return true;
}

export function getTokenStoreLocation(): string {
  return getTokenStorePath();
}
