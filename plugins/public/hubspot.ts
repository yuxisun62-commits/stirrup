/**
 * Stirrup Plugin: HubSpot
 * Node types: hubspot-create-contact, hubspot-update-contact,
 *             hubspot-get-contact, hubspot-search-contacts,
 *             hubspot-create-deal, hubspot-create-engagement
 *
 * Auth: Private App access token (service "hubspot"). Create at
 * app.hubspot.com/private-apps. Default scopes for these nodes:
 * crm.objects.contacts.*, crm.objects.deals.*, crm.engagements.*.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../safeFetch.js";

const API = "https://api.hubapi.com";

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await safeFetch(`${API}${path}`, {
    ...init,
    headers: { ...headers(token), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`HubSpot API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("hubspot-create-contact", async (config, execCtx) => {
    const { token, properties } = { ...execCtx.inputs, ...config } as {
      token: string; properties: Record<string, unknown>;
    };
    const data = await call<{ id: string; properties: Record<string, unknown> }>(
      token, "/crm/v3/objects/contacts",
      { method: "POST", body: JSON.stringify({ properties }) },
    );
    return { contactId: data.id, properties: data.properties };
  });

  ctx.registerNodeType("hubspot-update-contact", async (config, execCtx) => {
    const { token, contactId, properties } = { ...execCtx.inputs, ...config } as {
      token: string; contactId: string; properties: Record<string, unknown>;
    };
    const data = await call<{ id: string; properties: Record<string, unknown> }>(
      token,
      `/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`,
      { method: "PATCH", body: JSON.stringify({ properties }) },
    );
    return { contactId: data.id, properties: data.properties };
  });

  ctx.registerNodeType("hubspot-get-contact", async (config, execCtx) => {
    const { token, contactId, properties } = { ...execCtx.inputs, ...config } as {
      token: string; contactId: string; properties?: string[];
    };
    const params = properties ? `?properties=${properties.join(",")}` : "";
    const data = await call<{ id: string; properties: Record<string, unknown> }>(
      token,
      `/crm/v3/objects/contacts/${encodeURIComponent(contactId)}${params}`,
    );
    return { contactId: data.id, properties: data.properties };
  });

  // CRM v3 search — query contacts by filters. A typical use case is
  // looking up a contact by email before deciding to create or update.
  ctx.registerNodeType("hubspot-search-contacts", async (config, execCtx) => {
    const { token, filterGroups, properties, limit, sorts } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string;
      filterGroups: Array<{ filters: Array<{ propertyName: string; operator: string; value: unknown }> }>;
      properties?: string[]; limit?: number; sorts?: Array<Record<string, unknown>>;
    };
    const data = await call<{
      total: number;
      results: Array<{ id: string; properties: Record<string, unknown> }>;
    }>(
      token, "/crm/v3/objects/contacts/search",
      {
        method: "POST",
        body: JSON.stringify({
          filterGroups,
          properties,
          limit: limit ?? 10,
          sorts,
        }),
      },
    );
    return { contacts: data.results, total: data.total, count: data.results.length };
  });

  ctx.registerNodeType("hubspot-create-deal", async (config, execCtx) => {
    const { token, properties, associations } = { ...execCtx.inputs, ...config } as {
      token: string;
      properties: Record<string, unknown>;
      associations?: Array<{ to: { id: string }; types: Array<{ associationCategory: string; associationTypeId: number }> }>;
    };
    const data = await call<{ id: string; properties: Record<string, unknown> }>(
      token, "/crm/v3/objects/deals",
      { method: "POST", body: JSON.stringify({ properties, associations }) },
    );
    return { dealId: data.id, properties: data.properties };
  });

  // Engagements — notes, calls, emails, meetings, tasks. Modern API
  // uses specific endpoints per type; this handler routes by `engagementType`.
  ctx.registerNodeType("hubspot-create-engagement", async (config, execCtx) => {
    const { token, engagementType, properties, associations } = { ...execCtx.inputs, ...config } as {
      token: string;
      engagementType: "notes" | "calls" | "emails" | "meetings" | "tasks";
      properties: Record<string, unknown>;
      associations?: Array<Record<string, unknown>>;
    };
    const data = await call<{ id: string; properties: Record<string, unknown> }>(
      token,
      `/crm/v3/objects/${engagementType}`,
      { method: "POST", body: JSON.stringify({ properties, associations }) },
    );
    return { engagementId: data.id, type: engagementType, properties: data.properties };
  });
}
