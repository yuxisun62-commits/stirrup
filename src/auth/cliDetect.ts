/**
 * Detect local CLI tools that already have credentials we can use.
 * Lets Stirrup leverage existing `lm login` / `gh auth login` sessions
 * instead of requiring users to manually paste tokens.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const execFileAsync = promisify(execFile);

export interface CliDetection {
  available: boolean;
  authenticated: boolean;
  user?: string;
  configPath?: string;
}

/** Check if a CLI command exists on PATH */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      await execFileAsync("where", [cmd]);
    } else {
      await execFileAsync("which", [cmd]);
    }
    return true;
  } catch {
    return false;
  }
}

/** Detect LaunchMatic CLI session */
export async function detectLaunchmaticCli(): Promise<CliDetection> {
  if (!(await commandExists("lm"))) return { available: false, authenticated: false };

  const configPath = resolve(homedir(), ".launchmatic", "config.json");
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.token || config.accessToken || config.user) {
        return {
          available: true,
          authenticated: true,
          user: config.user?.email ?? config.user?.username ?? config.user?.name,
          configPath,
        };
      }
    } catch { /* ignore */ }
  }

  // Fallback: try `lm whoami` (or similar) to verify
  try {
    const { stdout } = await execFileAsync("lm", ["whoami"], { timeout: 3000 });
    if (stdout && !stdout.toLowerCase().includes("not logged in")) {
      return { available: true, authenticated: true, user: stdout.trim(), configPath };
    }
  } catch { /* ignore */ }

  return { available: true, authenticated: false, configPath };
}

function extractToken(output: string): string | null {
  const patterns = [
    /\b(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/,
    /\b(lm_[A-Za-z0-9_-]{20,})\b/,
    /\b([A-Za-z0-9_-]{32,})\b/,
  ];
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/** Use the local LaunchMatic CLI to create a new API key (or reuse existing) */
export async function createLaunchmaticApiKey(name: string = "stirrup"): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("lm", ["api-key", "create", name], { timeout: 10000 });
    const output = (stdout + stderr).trim();
    const token = extractToken(output);
    if (token) return token;
    throw new Error(`Could not parse API key from CLI output: ${output.slice(0, 200)}`);
  } catch (err) {
    const msg = (err as Error).message;
    // If the key with this name already exists, try to rotate it
    if (msg.toLowerCase().includes("already exists") || msg.toLowerCase().includes("duplicate")) {
      try {
        // Delete the existing one and recreate
        await execFileAsync("lm", ["api-key", "delete", name], { timeout: 10000 });
        const { stdout, stderr } = await execFileAsync("lm", ["api-key", "create", name], { timeout: 10000 });
        const output = (stdout + stderr).trim();
        const token = extractToken(output);
        if (token) return token;
      } catch { /* fall through */ }
    }
    if (msg.includes("Could not parse")) throw err;
    throw new Error(`Failed to create API key via lm CLI: ${msg}`);
  }
}

/** Detect GitHub CLI session */
export async function detectGithubCli(): Promise<CliDetection> {
  if (!(await commandExists("gh"))) return { available: false, authenticated: false };

  try {
    const { stdout, stderr } = await execFileAsync("gh", ["auth", "status"], { timeout: 3000 });
    const output = stdout + stderr;
    if (output.includes("Logged in to github.com")) {
      const userMatch = output.match(/account (\w+)/);
      return {
        available: true,
        authenticated: true,
        user: userMatch?.[1],
      };
    }
  } catch { /* gh auth status returns non-zero when not authenticated */ }

  return { available: true, authenticated: false };
}

/** Get the GitHub token from `gh` CLI */
export async function getGithubCliToken(): Promise<string> {
  const { stdout } = await execFileAsync("gh", ["auth", "token"], { timeout: 3000 });
  const token = stdout.trim();
  if (!token) throw new Error("gh auth token returned empty");
  return token;
}

