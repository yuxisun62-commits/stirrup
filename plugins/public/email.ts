/**
 * Stirrup Plugin: Email (SMTP)
 * Node types: email-send
 * Requires: nodemailer (peer dependency)
 */
import type { PluginContext } from "../../src/plugins/PluginManifest.js";

export default function register(ctx: PluginContext) {
  ctx.registerNodeType("email-send", async (config, execCtx) => {
    const {
      host, port, secure, user, pass,
      from, to, cc, bcc, subject, text, html, attachments,
    } = { ...execCtx.inputs, ...config } as {
      host?: string; port?: number; secure?: boolean; user?: string; pass?: string;
      from: string; to: string; cc?: string; bcc?: string;
      subject: string; text?: string; html?: string;
      attachments?: Array<{ filename: string; content: string }>;
    };

    // Dynamic import nodemailer — it's a peer dependency
    let nodemailer: any;
    try {
      nodemailer = await import("nodemailer");
    } catch {
      throw new Error("nodemailer is required: npm install nodemailer");
    }

    const transport = nodemailer.createTransport({
      host: host ?? process.env.SMTP_HOST ?? "smtp.gmail.com",
      port: port ?? Number(process.env.SMTP_PORT ?? 587),
      secure: secure ?? false,
      auth: {
        user: user ?? process.env.SMTP_USER,
        pass: pass ?? process.env.SMTP_PASS,
      },
    });

    const info = await transport.sendMail({
      from, to, cc, bcc, subject,
      text, html, attachments,
    });

    return {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
    };
  });
}
