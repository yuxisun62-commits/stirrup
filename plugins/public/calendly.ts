/**
 * Stirrup Plugin: Calendly
 * Node types: calendly-list-events, calendly-get-event,
 *             calendly-list-invitees, calendly-cancel-event,
 *             calendly-list-event-types, calendly-create-scheduling-link
 *
 * Auth: Personal Access Token (service "calendly"). Create at
 * calendly.com/integrations/api_webhooks. V2 API uses Bearer tokens
 * and URIs (not UUIDs) for most resources.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../../src/plugins/safeFetch.js";

const API = "https://api.calendly.com";

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T | null> {
  const res = await safeFetch(`${API}${path}`, {
    ...init,
    headers: { ...headers(token), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Calendly API ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json() as Promise<T>;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("calendly-list-events", async (config, execCtx) => {
    const { token, userUri, status, minStartTime, maxStartTime, count, sort } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; userUri: string;
      status?: "active" | "canceled";
      minStartTime?: string; maxStartTime?: string;
      count?: number; sort?: "start_time:asc" | "start_time:desc";
    };
    const params = new URLSearchParams({ user: userUri });
    if (status) params.set("status", status);
    if (minStartTime) params.set("min_start_time", minStartTime);
    if (maxStartTime) params.set("max_start_time", maxStartTime);
    if (count) params.set("count", String(count));
    if (sort) params.set("sort", sort);
    const data = await call<{
      collection: Array<Record<string, unknown>>;
      pagination: { next_page?: string };
    }>(token, `/scheduled_events?${params.toString()}`);
    return {
      events: data!.collection,
      count: data!.collection.length,
      nextPage: data!.pagination.next_page,
    };
  });

  ctx.registerNodeType("calendly-get-event", async (config, execCtx) => {
    const { token, eventUuid } = { ...execCtx.inputs, ...config } as {
      token: string; eventUuid: string;
    };
    const data = await call<{ resource: Record<string, unknown> }>(
      token, `/scheduled_events/${encodeURIComponent(eventUuid)}`,
    );
    return { event: data!.resource };
  });

  ctx.registerNodeType("calendly-list-invitees", async (config, execCtx) => {
    const { token, eventUuid, status, email } = { ...execCtx.inputs, ...config } as {
      token: string; eventUuid: string; status?: "active" | "canceled"; email?: string;
    };
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (email) params.set("email", email);
    const data = await call<{
      collection: Array<Record<string, unknown>>;
    }>(
      token,
      `/scheduled_events/${encodeURIComponent(eventUuid)}/invitees?${params.toString()}`,
    );
    return { invitees: data!.collection, count: data!.collection.length };
  });

  ctx.registerNodeType("calendly-cancel-event", async (config, execCtx) => {
    const { token, eventUuid, reason } = { ...execCtx.inputs, ...config } as {
      token: string; eventUuid: string; reason?: string;
    };
    await call<void>(
      token, `/scheduled_events/${encodeURIComponent(eventUuid)}/cancellation`,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
    return { canceled: true, eventUuid };
  });

  ctx.registerNodeType("calendly-list-event-types", async (config, execCtx) => {
    const { token, userUri, active, count } = { ...execCtx.inputs, ...config } as {
      token: string; userUri: string; active?: boolean; count?: number;
    };
    const params = new URLSearchParams({ user: userUri });
    if (active !== undefined) params.set("active", String(active));
    if (count) params.set("count", String(count));
    const data = await call<{ collection: Array<Record<string, unknown>> }>(
      token, `/event_types?${params.toString()}`,
    );
    return { eventTypes: data!.collection, count: data!.collection.length };
  });

  // Single-use scheduling link for a specific event type. Useful for
  // "send a customer a one-shot booking link" flows.
  ctx.registerNodeType("calendly-create-scheduling-link", async (config, execCtx) => {
    const { token, eventTypeUri, maxEventCount } = { ...execCtx.inputs, ...config } as {
      token: string; eventTypeUri: string; maxEventCount?: number;
    };
    const data = await call<{ resource: { booking_url: string; owner: string; owner_type: string } }>(
      token, "/scheduling_links",
      {
        method: "POST",
        body: JSON.stringify({
          max_event_count: maxEventCount ?? 1,
          owner: eventTypeUri,
          owner_type: "EventType",
        }),
      },
    );
    return { url: data!.resource.booking_url, owner: data!.resource.owner };
  });
}
