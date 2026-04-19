/**
 * Stirrup Plugin: Google Calendar
 * Node types: gcal-list-events, gcal-create-event, gcal-update-event,
 *             gcal-delete-event, gcal-list-calendars
 *
 * Auth: OAuth 2.0 access token under service "google-calendar" (or the
 * generic "google") with scope https://www.googleapis.com/auth/calendar.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";

const API = "https://www.googleapis.com/calendar/v3";

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T | null> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...headers(token), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Calendar API ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json() as Promise<T>;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("gcal-list-events", async (config, execCtx) => {
    const { token, calendarId, timeMin, timeMax, q, maxResults, singleEvents, orderBy } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; calendarId?: string;
      timeMin?: string; timeMax?: string; q?: string;
      maxResults?: number; singleEvents?: boolean; orderBy?: string;
    };
    const cal = calendarId ?? "primary";
    const params = new URLSearchParams();
    if (timeMin) params.set("timeMin", timeMin);
    if (timeMax) params.set("timeMax", timeMax);
    if (q) params.set("q", q);
    params.set("maxResults", String(maxResults ?? 50));
    params.set("singleEvents", String(singleEvents ?? true));
    params.set("orderBy", orderBy ?? "startTime");

    const data = await call<{ items: Array<Record<string, unknown>>; nextPageToken?: string }>(
      token, `/calendars/${encodeURIComponent(cal)}/events?${params.toString()}`,
    );
    return {
      events: data!.items, nextPageToken: data!.nextPageToken, count: data!.items.length,
    };
  });

  ctx.registerNodeType("gcal-create-event", async (config, execCtx) => {
    const { token, calendarId, summary, description, location, start, end, attendees, sendUpdates, timezone } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; calendarId?: string;
      summary: string; description?: string; location?: string;
      start: string | { dateTime: string; timeZone?: string };
      end: string | { dateTime: string; timeZone?: string };
      attendees?: Array<{ email: string }>;
      sendUpdates?: "all" | "externalOnly" | "none";
      timezone?: string;
    };
    const cal = calendarId ?? "primary";
    const body = {
      summary, description, location,
      start: typeof start === "string" ? { dateTime: start, timeZone: timezone } : start,
      end: typeof end === "string" ? { dateTime: end, timeZone: timezone } : end,
      attendees,
    };
    const params = new URLSearchParams();
    if (sendUpdates) params.set("sendUpdates", sendUpdates);
    const data = await call<{ id: string; htmlLink: string; start: any; end: any }>(
      token,
      `/calendars/${encodeURIComponent(cal)}/events?${params.toString()}`,
      { method: "POST", body: JSON.stringify(body) },
    );
    return { eventId: data!.id, htmlLink: data!.htmlLink, start: data!.start, end: data!.end };
  });

  ctx.registerNodeType("gcal-update-event", async (config, execCtx) => {
    const { token, calendarId, eventId, fields } = { ...execCtx.inputs, ...config } as {
      token: string; calendarId?: string; eventId: string; fields: Record<string, unknown>;
    };
    const cal = calendarId ?? "primary";
    const data = await call<{ id: string }>(
      token,
      `/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(eventId)}`,
      { method: "PATCH", body: JSON.stringify(fields) },
    );
    return { eventId: data!.id, updated: true };
  });

  ctx.registerNodeType("gcal-delete-event", async (config, execCtx) => {
    const { token, calendarId, eventId } = { ...execCtx.inputs, ...config } as {
      token: string; calendarId?: string; eventId: string;
    };
    const cal = calendarId ?? "primary";
    await call<void>(
      token,
      `/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" },
    );
    return { deleted: true, eventId };
  });

  ctx.registerNodeType("gcal-list-calendars", async (config, execCtx) => {
    const { token } = { ...execCtx.inputs, ...config } as { token: string };
    const data = await call<{ items: Array<Record<string, unknown>> }>(
      token, "/users/me/calendarList",
    );
    return { calendars: data!.items, count: data!.items.length };
  });
}
