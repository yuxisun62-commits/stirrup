import { resolve } from "node:path";

/** Validate that a resolved path stays within a base directory */
export function assertPathContained(basePath: string, targetPath: string): void {
  const base = resolve(basePath);
  const target = resolve(targetPath);
  if (!target.startsWith(base + "/") && !target.startsWith(base + "\\") && target !== base) {
    throw new Error(`Path traversal blocked: target escapes base directory`);
  }
}

/** Validate an ID is safe for use in file paths (alphanumeric, hyphens, underscores) */
export function assertSafeId(id: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid ID: "${id}" — must be alphanumeric with hyphens/underscores only`);
  }
}

/** Validate a UUID format */
export function assertUuid(id: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`Invalid execution ID format: "${id}"`);
  }
}
