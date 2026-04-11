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

  it("exposes fetch, URL, URLSearchParams, and Buffer", async () => {
    // These are the capabilities scripts need for real-world work.
    // We can't call fetch without network, so just verify the bindings exist.
    const out = await scriptHandler(
      {
        code: `
          result = {
            hasFetch: typeof fetch === 'function',
            hasURL: typeof URL === 'function',
            hasURLSearchParams: typeof URLSearchParams === 'function',
            hasBuffer: typeof Buffer === 'function',
          };
        `,
      },
      { inputs: {}, context: {}, logger: noop }
    );
    expect(out.hasFetch).toBe(true);
    expect(out.hasURL).toBe(true);
    expect(out.hasURLSearchParams).toBe(true);
    expect(out.hasBuffer).toBe(true);
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
