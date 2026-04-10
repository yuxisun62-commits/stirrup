import type { Request, Response, NextFunction } from "express";

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  // Log full error server-side, return generic message to clients
  console.error("Server error:", err.message, err.stack);
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An internal error occurred",
    },
  });
}
