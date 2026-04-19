/**
 * Stirrup Plugin: Stripe
 * Node types: stripe-create-customer, stripe-list-customers,
 *             stripe-create-charge, stripe-create-payment-intent,
 *             stripe-create-invoice, stripe-create-subscription,
 *             stripe-create-checkout-session, stripe-retrieve,
 *             stripe-list
 *
 * Auth: Secret key (`sk_test_...` or `sk_live_...`) under service "stripe".
 * Gets one at dashboard.stripe.com/apikeys. Uses form-urlencoded bodies
 * because that's what Stripe expects (even in 2024 — API version
 * evolution, not the transport format).
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";

const API = "https://api.stripe.com/v1";

function authHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

/**
 * Stripe's form encoding is not standard querystring: nested objects
 * use bracket notation (`metadata[key]=value`). This walker produces
 * valid URL-encoded bodies for arbitrary JSON shapes.
 */
function encodeForm(obj: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "object" && item !== null) {
          parts.push(encodeForm(item as Record<string, unknown>, `${key}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof v === "object") {
      parts.push(encodeForm(v as Record<string, unknown>, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.filter(Boolean).join("&");
}

async function call<T>(
  key: string,
  path: string,
  body?: Record<string, unknown>,
  method: "GET" | "POST" | "DELETE" = "POST",
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: authHeaders(key),
    body: body ? encodeForm(body) : undefined,
  });
  const data = (await res.json()) as { error?: { message: string } } & T;
  if (!res.ok) {
    throw new Error(`Stripe API ${res.status}: ${data.error?.message ?? "unknown"}`);
  }
  return data;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("stripe-create-customer", async (config, execCtx) => {
    const { token, email, name, phone, description, metadata, paymentMethod } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; email?: string; name?: string; phone?: string;
      description?: string; metadata?: Record<string, string>;
      paymentMethod?: string;
    };
    const data = await call<{ id: string; email: string; livemode: boolean }>(
      token, "/customers",
      { email, name, phone, description, metadata, payment_method: paymentMethod },
    );
    return { customerId: data.id, email: data.email, livemode: data.livemode };
  });

  ctx.registerNodeType("stripe-list-customers", async (config, execCtx) => {
    const { token, email, limit } = { ...execCtx.inputs, ...config } as {
      token: string; email?: string; limit?: number;
    };
    const params = new URLSearchParams();
    if (email) params.set("email", email);
    if (limit) params.set("limit", String(limit));
    const res = await fetch(`${API}/customers?${params.toString()}`, {
      headers: authHeaders(token),
    });
    const data = (await res.json()) as { data: Array<Record<string, unknown>>; has_more: boolean };
    return { customers: data.data, hasMore: data.has_more, count: data.data.length };
  });

  // Modern Stripe flows use PaymentIntents (PCI-compliant, handles SCA).
  // The legacy `charges.create` is kept below for workflows that still use it.
  ctx.registerNodeType("stripe-create-payment-intent", async (config, execCtx) => {
    const { token, amount, currency, customer, paymentMethod, confirm, description, metadata } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; amount: number; currency: string;
      customer?: string; paymentMethod?: string; confirm?: boolean;
      description?: string; metadata?: Record<string, string>;
    };
    const data = await call<{ id: string; status: string; client_secret: string }>(
      token, "/payment_intents",
      {
        amount, currency, customer,
        payment_method: paymentMethod,
        confirm,
        description,
        metadata,
      },
    );
    return {
      paymentIntentId: data.id, status: data.status, clientSecret: data.client_secret,
    };
  });

  ctx.registerNodeType("stripe-create-charge", async (config, execCtx) => {
    const { token, amount, currency, customer, source, description, metadata } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; amount: number; currency: string;
      customer?: string; source?: string; description?: string;
      metadata?: Record<string, string>;
    };
    const data = await call<{ id: string; status: string; amount: number; paid: boolean }>(
      token, "/charges",
      { amount, currency, customer, source, description, metadata },
    );
    return {
      chargeId: data.id, status: data.status, amount: data.amount, paid: data.paid,
    };
  });

  ctx.registerNodeType("stripe-create-invoice", async (config, execCtx) => {
    const { token, customer, collectionMethod, daysUntilDue, metadata } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; customer: string;
      collectionMethod?: "charge_automatically" | "send_invoice";
      daysUntilDue?: number;
      metadata?: Record<string, string>;
    };
    const data = await call<{ id: string; status: string; amount_due: number }>(
      token, "/invoices",
      {
        customer,
        collection_method: collectionMethod,
        days_until_due: daysUntilDue,
        metadata,
      },
    );
    return { invoiceId: data.id, status: data.status, amountDue: data.amount_due };
  });

  ctx.registerNodeType("stripe-create-subscription", async (config, execCtx) => {
    const { token, customer, priceId, quantity, trialPeriodDays, metadata } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; customer: string; priceId: string;
      quantity?: number; trialPeriodDays?: number;
      metadata?: Record<string, string>;
    };
    const data = await call<{ id: string; status: string; current_period_end: number }>(
      token, "/subscriptions",
      {
        customer,
        items: [{ price: priceId, quantity: quantity ?? 1 }],
        trial_period_days: trialPeriodDays,
        metadata,
      },
    );
    return {
      subscriptionId: data.id, status: data.status, currentPeriodEnd: data.current_period_end,
    };
  });

  // Stripe Checkout Session — the hosted payment page. Most SaaS flows
  // use this so cards never touch your servers.
  ctx.registerNodeType("stripe-create-checkout-session", async (config, execCtx) => {
    const { token, mode, successUrl, cancelUrl, lineItems, customerEmail, metadata } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; mode: "payment" | "subscription" | "setup";
      successUrl: string; cancelUrl: string;
      lineItems: Array<{ price?: string; quantity?: number; price_data?: Record<string, unknown> }>;
      customerEmail?: string; metadata?: Record<string, string>;
    };
    const data = await call<{ id: string; url: string; status: string }>(
      token, "/checkout/sessions",
      {
        mode,
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: lineItems,
        customer_email: customerEmail,
        metadata,
      },
    );
    return { sessionId: data.id, url: data.url, status: data.status };
  });

  // Generic retrieve / list for resources the targeted nodes don't cover.
  ctx.registerNodeType("stripe-retrieve", async (config, execCtx) => {
    const { token, resource, id } = { ...execCtx.inputs, ...config } as {
      token: string; resource: string; id: string;
    };
    const res = await fetch(`${API}/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`, {
      headers: authHeaders(token),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(`Stripe API ${res.status}: ${(data.error as any)?.message ?? "unknown"}`);
    return data;
  });

  ctx.registerNodeType("stripe-list", async (config, execCtx) => {
    const { token, resource, limit, startingAfter } = { ...execCtx.inputs, ...config } as {
      token: string; resource: string; limit?: number; startingAfter?: string;
    };
    const params = new URLSearchParams({ limit: String(limit ?? 10) });
    if (startingAfter) params.set("starting_after", startingAfter);
    const res = await fetch(`${API}/${encodeURIComponent(resource)}?${params.toString()}`, {
      headers: authHeaders(token),
    });
    const data = (await res.json()) as { data: Array<Record<string, unknown>>; has_more: boolean };
    if (!res.ok) throw new Error(`Stripe list ${res.status}`);
    return { items: data.data, hasMore: data.has_more, count: data.data.length };
  });
}
