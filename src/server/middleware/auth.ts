import type { Request, Response, NextFunction } from "express";

/**
 * Bearer token authentication middleware.
 * Reads token from STIRRUP_API_TOKEN env var or .stirrup.json config.
 * Skips auth for health check endpoint and same-origin requests from localhost.
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
    const isLocalhost =
      req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1" ||
      req.hostname === "localhost" || req.hostname === "127.0.0.1";

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
