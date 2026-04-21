/**
 * Safer fetch wrappers for plugin handlers.
 *
 * Node's native `fetch()` has two sharp edges that every plugin otherwise
 * trips over:
 *
 *  1. No default timeout. A hung or unusually slow external API blocks
 *     the Stirrup worker indefinitely — worst for triggered workflows
 *     that run unsupervised.
 *
 *  2. No body size limit. `Buffer.from(await res.arrayBuffer())` happily
 *     reads a 10 GB response into memory. When a webhook-triggered
 *     workflow feeds an attacker-controlled URL into one of our media
 *     plugins (openai-whisper, elevenlabs-speech-to-text, groq-transcribe,
 *     gdrive-download), that's a straight path to OOM.
 *
 * These helpers are drop-in replacements that apply sane defaults. Both
 * are tuned generously so they rarely get in the way of legitimate use:
 * 30-second timeout covers even slow LLM endpoints with large context
 * windows, and a 50 MB body cap covers normal audio / PDF / image files
 * but rejects nothing-is-this-big adversarial responses.
 *
 * Lives under plugins/ (not src/) so the compiled .js sits next to the
 * plugin .js files that import it. Earlier versions lived at
 * src/plugins/safeFetch.ts and were imported via "../../src/plugins/..."
 * — the cross-tree path broke at runtime because the plugin build step
 * wipes stray src/ artifacts, leaving the imported .js missing.
 */

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

export interface SafeFetchOptions {
  /** Max milliseconds to wait before aborting. Overrides DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
}

/**
 * Drop-in replacement for `fetch()` with a per-request timeout.
 *
 * If the caller supplied its own `signal` (e.g. for shutdown propagation),
 * we chain it with our timeout signal so either can abort. When the
 * timeout fires, the rejected promise's error includes the URL so logs
 * and retry policies can see which external call stalled.
 */
export async function safeFetch(
  input: string | URL | Request,
  init?: RequestInit,
  options?: SafeFetchOptions,
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  try {
    return await fetch(input, { ...init, signal });
  } catch (err) {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if ((err as Error).name === "TimeoutError" || (err as Error).name === "AbortError") {
      throw new Error(`Request to ${urlStr} timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}

/**
 * Read a response body as an ArrayBuffer, rejecting anything larger
 * than `maxBytes`. Uses the `Content-Length` header as a cheap early-
 * exit and otherwise reads chunks from the body stream, tallying bytes
 * and bailing once the limit is crossed — no need to buffer the whole
 * payload first.
 *
 * When the body is chunked (no Content-Length) the stream read is the
 * only protection. The loop aborts mid-stream on oversize, so memory
 * usage stays bounded at the chunk granularity (typically 64 KB).
 */
export async function safeArrayBuffer(
  res: Response,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<ArrayBuffer> {
  const lenHeader = res.headers.get("content-length");
  if (lenHeader) {
    const declared = Number(lenHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(
        `Response body ${declared} bytes exceeds max ${maxBytes} bytes — refusing to buffer.`,
      );
    }
  }

  // No streaming API? Fall back to arrayBuffer() but cap based on result.
  // Body streams are a standard part of Node 18+ fetch, so this is rare
  // defensive coding — still, the cap is a safety net.
  if (!res.body) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      throw new Error(
        `Response body ${buf.byteLength} bytes exceeds max ${maxBytes} bytes.`,
      );
    }
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(
          `Response body exceeded max ${maxBytes} bytes mid-stream (stopped at ${total}).`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

/** Size-capped text body reader. Thin wrapper around safeArrayBuffer. */
export async function safeText(
  res: Response,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<string> {
  const buf = await safeArrayBuffer(res, maxBytes);
  return new TextDecoder().decode(buf);
}
