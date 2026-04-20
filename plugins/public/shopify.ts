/**
 * Stirrup Plugin: Shopify
 * Node types: shopify-list-products, shopify-get-product,
 *             shopify-create-product, shopify-update-product,
 *             shopify-list-orders, shopify-get-order, shopify-create-order,
 *             shopify-list-customers
 *
 * Auth: Admin API access token (service "shopify"), stored as
 * "<shop-name>|<access-token>" — the shop name (without .myshopify.com)
 * goes on the left of the pipe, the token on the right. Each request
 * reads both out to build the URL and Header respectively.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch } from "../../src/plugins/safeFetch.js";

const API_VERSION = "2024-10";

interface ShopifyAuth {
  shop: string;
  token: string;
}

function parseAuth(tokenValue: string): ShopifyAuth {
  if (!tokenValue.includes("|")) {
    throw new Error(
      'Shopify token must be "<shop-name>|<access-token>". Paste it that way in Connections.',
    );
  }
  const [shop, token] = tokenValue.split("|");
  return { shop, token };
}

async function call<T>(
  auth: ShopifyAuth,
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const url = `https://${auth.shop}.myshopify.com/admin/api/${API_VERSION}${path}`;
  const res = await safeFetch(url, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": auth.token,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Shopify API ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json() as Promise<T>;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("shopify-list-products", async (config, execCtx) => {
    const { token, limit, status, vendor, productType } = {
      ...execCtx.inputs, ...config,
    } as { token: string; limit?: number; status?: string; vendor?: string; productType?: string };
    const auth = parseAuth(token);
    const params = new URLSearchParams({ limit: String(limit ?? 50) });
    if (status) params.set("status", status);
    if (vendor) params.set("vendor", vendor);
    if (productType) params.set("product_type", productType);
    const data = await call<{ products: Array<Record<string, unknown>> }>(
      auth, `/products.json?${params.toString()}`,
    );
    return { products: data!.products, count: data!.products.length };
  });

  ctx.registerNodeType("shopify-get-product", async (config, execCtx) => {
    const { token, productId } = { ...execCtx.inputs, ...config } as {
      token: string; productId: string | number;
    };
    const data = await call<{ product: Record<string, unknown> }>(
      parseAuth(token), `/products/${productId}.json`,
    );
    return { product: data!.product };
  });

  ctx.registerNodeType("shopify-create-product", async (config, execCtx) => {
    const { token, title, body_html, vendor, product_type, tags, variants, images } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; title: string; body_html?: string;
      vendor?: string; product_type?: string; tags?: string[];
      variants?: Array<Record<string, unknown>>;
      images?: Array<Record<string, unknown>>;
    };
    const data = await call<{ product: Record<string, unknown> }>(
      parseAuth(token), "/products.json",
      {
        method: "POST",
        body: JSON.stringify({
          product: { title, body_html, vendor, product_type, tags: tags?.join(", "), variants, images },
        }),
      },
    );
    return { product: data!.product };
  });

  ctx.registerNodeType("shopify-update-product", async (config, execCtx) => {
    const { token, productId, fields } = { ...execCtx.inputs, ...config } as {
      token: string; productId: string | number; fields: Record<string, unknown>;
    };
    const data = await call<{ product: Record<string, unknown> }>(
      parseAuth(token), `/products/${productId}.json`,
      { method: "PUT", body: JSON.stringify({ product: fields }) },
    );
    return { product: data!.product };
  });

  ctx.registerNodeType("shopify-list-orders", async (config, execCtx) => {
    const { token, status, financial_status, limit, createdAtMin, createdAtMax } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; status?: string; financial_status?: string; limit?: number;
      createdAtMin?: string; createdAtMax?: string;
    };
    const params = new URLSearchParams({ limit: String(limit ?? 50) });
    if (status) params.set("status", status);
    if (financial_status) params.set("financial_status", financial_status);
    if (createdAtMin) params.set("created_at_min", createdAtMin);
    if (createdAtMax) params.set("created_at_max", createdAtMax);
    const data = await call<{ orders: Array<Record<string, unknown>> }>(
      parseAuth(token), `/orders.json?${params.toString()}`,
    );
    return { orders: data!.orders, count: data!.orders.length };
  });

  ctx.registerNodeType("shopify-get-order", async (config, execCtx) => {
    const { token, orderId } = { ...execCtx.inputs, ...config } as {
      token: string; orderId: string | number;
    };
    const data = await call<{ order: Record<string, unknown> }>(
      parseAuth(token), `/orders/${orderId}.json`,
    );
    return { order: data!.order };
  });

  ctx.registerNodeType("shopify-create-order", async (config, execCtx) => {
    const { token, lineItems, email, customer, financialStatus, tags } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string;
      lineItems: Array<{ variant_id?: number; quantity: number; title?: string; price?: string }>;
      email?: string; customer?: Record<string, unknown>;
      financialStatus?: string; tags?: string;
    };
    const data = await call<{ order: Record<string, unknown> }>(
      parseAuth(token), "/orders.json",
      {
        method: "POST",
        body: JSON.stringify({
          order: {
            line_items: lineItems,
            email, customer,
            financial_status: financialStatus,
            tags,
          },
        }),
      },
    );
    return { order: data!.order };
  });

  ctx.registerNodeType("shopify-list-customers", async (config, execCtx) => {
    const { token, limit, query } = { ...execCtx.inputs, ...config } as {
      token: string; limit?: number; query?: string;
    };
    const auth = parseAuth(token);
    if (query) {
      const data = await call<{ customers: Array<Record<string, unknown>> }>(
        auth, `/customers/search.json?query=${encodeURIComponent(query)}&limit=${limit ?? 10}`,
      );
      return { customers: data!.customers, count: data!.customers.length };
    }
    const data = await call<{ customers: Array<Record<string, unknown>> }>(
      auth, `/customers.json?limit=${limit ?? 50}`,
    );
    return { customers: data!.customers, count: data!.customers.length };
  });
}
