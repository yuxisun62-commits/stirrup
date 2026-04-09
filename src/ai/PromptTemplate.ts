/** Simple Mustache-style template rendering: replaces {{variable}} with values from the data object */
export function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
    const parts = path.split(".");
    let current: unknown = data;
    for (const part of parts) {
      if (current === null || current === undefined) return "";
      current = (current as Record<string, unknown>)[part];
    }
    if (current === null || current === undefined) return "";
    if (typeof current === "object") return JSON.stringify(current);
    return String(current);
  });
}
