import type { Request, Response, NextFunction } from "express";

/**
 * Bearer token authentication middleware.
 * Reads token from STIRRUP_API_TOKEN env var or .stirrup.json config.
 * Skips auth for health check endpoint.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Health check is always public
  if (req.path === "/health") {
    next();
    return;
  }

  const apiToken = process.env.STIRRUP_API_TOKEN;

  // If no token configured, allow requests (local dev mode) but warn once
  if (!apiToken) {
    if (!(globalThis as any).__stirrupAuthWarned) {
      console.warn(
        "\n  WARNING: No STIRRUP_API_TOKEN set — API is unauthenticated.\n" +
        "  Set via: export STIRRUP_API_TOKEN=<token>\n" +
        "  Or: stirrup config set apiToken <token>\n"
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