/** Detect Stripe CLI session */
export async function detectStripeCli(): Promise<CliDetection> {
  if (!(await commandExists("stripe"))) return { available: false, authenticated: false };

  // Stripe stores keys in ~/.config/stripe/config.toml on Linux/Mac
  // Windows: %APPDATA%/stripe/config.toml
  const candidates = [
    resolve(homedir(), ".config", "stripe", "config.toml"),
    process.platform === "win32" && process.env.APPDATA
      ? resolve(process.env.APPDATA, "stripe", "config.toml")
      : null,
  ].filter(Boolean) as string[];

  const configPath = candidates.find((p) => existsSync(p));
  if (!configPath) return { available: true, authenticated: false };

  return { available: true, authenticated: true, configPath };
}

/** Get a Stripe API key via the CLI */
export async function getStripeCliToken(): Promise<string> {
  // `stripe config --list` includes the test_mode_api_key etc.
  try {
    const { stdout } = await execFileAsync("stripe", ["config", "--list"], { timeout: 3000 });
    // Look for test_mode_api_key or live_mode_api_key (prefer live if both)
    const liveMatch = stdout.match(/live_mode_api_key\s*=\s*(['"]?)([^'"\n]+)\1/);
    const testMatch = stdout.match(/test_mode_api_key\s*=\s*(['"]?)([^'"\n]+)\1/);
    const token = liveMatch?.[2] ?? testMatch?.[2];
    if (!token) throw new Error("No API key found in stripe CLI config");
    return token.trim();
  } catch (err) {
    throw new Error(`Failed to get Stripe key from CLI: ${(err as Error).message}`);
  }
}

/** Detect AWS CLI credentials */
export async function detectAwsCli(): Promise<CliDetection> {
  // Check for credentials file (works without aws CLI installed)
  const credPath = resolve(homedir(), ".aws", "credentials");
  if (existsSync(credPath)) {
    try {
      const content = readFileSync(credPath, "utf-8");
      const profileMatch = content.match(/^\[(\w+)\]/m);
      return {
        available: true,
        authenticated: content.includes("aws_access_key_id"),
        user: profileMatch?.[1] ?? "default",
        configPath: credPath,
      };
    } catch { /* ignore */ }
  }
  return { available: await commandExists("aws"), authenticated: false };
}

/** Read the default AWS access key from the credentials file */
export async function getAwsCliCredentials(): Promise<string> {
  const credPath = resolve(homedir(), ".aws", "credentials");
  if (!existsSync(credPath)) throw new Error("No AWS credentials file at ~/.aws/credentials");
  const content = readFileSync(credPath, "utf-8");

  // Parse the [default] section's aws_access_key_id and aws_secret_access_key
  const sections = content.split(/^\[/m).slice(1);
  for (const section of sections) {
    if (!section.startsWith("default]")) continue;
    const keyMatch = section.match(/aws_access_key_id\s*=\s*(\S+)/);
    const secretMatch = section.match(/aws_secret_access_key\s*=\s*(\S+)/);
    if (keyMatch && secretMatch) {
      // Return as JSON since AWS needs both
      return JSON.stringify({ accessKeyId: keyMatch[1], secretAccessKey: secretMatch[1] });
    }
  }
  throw new Error("Could not find default AWS credentials");
}

/** Detect gcloud CLI session */
export async function detectGcloudCli(): Promise<CliDetection> {
  if (!(await commandExists("gcloud"))) return { available: false, authenticated: false };

  try {
    const { stdout } = await execFileAsync("gcloud", ["auth", "list", "--format=value(account)"], { timeout: 3000 });
    const account = stdout.trim();
    if (account) {
      return { available: true, authenticated: true, user: account };
    }
  } catch { /* ignore */ }

  return { available: true, authenticated: false };
}

/** Get a fresh gcloud access token */
export async function getGcloudToken(): Promise<string> {
  const { stdout } = await execFileAsync("gcloud", ["auth", "print-access-token"], { timeout: 5000 });
  const token = stdout.trim();
  if (!token) throw new Error("gcloud returned empty token");
  return token;
}
