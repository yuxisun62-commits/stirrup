import { describe, it, expect } from "vitest";
import { scriptHandler } from "../../src/nodes/ScriptNode.js";

const noop = { info: () => {}, warn: () => {}, error: () => {} };

describe("ScriptNode", () => {
  it("reads sandbox.result back after sync assignment", async () => {
    // The canonical pattern: assign to `result` (no `var`/`let`/`const`) and
    // the handler reads it back. Regression test for the bug where
    // runInSandbox copied the sandbox into a fresh context, so mutations
    // inside the vm never propagated back to the handler's read.
    const out = await scriptHandler(
      { code: "result = { doubled: inputs.x * 2 };" },
      { inputs: { x: 21 }, context: {}, logger: noop }
    );
    expect(out.doubled).toBe(42);
  });

  it("supports top-level await in scripts", async () => {
    // Scripts are auto-wrapped in an async IIFE so await works at the
    // "top level" of the user's code. This test uses Promise.resolve
    // rather than fetch so it doesn't depend on network.
    const out = await scriptHandler(
      {
        code: `
          const value = await Promise.resolve(inputs.x * 3);
          result = { tripled: value };
        `,
      },
      { inputs: { x: 5 }, context: {}, logger: noop }
    );
    expect(out.tripled).toBe(15);
  });

  it("awaits Promise assigned to result (explicit IIFE pattern)", async () => {
    // The alternative pattern — wrap in an IIFE explicitly and assign the
    // Promise to `result`. Handler detects and awaits it.
    const out = await scriptHandler(
      {
        code: `
          result = (async () => {
            const n = await Promise.resolve(inputs.x + 1);
            return { incremented: n };
          })();
        `,
      },
      { inputs: { x: 9 }, context: {}, logger: noop }
    );
    expect(out.incremented).toBe(10);
  });

  it("exposes fetch, URL, URLSearchParams, atob, btoa — but NOT Buffer", async () => {
    // These are the capabilities scripts need for real-world work.
    // Buffer is intentionally excluded because its constructor chain
    // reaches host-realm Function and enables sandbox escape.
    // See note at the top of ScriptNode.ts.
    const out = await scriptHandler(
      {
        code: `
          result = {
            hasFetch: typeof fetch === 'function',
            hasURL: typeof URL === 'function',
            hasURLSearchParams: typeof URLSearchParams === 'function',
            hasAtob: typeof atob === 'function',
            hasBtoa: typeof btoa === 'function',
            hasBuffer: typeof Buffer === 'undefined',
          };
        `,
      },
      { inputs: {}, context: {}, logger: noop }
    );
    expect(out.hasFetch).toBe(true);
    expect(out.hasURL).toBe(true);
    expect(out.hasURLSearchParams).toBe(true);
    expect(out.hasAtob).toBe(true);
    expect(out.hasBtoa).toBe(true);
    expect(out.hasBuffer).toBe(true); // true because Buffer should be undefined
  });

  it("blocks the Buffer-based sandbox escape", async () => {
    // Regression test for H-3: ensure Buffer is not reachable and the
    // known escape pattern throws rather than executing in the host realm.
    await expect(
      scriptHandler(
        {
          code: `
            // Classic escape: reach Function constructor via Buffer's prototype
            const F = Buffer.from([]).constructor;
            result = { escaped: new F('return process')() };
          `,
        },
        { inputs: {}, context: {}, logger: noop }
      )
    ).rejects.toThrow(); // ReferenceError: Buffer is not defined
  });

  it("wraps non-object result in { result: value }", async () => {
    const out = await scriptHandler(
      { code: "result = 42;" },
      { inputs: {}, context: {}, logger: noop }
    );
    expect(out.result).toBe(42);
  });

  it("throws a clear error if code field is missing", async () => {
    // Catches the common mistake of writing `script:` in the YAML config.
    await expect(
      scriptHandler(
        { script: "result = { x: 1 };" },
        { inputs: {}, context: {}, logger: noop }
      )
    ).rejects.toThrow(/code.*field/);
  });

  it("times out on async work that hangs", async () => {
    await expect(
      scriptHandler(
        {
          code: "result = new Promise(() => {});", // never resolves
          timeoutMs: 200,
        },
        { inputs: {}, context: {}, logger: noop }
      )
    ).rejects.toThrow(/timed out/);
  });
});
