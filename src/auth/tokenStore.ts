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

export function getToken(service: string): StoredToken | null {
  const data = loadStore();
  const token = data.tokens[service];
  if (!token) return null;
  if (token.expiresAt && token.expiresAt < Date.now()) {
    return null;  // expired
  }
  return token;
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
