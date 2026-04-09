import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/ai/PromptTemplate.js";

describe("renderTemplate", () => {
  it("replaces simple variables", () => {
    expect(renderTemplate("Hello, {{name}}!", { name: "World" })).toBe("Hello, World!");
  });

  it("replaces nested variables", () => {
    expect(
      renderTemplate("{{user.name}}", { user: { name: "Alice" } })
    ).toBe("Alice");
  });

  it("replaces missing variables with empty string", () => {
    expect(renderTemplate("Hi {{missing}}", {})).toBe("Hi ");
  });

  it("stringifies objects", () => {
    const result = renderTemplate("Data: {{data}}", { data: { x: 1 } });
    expect(result).toBe('Data: {"x":1}');
  });

  it("handles multiple replacements", () => {
    expect(
      renderTemplate("{{a}} + {{b}} = {{c}}", { a: "1", b: "2", c: "3" })
    ).toBe("1 + 2 = 3");
  });
});
