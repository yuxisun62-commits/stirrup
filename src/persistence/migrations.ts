import type Database from "better-sqlite3";

const migrations: Record<number, (db: Database.Database) => void> = {
  1: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS executions (
        id              TEXT PRIMARY KEY,
        workflow_id     TEXT NOT NULL,
        status          TEXT NOT NULL CHECK(status IN ('pending','running','paused','completed','failed')),
        context         TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_executions_workflow_id ON executions(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);

      CREATE TABLE IF NOT EXISTS steps (
        execution_id    TEXT NOT NULL,
        node_id         TEXT NOT NULL,
        status          TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed','skipped')),
        outputs         TEXT NOT NULL DEFAULT '{}',
        error           TEXT,
        started_at      TEXT NOT NULL,
        completed_at    TEXT,
        attempts        INTEGER NOT NULL DEFAULT 0,
        selected_branch TEXT,
        PRIMARY KEY (execution_id, node_id),
        FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );

      INSERT INTO schema_version (version) VALUES (1);
    `);
  },
};

export function runMigrations(db: Database.Database): void {
  const hasVersionTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
  ).get();

  let currentVersion = 0;
  if (hasVersionTable) {
    const row = db.prepare("SELECT MAX(version) as version FROM schema_version").get() as
      | { version: number | null }
      | undefined;
    currentVersion = row?.version ?? 0;
  }

  const versions = Object.keys(migrations)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((v) => v > currentVersion);

  for (const version of versions) {
    db.transaction(() => {
      migrations[version](db);
    })();
  }
}
