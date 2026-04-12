import type { Request, Response, NextFunction } from "express";

/**
 * Bearer token authentication middleware.
 * Reads token from STIRRUP_API_TOKEN env var or .stirrup.json config.
 * Skips auth for health check endpoint and requests from localhost.
 *
 * Security note: the localhost check uses ONLY `req.ip`, not `req.hostname`.
 * Express derives `req.hostname` from the HTTP Host header, which is
 * attacker-controlled — a DNS-rebinding attacker can trivially send a
 * request with `Host: localhost` and bypass the check. `req.ip` comes from
 * the socket address and cannot be spoofed without network access.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Health check is always public
  if (req.path === "/health") {
    next();
    return;
  }

  const apiToken = process.env.STIRRUP_API_TOKEN;

  // If no token configured: allow requests silently for localhost, warn for external
  if (!apiToken) {
    // Socket-level check only. Do NOT trust req.hostname (Host header).
    const isLocalhost =
      req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";

    if (!isLocalhost && !(globalThis as any).__stirrupAuthWarned) {
      console.warn(
        "\n  WARNING: API is exposed without authentication on a non-localhost address.\n" +
        "  For production use, set STIRRUP_API_TOKEN or run: stirrup config set apiToken <token>\n"
      );
      (globalThis as any).__stirrupAuthWarned = true;
    }
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Bearer token required" } });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== apiToken) {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "Invalid token" } });
    return;
  }

  next();
}

/**
 * DNS rebinding protection. Rejects requests where the Host header doesn't
 * match an allowlist of expected hostnames. Applies to all routes, including
 * the ones that pass the authMiddleware's localhost check above.
 *
 * DNS rebinding attack: attacker.com resolves to their own IP briefly, the
 * user visits it, the page stays open, DNS TTL expires, attacker flips the
 * DNS to 127.0.0.1, the page now makes requests to localhost but with
 * `Host: attacker.com`. Without this middleware, the request passes the
 * socket-level localhost check and hits Stirrup's API.
 */
const ALLOWED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
]);

export function hostCheckMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Health check is always public
  if (req.path === "/health") {
    next();
    return;
  }

  const host = req.headers.host;
  if (!host) {
    next();
    return;
  }

  // Strip port so the check is port-agnostic
  const hostname = host.split(":")[0];
  const bracketed = host.startsWith("[") ? host.split("]")[0] + "]" : null;
  const check = bracketed ?? hostname;

  // Allow the configured STIRRUP_HOST as well if set
  const configuredHost = process.env.STIRRUP_HOST;
  if (configuredHost && check === configuredHost) {
    next();
    return;
  }

  if (!ALLOWED_HOSTS.has(check)) {
    res.status(403).json({
      error: {
        code: "FORBIDDEN_HOST",
        message: `Host header ${JSON.stringify(host)} not in allowlist. Set STIRRUP_HOST to allow a custom hostname.`,
      },
    });
    return;
  }

  next();
}

/**
 * CSRF protection for state-changing /api/auth routes. Rejects cross-origin
 * requests that could be fired by a malicious webpage to abuse endpoints
 * like /api/auth/cli-login/:service (which spawns subprocesses).
 *
 * Apply this in addition to authMiddleware on endpoints that change state
 * — it checks the Origin/Referer header against an allowlist. Same-origin
 * requests from the Stirrup UI always pass because their Origin matches the
 * Stirrup server's own address.
 *
 * Why not a CSRF token: an Origin check is simpler, stateless, and covers
 * the real attack vector (malicious webpage → fetch to localhost). Browsers
 * set Origin on all cross-origin state-changing requests; it cannot be
 * forged from JavaScript.
 */
export function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Only gate mutation methods
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }

  const origin = req.headers.origin;
  const referer = req.headers.referer;

  // No Origin AND no Referer = not from a browser (curl, server-to-server, etc.).
  // Allow these because the CSRF threat model is "malicious webpage in user's
  // browser fires a request" — not "attacker with shell access runs curl".
  if (!origin && !referer) {
    next();
    return;
  }

  const expectedOrigin = process.env.STIRRUP_CORS_ORIGIN ?? "http://localhost:3710";

  const checkOrigin = (value: string | undefined): boolean => {
    if (!value) return false;
    try {
      const url = new URL(value);
      const origin = `${url.protocol}//${url.host}`;
      return origin === expectedOrigin;
    } catch {
      return false;
    }
  };

  // Origin header is more reliable than Referer; prefer it when present.
  if (origin) {
    if (!checkOrigin(origin)) {
      res.status(403).json({
        error: {
          code: "CSRF_BLOCKED",
          message: `Cross-origin request from ${origin} blocked. Expected origin: ${expectedOrigin}.`,
        },
      });
      return;
    }
  } else if (referer && !checkOrigin(referer)) {
    res.status(403).json({
      error: {
        code: "CSRF_BLOCKED",
        message: `Referer ${referer} not from an allowed origin. Expected: ${expectedOrigin}.`,
      },
    });
    return;
  }

  next();
}
