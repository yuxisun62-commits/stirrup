/**
 * Stirrup Plugin: PostgreSQL
 * Node types: pg-query, pg-insert, pg-transaction
 * Tools: pg-run-query
 * Requires: pg (peer dependency)
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";

async function getPool(config: Record<string, unknown>) {
  const pg = await import("pg").catch(() => { throw new Error("pg is required: npm install pg"); });
  const Pool = pg.default?.Pool ?? (pg as any).Pool;
  return new Pool({
    connectionString: (config.connectionString as string) ?? process.env.DATABASE_URL,
    host: config.host as string,
    port: config.port as number,
    database: config.database as string,
    user: config.user as string,
    password: config.password as string,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
  });
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("pg-query", async (config, execCtx) => {
    const { query, params } = { ...execCtx.inputs, ...config } as {
      query: string; params?: unknown[];
    };
    const pool = await getPool(config);
    try {
      const result = await pool.query(query, params);
      return { rows: result.rows, rowCount: result.rowCount, fields: result.fields?.map((f: any) => f.name) };
    } finally {
      await pool.end();
    }
  });

  ctx.registerNodeType("pg-insert", async (config, execCtx) => {
    const { table, data } = { ...execCtx.inputs, ...config } as {
      table: string; data: Record<string, unknown> | Record<string, unknown>[];
    };
    const rows = Array.isArray(data) ? data : [data];
    if (rows.length === 0) return { inserted: 0 };

    const columns = Object.keys(rows[0]);
    const pool = await getPool(config);
    try {
      let inserted = 0;
      for (const row of rows) {
        const values = columns.map((c) => row[c]);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
        await pool.query(
          `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
          values
        );
        inserted++;
      }
      return { inserted, table };
    } finally {
      await pool.end();
    }
  });

  ctx.registerNodeType("pg-transaction", async (config, execCtx) => {
    const { queries } = { ...execCtx.inputs, ...config } as {
      queries: Array<{ sql: string; params?: unknown[] }>;
    };
    const pool = await getPool(config);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const results = [];
      for (const q of queries) {
        const result = await client.query(q.sql, q.params);
        results.push({ rowCount: result.rowCount, rows: result.rows });
      }
      await client.query("COMMIT");
      return { results, queryCount: queries.length };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
      await pool.end();
    }
  });

  ctx.registerTool({
    name: "pg-run-query",
    description: "Execute a SQL query against PostgreSQL",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "SQL query to execute" },
        params: { type: "array", description: "Query parameters" },
      },
      required: ["query"],
    },
    handler: async (input) => {
      const pool = await getPool({});
      try {
        const result = await pool.query(input.query as string, input.params as unknown[]);
        return { rows: result.rows?.slice(0, 100), rowCount: result.rowCount };
      } finally {
        await pool.end();
      }
    },
  });
}
