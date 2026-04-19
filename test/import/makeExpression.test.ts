import { describe, it, expect } from "vitest";
import {
  parseMakeTemplate,
  hasMakeExpressions,
  evaluateMakeTemplate,
  evaluateMakeConfig,
  collectMakeModuleReferences,
  configHasMakeExpressions,
  evaluateMakeRawJs,
} from "../../src/import/makeExpression.js";

const emptyCtx = {
  modules: {},
  execution: { id: "exec-1" },
};

describe("parseMakeTemplate", () => {
  it("pure expression keeps pureExpression flag", () => {
    const { segments, pureExpression } = parseMakeTemplate("{{1.email}}");
    expect(pureExpression).toBe(true);
    expect(segments).toEqual([{ kind: "expression", value: "1.email" }]);
  });

  it("mixed templates split into literal + expression segments", () => {
    const { segments } = parseMakeTemplate("hello {{1.name}}!");
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ kind: "literal", value: "hello " });
    expect(segments[1]).toEqual({ kind: "expression", value: "1.name" });
    expect(segments[2]).toEqual({ kind: "literal", value: "!" });
  });
});

describe("hasMakeExpressions", () => {
  it("detects {{ }} markers", () => {
    expect(hasMakeExpressions("{{1.foo}}")).toBe(true);
    expect(hasMakeExpressions("plain")).toBe(false);
    expect(hasMakeExpressions(42)).toBe(false);
  });
});

describe("evaluateMakeTemplate", () => {
  it("resolves {{N.field}} against the modules map", () => {
    const out = evaluateMakeTemplate("{{1.email}}", {
      ...emptyCtx,
      modules: { 1: { email: "a@x.com" } },
    });
    expect(out).toBe("a@x.com");
  });

  it("preserves native type for pure expressions", () => {
    const out = evaluateMakeTemplate("{{1.count + 5}}", {
      ...emptyCtx,
      modules: { 1: { count: 10 } },
    });
    expect(out).toBe(15);
    expect(typeof out).toBe("number");
  });

  it("concatenates mixed templates as strings", () => {
    const out = evaluateMakeTemplate("Hi {{1.name}} ({{1.count}})", {
      ...emptyCtx,
      modules: { 1: { name: "Alice", count: 7 } },
    });
    expect(out).toBe("Hi Alice (7)");
  });

  it("supports helper functions: lower / upper / if / ifempty", () => {
    const modules = { 1: { name: "ALICE", count: 0, tags: [] } };
    const ctx = { ...emptyCtx, modules };

    expect(evaluateMakeTemplate("{{lower(1.name)}}", ctx)).toBe("alice");
    expect(evaluateMakeTemplate('{{if(1.count > 0; "has"; "none")}}', ctx)).toBe("none");
    expect(evaluateMakeTemplate('{{ifempty(1.tags; "no-tags")}}', ctx)).toBe("no-tags");
  });

  it("word operators (and / or / not) translate to JS", () => {
    const ctx = { ...emptyCtx, modules: { 1: { a: true, b: false } } };
    expect(evaluateMakeTemplate("{{1.a and not 1.b}}", ctx)).toBe(true);
    expect(evaluateMakeTemplate("{{1.a or 1.b}}", ctx)).toBe(true);
  });

  it("swallows errors for broken expressions and reports via callback", () => {
    const errors: Array<{ expr: string }> = [];
    const out = evaluateMakeTemplate("{{99.missing}}", emptyCtx, (expr) => errors.push({ expr }));
    expect(out).toBe("");
    expect(errors).toHaveLength(1);
  });
});

describe("collectMakeModuleReferences", () => {
  it("finds every referenced module id across a nested config", () => {
    const refs = collectMakeModuleReferences({
      url: "{{1.base}}/api/{{2.path}}",
      body: { items: ["{{1.foo}}", "{{3.bar}}"] },
    });
    expect(refs).toEqual([1, 2, 3]);
  });

  it("ignores literal numbers that aren't followed by a dot", () => {
    const refs = collectMakeModuleReferences({ a: "{{42}}", b: "{{1 + 2}}" });
    expect(refs).toEqual([]);
  });
});

describe("evaluateMakeConfig", () => {
  it("walks deeply nested objects and arrays", () => {
    const config = {
      url: "{{1.base}}/api",
      headers: { "X-Token": "{{1.token}}" },
      items: ["{{1.n}}", "literal"],
    };
    const out = evaluateMakeConfig(config, {
      ...emptyCtx,
      modules: { 1: { base: "https://x", token: "abc", n: 5 } },
    }) as Record<string, unknown>;
    expect(out.url).toBe("https://x/api");
    expect((out.headers as Record<string, unknown>)["X-Token"]).toBe("abc");
    expect((out.items as unknown[])[0]).toBe(5);
    expect((out.items as unknown[])[1]).toBe("literal");
  });
});

describe("configHasMakeExpressions", () => {
  it("deep-scans for {{ markers", () => {
    expect(configHasMakeExpressions({ a: { b: ["{{1.x}}"] } })).toBe(true);
    expect(configHasMakeExpressions({ a: 1, b: "literal" })).toBe(false);
  });
});

describe("evaluateMakeRawJs (used by compiled conditions)", () => {
  it("evaluates raw JS with module-keyed lookups", () => {
    const result = evaluateMakeRawJs("1.count > 5", {
      ...emptyCtx,
      modules: { 1: { count: 10 } },
    });
    expect(result).toBe(true);
  });
});
