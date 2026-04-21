import { describe, it, expect, vi, afterEach } from "vitest";
import { safeFetch, safeArrayBuffer } from "../../plugins/safeFetch.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(impl: typeof fetch): void {
  globalThis.fetch = impl;
}

describe("safeFetch", () => {
  it("returns the response for successful requests", async () => {
    stubFetch(async () => new Response("ok", { status: 200 }));
    const res = await safeFetch("https://example.com");
    expect(await res.text()).toBe("ok");
  });

  it("throws a descriptive error when the underlying fetch times out", async () => {
    stubFetch(async (_input, init) => {
      // Simulate a fetch that respects abort but never completes on its own.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("abort");
          err.name = "TimeoutError";
          reject(err);
        });
      });
    });

    await expect(
      safeFetch("https://slow.example.com", undefined, { timeoutMs: 30 }),
    ).rejects.toThrow(/timed out after 30ms/);
  });

  it("passes through non-timeout errors unchanged", async () => {
    stubFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(safeFetch("https://x")).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe("safeArrayBuffer", () => {
  it("reads small bodies normally", async () => {
    const res = new Response(new Uint8Array([1, 2, 3, 4]), {
      headers: { "content-length": "4" },
    });
    const buf = await safeArrayBuffer(res, 100);
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("rejects when Content-Length already exceeds the cap", async () => {
    const res = new Response("ignored", {
      headers: { "content-length": String(100 * 1024 * 1024) },
    });
    await expect(safeArrayBuffer(res, 1024)).rejects.toThrow(
      /exceeds max 1024 bytes/,
    );
  });

  it("rejects when the streamed body crosses the cap mid-read", async () => {
    // Build a stream of 10 x 1KB chunks; cap at 5KB.
    const chunks = Array.from({ length: 10 }, () => new Uint8Array(1024));
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });
    const res = new Response(body); // no content-length header
    await expect(safeArrayBuffer(res, 5 * 1024)).rejects.toThrow(
      /exceeded max 5120 bytes/,
    );
  });

  it("accepts bodies without a Content-Length header when under the cap", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([10, 20, 30]));
        controller.close();
      },
    });
    const res = new Response(body);
    const buf = await safeArrayBuffer(res, 1024);
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([10, 20, 30]));
  });
});
