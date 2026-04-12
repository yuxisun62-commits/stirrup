import type { NodeHandler } from "./NodeRegistry.js";
import type { ScriptConfig } from "../types/nodes.js";
import { runInSandbox } from "./sandbox.js";

/**
 * Script node handler.
 *
 * Scripts receive:
 *   - `inputs`    — resolved node inputs
 *   - `context`   — the execution context
 *   - `fetch`     — global fetch (for HTTP calls)
 *   - `URL`       — global URL constructor
 *   - `URLSearchParams` — for building query strings
 *   - `atob` / `btoa` — for base64 encoding/decoding
 *   - `console`   — wired to the execution logger
 *   - `result`    — assign your output here
 *
 * NOTE: `Buffer` is intentionally NOT exposed. Its prototype chain reaches
 * the host-realm Function constructor, which bypasses the vm's
 * Object.prototype.constructor freeze and enables sandbox escape:
 *   `new (Buffer.from([]).constructor)('return process')()` → host process.
 * Scripts that need binary/base64 should use `atob`/`btoa`.
 *
 * Scripts ASSIGN to `result` (NOT `return`):
 *   result = { foo: 42 };
 *
 * For async work (fetch, etc.), wrap in an async IIFE and assign the
 * Promise to `result`. The handler awaits it:
 *   result = (async () => {
 *     const res = await fetch(inputs.url);
 *     return await res.json();
 *   })();
 *
 * If `result` ends up as a non-object, it's wrapped as `{ result: value }`.
 */
export const scriptHandler: NodeHandler = async (config, ctx) => {
  const { code, timeoutMs } = config as unknown as ScriptConfig;

  if (!code || typeof code !== "string") {
    throw new Error(
      "script node requires a `code` field (string). Did you write `script:` in the template by mistake?"
    );
  }

  const timeout = timeoutMs ?? 10000;

  const sandbox: Record<string, unknown> = {
    inputs: ctx.inputs,
    context: ctx.context,
    fetch: globalThis.fetch,
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,
    // atob/btoa instead of Buffer — see the top-of-file note on why.
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    console: {
      log: (msg: string) => ctx.logger.info(msg),
      warn: (msg: string) => ctx.logger.warn(msg),
      error: (msg: string) => ctx.logger.error(msg),
    },
    result: undefined as unknown,
  };

  // Auto-wrap the user's code in an async IIFE. This lets scripts use
  // top-level `await` and `fetch` naturally, while sync scripts that just
  // do `result = {...}` still work (the assignment happens inside the IIFE,
  // which runs synchronously up to the first await). The IIFE returns a
  // Promise — we await it so async work has time to finish before we read
  // sandbox.result.
  //
  // Edge case: if `code` contains top-level `const`/`let` that rely on the
  // script being a script (not a function), those would previously pollute
  // the sandbox. Inside an async IIFE they're scoped locally. This is
  // actually safer — sync leaks into the context are a common footgun.
  const wrappedCode = `(async () => {\n${code}\n})()`;

  const startedAt = Date.now();
  const deadline = startedAt + timeout;

  // Shared helper that awaits a Promise but rejects if we pass the deadline.
  // Used for both the IIFE return value AND any Promise the user assigned
  // to `result` (explicit IIFE pattern). Time remaining shrinks across calls.
  const awaitWithDeadline = async <T>(p: Promise<T>): Promise<T> => {
    const remaining = Math.max(0, deadline - Date.now());
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        p,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`script async work timed out after ${timeout}ms`)),
            remaining,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const iifeReturn = runInSandbox(wrappedCode, sandbox, { timeout });

  // Await the outer async IIFE
  if (
    iifeReturn !== null &&
    typeof iifeReturn === "object" &&
    typeof (iifeReturn as { then?: unknown }).then === "function"
  ) {
    await awaitWithDeadline(iifeReturn as Promise<unknown>);
  }

  // Also await if the user assigned a Promise directly to result (explicit
  // IIFE pattern). Uses the same deadline so total wait is bounded.
  let value = sandbox.result;
  if (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { then?: unknown }).then === "function"
  ) {
    value = await awaitWithDeadline(value as Promise<unknown>);
  }

  if (value !== null && typeof value === "object") {
    return value as Record<string, unknown>;
  }

  return { result: value };
};
