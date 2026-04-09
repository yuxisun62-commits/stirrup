/**
 * Stirrup Plugin: Redis
 * Node types: redis-get, redis-set, redis-publish, redis-list-push
 * Requires: ioredis (peer dependency)
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";

async function getClient(config: Record<string, unknown>) {
  const Redis = (await import("ioredis").catch(() => {
    throw new Error("ioredis is required: npm install ioredis");
  })).default;
  return new Redis({
    host: (config.host as string) ?? process.env.REDIS_HOST ?? "localhost",
    port: (config.port as number) ?? Number(process.env.REDIS_PORT ?? 6379),
    password: (config.password as string) ?? process.env.REDIS_PASSWORD,
    db: config.db as number,
  });
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("redis-get", async (config, execCtx) => {
    const { key, keys } = { ...execCtx.inputs, ...config } as { key?: string; keys?: string[] };
    const client = await getClient(config);
    try {
      if (keys && keys.length > 0) {
        const values = await client.mget(...keys);
        const result: Record<string, unknown> = {};
        keys.forEach((k, i) => { result[k] = values[i]; });
        return { values: result };
      }
      if (key) return { value: await client.get(key) };
      throw new Error("Either key or keys must be provided");
    } finally {
      await client.quit();
    }
  });

  ctx.registerNodeType("redis-set", async (config, execCtx) => {
    const { key, value, ttl } = { ...execCtx.inputs, ...config } as {
      key: string; value: string; ttl?: number;
    };
    const client = await getClient(config);
    try {
      if (ttl) await client.setex(key, ttl, value);
      else await client.set(key, String(value));
      return { set: true, key };
    } finally {
      await client.quit();
    }
  });

  ctx.registerNodeType("redis-publish", async (config, execCtx) => {
    const { channel, message } = { ...execCtx.inputs, ...config } as {
      channel: string; message: string;
    };
    const client = await getClient(config);
    try {
      const receivers = await client.publish(
        channel,
        typeof message === "string" ? message : JSON.stringify(message)
      );
      return { channel, receivers };
    } finally {
      await client.quit();
    }
  });

  ctx.registerNodeType("redis-list-push", async (config, execCtx) => {
    const { key, values, direction } = { ...execCtx.inputs, ...config } as {
      key: string; values: string[]; direction?: "left" | "right";
    };
    const client = await getClient(config);
    try {
      const len = direction === "left"
        ? await client.lpush(key, ...values)
        : await client.rpush(key, ...values);
      return { key, length: len };
    } finally {
      await client.quit();
    }
  });
}
