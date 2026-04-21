/**
 * Stirrup Plugin: Google Drive
 * Node types: gdrive-list, gdrive-upload, gdrive-download, gdrive-delete,
 *             gdrive-create-folder, gdrive-share
 *
 * Auth: OAuth 2.0 access token under service "google-drive" (or the
 * generic "google") with scope https://www.googleapis.com/auth/drive.
 * For public file downloads `file.webContentLink` works without auth, but
 * our handlers always use the API so the token is required.
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";
import { safeFetch, safeArrayBuffer } from "../safeFetch.js";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await safeFetch(`${API}${path}`, {
    ...init,
    headers: { ...authHeaders(token), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Drive API ${res.status}: ${await res.text()}`);
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("gdrive-list", async (config, execCtx) => {
    const { token, query, pageSize, pageToken, orderBy, fields } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; query?: string; pageSize?: number; pageToken?: string;
      orderBy?: string; fields?: string;
    };
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    params.set("pageSize", String(pageSize ?? 50));
    if (pageToken) params.set("pageToken", pageToken);
    if (orderBy) params.set("orderBy", orderBy);
    params.set("fields", fields ?? "nextPageToken, files(id,name,mimeType,size,modifiedTime,parents,webViewLink)");

    const data = await call<{ files: Array<Record<string, unknown>>; nextPageToken?: string }>(
      token, `/files?${params.toString()}`,
    );
    return { files: data.files, nextPageToken: data.nextPageToken, count: data.files.length };
  });

  // Multipart upload: metadata + binary content in one request. For files
  // larger than ~5 MB users should switch to a resumable upload — we
  // leave that to a future handler rather than adding complexity here.
  ctx.registerNodeType("gdrive-upload", async (config, execCtx) => {
    const { token, name, mimeType, content, contentBase64, parents } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; name: string;
      mimeType?: string;
      content?: string; contentBase64?: string;
      parents?: string[];
    };
    if (!content && !contentBase64) throw new Error("gdrive-upload requires content or contentBase64");

    const metadata = JSON.stringify({ name, parents, mimeType });
    const body = Buffer.isEncoding("base64") && contentBase64
      ? Buffer.from(contentBase64, "base64")
      : Buffer.from(content ?? "", "utf-8");

    const boundary = `boundary_${Date.now().toString(36)}`;
    const prefix =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${metadata}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType ?? "application/octet-stream"}\r\n\r\n`;
    const suffix = `\r\n--${boundary}--`;

    const fullBody = Buffer.concat([Buffer.from(prefix, "utf-8"), body, Buffer.from(suffix, "utf-8")]);

    const res = await safeFetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,webViewLink`, {
      method: "POST",
      headers: {
        ...authHeaders(token),
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: new Uint8Array(fullBody),
    });
    if (!res.ok) throw new Error(`Drive upload ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as Record<string, unknown>;
    return {
      fileId: data.id, name: data.name, mimeType: data.mimeType, webViewLink: data.webViewLink,
    };
  });

  ctx.registerNodeType("gdrive-download", async (config, execCtx) => {
    const { token, fileId, asText } = { ...execCtx.inputs, ...config } as {
      token: string; fileId: string; asText?: boolean;
    };
    const res = await safeFetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers: authHeaders(token),
    });
    if (!res.ok) throw new Error(`Drive download ${res.status}: ${await res.text()}`);
    if (asText) {
      return { content: await res.text() };
    }
    const buf = Buffer.from(await safeArrayBuffer(res));
    return { contentBase64: buf.toString("base64"), byteLength: buf.length };
  });

  ctx.registerNodeType("gdrive-delete", async (config, execCtx) => {
    const { token, fileId } = { ...execCtx.inputs, ...config } as {
      token: string; fileId: string;
    };
    await call<void>(token, `/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
    return { deleted: true, fileId };
  });

  ctx.registerNodeType("gdrive-create-folder", async (config, execCtx) => {
    const { token, name, parents } = { ...execCtx.inputs, ...config } as {
      token: string; name: string; parents?: string[];
    };
    const data = await call<{ id: string; name: string; webViewLink?: string }>(
      token, "/files?fields=id,name,webViewLink",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          parents,
          mimeType: "application/vnd.google-apps.folder",
        }),
      },
    );
    return { folderId: data.id, name: data.name, webViewLink: data.webViewLink };
  });

  // Share a file. Type "user" needs an email; "anyone" makes the file
  // publicly accessible — caller is responsible for understanding
  // the implications before widening access.
  ctx.registerNodeType("gdrive-share", async (config, execCtx) => {
    const { token, fileId, role, type, emailAddress, notify } = {
      ...execCtx.inputs, ...config,
    } as {
      token: string; fileId: string;
      role: "reader" | "commenter" | "writer";
      type: "user" | "group" | "domain" | "anyone";
      emailAddress?: string; notify?: boolean;
    };
    const params = new URLSearchParams();
    if (notify === false) params.set("sendNotificationEmail", "false");
    const data = await call<{ id: string; role: string; type: string }>(
      token,
      `/files/${encodeURIComponent(fileId)}/permissions?${params.toString()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, type, emailAddress }),
      },
    );
    return { permissionId: data.id, role: data.role, type: data.type };
  });
}
