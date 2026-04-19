/**
 * Stirrup Plugin: MongoDB
 * Node types: mongo-find, mongo-find-one, mongo-insert, mongo-update,
 *             mongo-delete, mongo-aggregate, mongo-count
 *
 * Requires: mongodb (peer dependency). Without it the plugin refuses
 * to register and emits a helpful install hint at startup.
 *
 * Auth: A single MongoDB URI (service: "mongodb") or per-node
 * `connectionString` config. The URI follows the standard
 * mongodb+srv://user:pass@host/db format — any auth source, replica
 * set, or TLS options belong in the URI itself.
 *
 * Each handler opens a short-lived client per call. For hot loops this
 * is wasteful; downstream improvement would pool. For now correctness
 * over speed — reconnecting is cheap relative to workflow step overhead.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";

async function withClient<T>(
  uri: string,
  dbName: string,
  fn: (db: any) => Promise<T>,
): Promise<T> {
  const mongodb = (await import("mongodb" as any)) as any;
  const client: any = new mongodb.MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    return await fn(db);
  } finally {
    await client.close();
  }
}

function resolveUri(config: Record<string, unknown>, execCtx: { inputs: Record<string, unknown> }): string {
  const uri =
    (config.token as string) ??
    (config.connectionString as string) ??
    (execCtx.inputs.token as string) ??
    (execCtx.inputs.connectionString as string);
  if (!uri) throw new Error("mongodb plugin requires token or connectionString");
  return uri;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("mongo-find", async (config, execCtx) => {
    const { database, collection, filter, projection, sort, limit, skip } = {
      ...execCtx.inputs, ...config,
    } as {
      database: string; collection: string;
      filter?: Record<string, unknown>; projection?: Record<string, unknown>;
      sort?: Record<string, unknown>; limit?: number; skip?: number;
    };
    const uri = resolveUri(config, execCtx);
    const docs = await withClient(uri, database, async (db) => {
      const cursor = db.collection(collection).find(filter ?? {}, { projection });
      if (sort) cursor.sort(sort);
      if (skip) cursor.skip(skip);
      if (limit) cursor.limit(limit);
      return cursor.toArray();
    });
    return { documents: docs, count: docs.length };
  });

  ctx.registerNodeType("mongo-find-one", async (config, execCtx) => {
    const { database, collection, filter, projection } = { ...execCtx.inputs, ...config } as {
      database: string; collection: string;
      filter?: Record<string, unknown>; projection?: Record<string, unknown>;
    };
    const uri = resolveUri(config, execCtx);
    const doc = await withClient(uri, database, async (db) =>
      db.collection(collection).findOne(filter ?? {}, { projection }),
    );
    return { document: doc, found: Boolean(doc) };
  });

  ctx.registerNodeType("mongo-insert", async (config, execCtx) => {
    const { database, collection, documents } = { ...execCtx.inputs, ...config } as {
      database: string; collection: string;
      documents: Record<string, unknown> | Array<Record<string, unknown>>;
    };
    const docsList = Array.isArray(documents) ? documents : [documents];
    const uri = resolveUri(config, execCtx);
    const result = await withClient(uri, database, async (db) => {
      if (docsList.length === 1) {
        const r = await db.collection(collection).insertOne(docsList[0]);
        return { insertedCount: 1, insertedIds: [r.insertedId.toString()] };
      }
      const r = await db.collection(collection).insertMany(docsList);
      return {
        insertedCount: r.insertedCount,
        insertedIds: Object.values(r.insertedIds).map((id: any) => id.toString()),
      };
    });
    return result;
  });

  ctx.registerNodeType("mongo-update", async (config, execCtx) => {
    const { database, collection, filter, update, upsert, many } = {
      ...execCtx.inputs, ...config,
    } as {
      database: string; collection: string;
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
      upsert?: boolean; many?: boolean;
    };
    const uri = resolveUri(config, execCtx);
    const result = await withClient(uri, database, async (db) => {
      const col = db.collection(collection);
      return many
        ? col.updateMany(filter, update, { upsert })
        : col.updateOne(filter, update, { upsert });
    });
    return {
      matched: result.matchedCount,
      modified: result.modifiedCount,
      upsertedId: result.upsertedId?.toString() ?? null,
    };
  });

  ctx.registerNodeType("mongo-delete", async (config, execCtx) => {
    const { database, collection, filter, many } = { ...execCtx.inputs, ...config } as {
      database: string; collection: string;
      filter: Record<string, unknown>; many?: boolean;
    };
    const uri = resolveUri(config, execCtx);
    const result = await withClient(uri, database, async (db) => {
      const col = db.collection(collection);
      return many ? col.deleteMany(filter) : col.deleteOne(filter);
    });
    return { deleted: result.deletedCount };
  });

  ctx.registerNodeType("mongo-aggregate", async (config, execCtx) => {
    const { database, collection, pipeline } = { ...execCtx.inputs, ...config } as {
      database: string; collection: string; pipeline: Array<Record<string, unknown>>;
    };
    const uri = resolveUri(config, execCtx);
    const docs = await withClient(uri, database, async (db) =>
      db.collection(collection).aggregate(pipeline).toArray(),
    );
    return { documents: docs, count: docs.length };
  });

  ctx.registerNodeType("mongo-count", async (config, execCtx) => {
    const { database, collection, filter } = { ...execCtx.inputs, ...config } as {
      database: string; collection: string; filter?: Record<string, unknown>;
    };
    const uri = resolveUri(config, execCtx);
    const count = await withClient(uri, database, async (db) =>
      db.collection(collection).countDocuments(filter ?? {}),
    );
    return { count };
  });
}
