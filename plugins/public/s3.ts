/**
 * Stirrup Plugin: AWS S3
 * Node types: s3-get, s3-put, s3-list, s3-delete
 * Requires: @aws-sdk/client-s3 (peer dependency)
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";

async function getS3Client(config: Record<string, unknown>) {
  const { S3Client } = await import("@aws-sdk/client-s3").catch(() => {
    throw new Error("@aws-sdk/client-s3 is required: npm install @aws-sdk/client-s3");
  });
  return new S3Client({
    region: (config.region as string) ?? process.env.AWS_REGION ?? "us-east-1",
    ...(config.accessKeyId ? {
      credentials: {
        accessKeyId: config.accessKeyId as string,
        secretAccessKey: config.secretAccessKey as string,
      },
    } : {}),
  });
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("s3-get", async (config, execCtx) => {
    const { bucket, key, encoding } = { ...execCtx.inputs, ...config } as {
      bucket: string; key: string; encoding?: string;
    };
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await getS3Client(config);
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await res.Body?.transformToString(encoding ?? "utf-8");
    return {
      content: body,
      contentType: res.ContentType,
      size: res.ContentLength,
      lastModified: res.LastModified?.toISOString(),
    };
  });

  ctx.registerNodeType("s3-put", async (config, execCtx) => {
    const { bucket, key, content, contentType } = { ...execCtx.inputs, ...config } as {
      bucket: string; key: string; content: string; contentType?: string;
    };
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await getS3Client(config);
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: content,
      ContentType: contentType ?? "application/octet-stream",
    }));
    return { bucket, key, uploaded: true, size: Buffer.byteLength(content) };
  });

  ctx.registerNodeType("s3-list", async (config, execCtx) => {
    const { bucket, prefix, maxKeys } = { ...execCtx.inputs, ...config } as {
      bucket: string; prefix?: string; maxKeys?: number;
    };
    const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const client = await getS3Client(config);
    const res = await client.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: prefix, MaxKeys: maxKeys ?? 1000,
    }));
    return {
      files: (res.Contents ?? []).map((o) => ({
        key: o.Key, size: o.Size, lastModified: o.LastModified?.toISOString(),
      })),
      count: res.KeyCount,
      truncated: res.IsTruncated,
    };
  });

  ctx.registerNodeType("s3-delete", async (config, execCtx) => {
    const { bucket, key } = { ...execCtx.inputs, ...config } as { bucket: string; key: string };
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await getS3Client(config);
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return { bucket, key, deleted: true };
  });
}
