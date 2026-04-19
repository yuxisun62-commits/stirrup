import { describe, it, expect } from "vitest";
import {
  parseTemplate,
  evaluateTemplate,
  hasExpressions,
  evaluateConfig,
  collectNodeReferences,
  configHasExpressions,
} from "../../src/import/n8nExpression.js";

const emptyContext = {
  json: {},
  nodeOutputs: {},
  parameter: {},
  workflow: { id: "wf", name: "Test" },
  execution: { id: "exec-1" },
};

describe("parseTemplate", () => {
  it("extracts a single expression from a pure template", () => {
    const { segments, pureExpression } = parseTemplate("={{ $json.url }}");
    expect(pureExpression).toBe(true);
    expect(segments).toEqual([{ kind: "expression", value: "$json.url" }]);
  });

  it("splits mixed literal + expression segments", () => {
    const { segments, pureExpression } = parseTemplate(
      "https://api.example.com/users/{{ $json.id }}/posts",
    );
    expect(pureExpression).toBe(false);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ kind: "literal", value: "https://api.example.com/users/" });
    expect(segments[1]).toEqual({ kind: "expression", value: "$json.id" });
    expect(segments[2]).toEqual({ kind: "literal", value: "/posts" });
  });

  it("handles nested braces inside an expression", () => {
    const { segments } = parseTemplate("{{ ({a: 1, b: 2}).a }}");
    expect(segments).toEqual([{ kind: "expression", value: "({a: 1, b: 2}).a" }]);
  });

  it("gracefully handles an unclosed template", () => {
    const { segments } = parseTemplate("broken {{ $json.foo");
    expect(segments[0]).toEqual({ kind: "literal", value: "broken " });
    expect(segments[1].kind).toBe("literal");
  });
});

describe("hasExpressions", () => {
  it("recognizes `=` pure expressions", () => {
    expect(hasExpressions("={{ x }}")).toBe(true);
  });
  it("recognizes mixed templates", () => {
    expect(hasExpressions("hello {{ y }}")).toBe(true);
  });
  it("ignores plain strings", () => {
    expect(hasExpressions("plain value")).toBe(false);
    expect(hasExpressions("= not an expression")).toBe(true); // leading = always signals
  });
  it("ignores non-strings", () => {
    expect(hasExpressions(42)).toBe(false);
    expect(hasExpressions(null)).toBe(false);
  });
});

describe("evaluateTemplate", () => {
  it("preserves native type for pure expressions", () => {
    const result = evaluateTemplate("={{ 1 + 2 }}", emptyContext);
    expect(result).toBe(3);
    expect(typeof result).toBe("number");
  });

  it("coerces and concatenates for mixed templates", () => {
    const result = evaluateTemplate("count={{ 1 + 2 }}!", emptyContext);
    expect(result).toBe("count=3!");
  });

  it("resolves $json field access", () => {
    const result = evaluateTemplate("={{ $json.name }}", {
      ...emptyContext,
      json: { name: "Alice" },
    });
    expect(result).toBe("Alice");
  });

  it("resolves $node access", () => {
    const result = evaluateTemplate('={{ $node["Upstream"].json.id }}', {
      ...emptyContext,
      nodeOutputs: { Upstream: { id: 42 } },
    });
    expect(result).toBe(42);
  });

  it("supports $if helper", () => {
    const result = evaluateTemplate(
      '={{ $if($json.count > 0, "some", "none") }}',
      { ...emptyContext, json: { count: 5 } },
    );
    expect(result).toBe("some");
  });

  it("swallows expression errors and reports via callback", () => {
    const errors: Array<{ expr: string; err: Error }> = [];
    const result = evaluateTemplate("={{ nonexistent.value }}", emptyContext, (expr, err) =>
      errors.push({ expr, err }),
    );
    expect(result).toBe("");
    expect(errors).toHaveLength(1);
    expect(errors[0].expr).toBe("nonexistent.value");
  });

  it("returns strings unchanged when they have no expressions", () => {
    expect(evaluateTemplate("plain", emptyContext)).toBe("plain");
  });
});

describe("evaluateConfig", () => {
  it("walks deeply nested objects and arrays", () => {
    const config = {
      url: "={{ $json.base }}/api",
      headers: { "X-Id": "={{ $json.id }}" },
      items: ["={{ $json.n * 2 }}", "literal"],
      nested: { deeper: { val: "={{ $json.deep }}" } },
    };
    const result = evaluateConfig(config, {
      ...emptyContext,
      json: { base: "https://x", id: "abc", n: 4, deep: "hi" },
    }) as Record<string, unknown>;
    expect(result.url).toBe("https://x/api");
    expect((result.headers as Record<string, unknown>)["X-Id"]).toBe("abc");
    expect((result.items as unknown[])[0]).toBe(8);
    expect((result.items as unknown[])[1]).toBe("literal");
    expect(((result.nested as any).deeper.val)).toBe("hi");
  });

  it("leaves non-string values untouched", () => {
    const config = { count: 5, enabled: true, list: [1, 2, 3] };
    const result = evaluateConfig(config, emptyContext);
    expect(result).toEqual(config);
  });
});

describe("collectNodeReferences", () => {
  it("finds every $node reference across nested configs", () => {
    const refs = collectNodeReferences({
      url: '={{ $node["HTTP"].json.url }}',
      body: {
        userId: '={{ $node["Lookup"].json.id }}',
        nested: ['={{ $node["HTTP"].json.token }}'],
      },
    });
    expect(refs.sort()).toEqual(["HTTP", "Lookup"]);
  });

  it("ignores $json or other globals", () => {
    const refs = collectNodeReferences({ x: "={{ $json.foo }}" });
    expect(refs).toEqual([]);
  });
});

describe("configHasExpressions", () => {
  it("returns true when any nested string contains templates", () => {
    expect(configHasExpressions({ a: { b: ["={{ x }}"] } })).toBe(true);
  });
  it("returns false for literal-only configs", () => {
    expect(configHasExpressions({ a: 1, b: "literal", c: [true] })).toBe(false);
  });
});
