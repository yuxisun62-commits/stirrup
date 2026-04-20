/**
 * Catalog of every built-in and plugin node type the UI knows how to
 * render nicely. Palette, canvas, and inspector all read from here so a
 * visual update — new icon, new color, new category — only has to happen
 * in one place.
 *
 * Fallback: when a node type arrives from the server that isn't in this
 * table, the palette infers a reasonable default from the service prefix
 * (before the first `-`). That means plugins we ship WITHOUT updating
 * this file still render functionally — they just get the generic
 * plugin styling instead of a branded one.
 */

export type NodeCategory =
  | "Core"
  | "AI"
  | "Communication"
  | "Productivity"
  | "CRM & Support"
  | "Data & Storage"
  | "Commerce"
  | "Cloud & DevOps"
  | "Utility";

export interface NodeMetadata {
  type: string;
  label: string;
  description: string;
  icon: string;          // 2-4 char monospace label rendered inside the palette tile
  color: string;         // hex; all variants (hover, border, tile bg) derived from this
  category: NodeCategory;
  /** Plugin package name — used to group in palette and match to Connections */
  service?: string;
}

// ── Built-in types ────────────────────────────────────────────────────
const CORE: NodeMetadata[] = [
  { type: "transform",        label: "Transform",        description: "Evaluate a JS expression on inputs",               icon: "f(x)", color: "#6366f1", category: "Core" },
  { type: "condition",        label: "Condition",        description: "Branch based on an expression",                    icon: "?:",   color: "#f59e0b", category: "Core" },
  { type: "http",             label: "HTTP Request",     description: "Make HTTP calls to external APIs",                 icon: "GET",  color: "#06b6d4", category: "Core" },
  { type: "script",           label: "Script",           description: "Run arbitrary JS in a sandbox",                    icon: "{ }",  color: "#8b5cf6", category: "Core" },
  { type: "iterate",          label: "Iterate",          description: "Loop an inner node over an array",                 icon: "∀",    color: "#22d3ee", category: "Core" },
  { type: "passthrough",      label: "Passthrough",      description: "Forward inputs unchanged",                         icon: "→",    color: "#64748b", category: "Core" },
  { type: "fail",             label: "Fail",             description: "Throw a workflow-level error",                     icon: "!",    color: "#ef4444", category: "Core" },
  { type: "sub-workflow",     label: "Sub-workflow",     description: "Call another workflow inline and await its result", icon: "⤴",    color: "#8b5cf6", category: "Core" },
  { type: "merge",            label: "Merge",            description: "Combine items from multiple sources",              icon: "⋃",    color: "#14b8a6", category: "Core" },
];

// ── AI ────────────────────────────────────────────────────────────────
const AI: NodeMetadata[] = [
  { type: "llm-prompt",       label: "LLM Prompt",       description: "Send a templated prompt to the configured model",  icon: "AI",   color: "#f97316", category: "AI" },
  { type: "agent-tool-use",   label: "Agent",            description: "Autonomous AI with tool access",                   icon: "BOT",  color: "#14b8a6", category: "AI" },
  { type: "decision-routing", label: "AI Decision",      description: "AI picks the next branch",                         icon: "RTE",  color: "#a855f7", category: "AI" },
  { type: "code-generation",  label: "Code Gen",         description: "AI generates & runs code",                         icon: "</>",  color: "#84cc16", category: "AI" },
  // openai-extras
  { type: "openai-image",            label: "OpenAI Image",        description: "Generate images via DALL-E / gpt-image-1",       icon: "IMG", color: "#10b981", category: "AI", service: "openai-extras" },
  { type: "openai-embeddings",       label: "OpenAI Embeddings",   description: "Turn text into vector embeddings",               icon: "[·]", color: "#10b981", category: "AI", service: "openai-extras" },
  { type: "openai-tts",              label: "OpenAI TTS",          description: "Text-to-speech with six voices",                  icon: "TTS", color: "#10b981", category: "AI", service: "openai-extras" },
  { type: "openai-whisper",          label: "OpenAI Whisper",      description: "Audio transcription",                             icon: "STT", color: "#10b981", category: "AI", service: "openai-extras" },
  { type: "openai-moderations",      label: "OpenAI Moderation",   description: "Flag unsafe content",                             icon: "MOD", color: "#10b981", category: "AI", service: "openai-extras" },
  // alt LLMs
  { type: "groq-chat",               label: "Groq Chat",           description: "Ultra-fast Llama/Mixtral chat",                   icon: "GRQ", color: "#f5751e", category: "AI", service: "groq" },
  { type: "groq-transcribe",         label: "Groq Transcribe",     description: "Fast Whisper transcription",                      icon: "GRT", color: "#f5751e", category: "AI", service: "groq" },
  { type: "groq-translate",          label: "Groq Translate",      description: "Whisper translate-to-English",                    icon: "GRX", color: "#f5751e", category: "AI", service: "groq" },
  { type: "perplexity-chat",         label: "Perplexity",          description: "LLM with live web search + citations",            icon: "PPL", color: "#20b2aa", category: "AI", service: "perplexity" },
  { type: "perplexity-search",       label: "PPL Search",          description: "One-shot web search via Perplexity",              icon: "SRC", color: "#20b2aa", category: "AI", service: "perplexity" },
  { type: "mistral-chat",            label: "Mistral Chat",        description: "Mistral Large / Small chat",                      icon: "MST", color: "#ff7000", category: "AI", service: "mistral" },
  { type: "mistral-embeddings",      label: "Mistral Embed",       description: "Mistral-embed vectors",                           icon: "MSE", color: "#ff7000", category: "AI", service: "mistral" },
  // replicate (kept in AI)
  { type: "replicate-run",           label: "Replicate Run",       description: "Run any hosted model",                            icon: "RPL", color: "#000000", category: "AI", service: "replicate" },
  { type: "replicate-image",         label: "Replicate Image",     description: "Flux / SDXL image generation",                    icon: "RPI", color: "#000000", category: "AI", service: "replicate" },
  // Hugging Face
  { type: "hf-inference",            label: "HF Inference",        description: "Call any Hugging Face model",                     icon: "HF",  color: "#ffcc4d", category: "AI", service: "huggingface" },
  { type: "hf-text-generation",      label: "HF Text Gen",         description: "Open-source text generation",                     icon: "HFG", color: "#ffcc4d", category: "AI", service: "huggingface" },
  { type: "hf-text-classification",  label: "HF Classify",         description: "Sentiment / classification",                      icon: "HFC", color: "#ffcc4d", category: "AI", service: "huggingface" },
  { type: "hf-summarization",        label: "HF Summarize",        description: "Summarization models",                            icon: "HFS", color: "#ffcc4d", category: "AI", service: "huggingface" },
  { type: "hf-question-answering",   label: "HF Q&A",              description: "Extractive question answering",                   icon: "HFQ", color: "#ffcc4d", category: "AI", service: "huggingface" },
  { type: "hf-embeddings",           label: "HF Embeddings",       description: "sentence-transformers embeddings",                icon: "HFE", color: "#ffcc4d", category: "AI", service: "huggingface" },
  { type: "hf-zero-shot-classification", label: "HF Zero-Shot",    description: "Classify into arbitrary labels",                  icon: "HFZ", color: "#ffcc4d", category: "AI", service: "huggingface" },
  // ElevenLabs
  { type: "elevenlabs-tts",          label: "ElevenLabs TTS",      description: "Best-in-class TTS",                               icon: "11L", color: "#eab308", category: "AI", service: "elevenlabs" },
  { type: "elevenlabs-list-voices",  label: "11L Voices",          description: "List available voices",                           icon: "11V", color: "#eab308", category: "AI", service: "elevenlabs" },
  { type: "elevenlabs-clone-voice",  label: "11L Clone",           description: "Clone a voice from audio samples",                icon: "11C", color: "#eab308", category: "AI", service: "elevenlabs" },
  { type: "elevenlabs-speech-to-text", label: "11L STT",           description: "Scribe v1 transcription",                         icon: "11S", color: "#eab308", category: "AI", service: "elevenlabs" },
];

// ── Communication ────────────────────────────────────────────────────
const COMMS: NodeMetadata[] = [
  { type: "slack-send",          label: "Slack Send",        description: "Post a message to a channel",     icon: "SL",  color: "#4a154b", category: "Communication", service: "slack" },
  { type: "slack-send-blocks",   label: "Slack Blocks",      description: "Rich block-kit message",          icon: "SLB", color: "#4a154b", category: "Communication", service: "slack" },
  { type: "slack-upload-file",   label: "Slack Upload",      description: "Upload a file to channels",       icon: "SLU", color: "#4a154b", category: "Communication", service: "slack" },
  { type: "discord-send",        label: "Discord Send",      description: "Bot message to a channel",        icon: "DS",  color: "#5865f2", category: "Communication", service: "discord" },
  { type: "discord-edit",        label: "Discord Edit",      description: "Edit an existing message",        icon: "DSE", color: "#5865f2", category: "Communication", service: "discord" },
  { type: "discord-delete",      label: "Discord Delete",    description: "Delete a message",                icon: "DSD", color: "#5865f2", category: "Communication", service: "discord" },
  { type: "discord-react",       label: "Discord React",     description: "Add a reaction",                  icon: "DSR", color: "#5865f2", category: "Communication", service: "discord" },
  { type: "discord-list-messages", label: "Discord List",    description: "Fetch message history",           icon: "DSL", color: "#5865f2", category: "Communication", service: "discord" },
  { type: "telegram-send",       label: "Telegram Send",     description: "Bot sendMessage",                 icon: "TG",  color: "#0088cc", category: "Communication", service: "telegram" },
  { type: "telegram-send-photo", label: "Telegram Photo",    description: "Bot sendPhoto",                   icon: "TGP", color: "#0088cc", category: "Communication", service: "telegram" },
  { type: "telegram-edit",       label: "Telegram Edit",     description: "editMessageText",                 icon: "TGE", color: "#0088cc", category: "Communication", service: "telegram" },
  { type: "telegram-delete",     label: "Telegram Delete",   description: "deleteMessage",                   icon: "TGD", color: "#0088cc", category: "Communication", service: "telegram" },
  { type: "telegram-set-webhook", label: "Telegram Webhook", description: "Register a setWebhook URL",       icon: "TGW", color: "#0088cc", category: "Communication", service: "telegram" },
  { type: "gmail-send",          label: "Gmail Send",        description: "Send an email via Gmail",         icon: "GM",  color: "#ea4335", category: "Communication", service: "gmail" },
  { type: "gmail-list-messages", label: "Gmail List",        description: "List / search inbox messages",    icon: "GML", color: "#ea4335", category: "Communication", service: "gmail" },
  { type: "gmail-get-message",   label: "Gmail Get",         description: "Fetch one message by id",         icon: "GMG", color: "#ea4335", category: "Communication", service: "gmail" },
  { type: "gmail-search",        label: "Gmail Search",      description: "Query syntax search",             icon: "GMS", color: "#ea4335", category: "Communication", service: "gmail" },
  { type: "sendgrid-send",       label: "SendGrid Send",     description: "Transactional email",             icon: "SG",  color: "#1a82e2", category: "Communication", service: "sendgrid" },
  { type: "sendgrid-send-template", label: "SG Template",    description: "Send a dynamic template",         icon: "SGT", color: "#1a82e2", category: "Communication", service: "sendgrid" },
  { type: "sendgrid-add-contact", label: "SG Contact",       description: "Add contact to a marketing list", icon: "SGC", color: "#1a82e2", category: "Communication", service: "sendgrid" },
  { type: "resend-send",         label: "Resend Send",       description: "Clean transactional email",       icon: "RS",  color: "#000000", category: "Communication", service: "resend" },
  { type: "resend-batch",        label: "Resend Batch",      description: "Bulk send up to 100",             icon: "RSB", color: "#000000", category: "Communication", service: "resend" },
  { type: "resend-list-emails",  label: "Resend List",       description: "List recent emails",              icon: "RSL", color: "#000000", category: "Communication", service: "resend" },
  { type: "twilio-sms",          label: "Twilio SMS",        description: "Send SMS via Twilio",             icon: "TW",  color: "#f22f46", category: "Communication", service: "twilio" },
  { type: "twilio-whatsapp",     label: "Twilio WhatsApp",   description: "WhatsApp via Twilio",             icon: "TWW", color: "#f22f46", category: "Communication", service: "twilio" },
  { type: "twilio-call",         label: "Twilio Call",       description: "Initiate a voice call",           icon: "TWC", color: "#f22f46", category: "Communication", service: "twilio" },
  { type: "twilio-verify",       label: "Twilio Verify",     description: "Send 2FA verification code",      icon: "TWV", color: "#f22f46", category: "Communication", service: "twilio" },
  { type: "email-send",          label: "SMTP Email",        description: "Send email via SMTP (nodemailer)", icon: "SMTP", color: "#6b7280", category: "Communication", service: "email" },
  { type: "linkedin-create-post", label: "LinkedIn Post",    description: "Post to your feed",               icon: "LI",  color: "#0a66c2", category: "Communication", service: "linkedin" },
  { type: "linkedin-create-org-post", label: "LinkedIn Org", description: "Post to a company page",          icon: "LIO", color: "#0a66c2", category: "Communication", service: "linkedin" },
  { type: "linkedin-get-me",     label: "LinkedIn Me",       description: "Fetch your profile + URN",        icon: "LIM", color: "#0a66c2", category: "Communication", service: "linkedin" },
  { type: "linkedin-get-post-stats", label: "LinkedIn Stats", description: "Post impressions/likes",         icon: "LIS", color: "#0a66c2", category: "Communication", service: "linkedin" },
  { type: "linkedin-list-posts", label: "LinkedIn Feed",     description: "Recent shares",                   icon: "LIF", color: "#0a66c2", category: "Communication", service: "linkedin" },
  { type: "typefully-create-draft", label: "Typefully Draft", description: "Schedule X/LinkedIn post",       icon: "TF",  color: "#1d9bf0", category: "Communication", service: "typefully" },
  { type: "typefully-list-drafts", label: "Typefully List",  description: "List drafts",                     icon: "TFL", color: "#1d9bf0", category: "Communication", service: "typefully" },
  { type: "buffer-schedule",     label: "Buffer Schedule",   description: "Schedule cross-platform post",    icon: "BF",  color: "#168eea", category: "Communication", service: "buffer" },
  { type: "buffer-list-profiles", label: "Buffer Profiles",  description: "Connected social channels",       icon: "BFP", color: "#168eea", category: "Communication", service: "buffer" },
  { type: "buffer-queue-status", label: "Buffer Queue",      description: "Pending posts in a queue",        icon: "BFQ", color: "#168eea", category: "Communication", service: "buffer" },
  { type: "webhook-send",        label: "Webhook Send",      description: "Outbound webhook with HMAC",      icon: "WH",  color: "#ec4899", category: "Communication" },
  { type: "webhook-batch",       label: "Webhook Batch",     description: "Fan-out to many URLs",            icon: "WHB", color: "#ec4899", category: "Communication" },
];

// ── Productivity ─────────────────────────────────────────────────────
const PRODUCTIVITY: NodeMetadata[] = [
  { type: "sheets-read",     label: "Sheets Read",    description: "Read a range",                  icon: "GS",  color: "#0f9d58", category: "Productivity", service: "google-sheets" },
  { type: "sheets-append",   label: "Sheets Append",  description: "Append rows",                   icon: "GSA", color: "#0f9d58", category: "Productivity", service: "google-sheets" },
  { type: "sheets-update",   label: "Sheets Update",  description: "Update a range",                icon: "GSU", color: "#0f9d58", category: "Productivity", service: "google-sheets" },
  { type: "sheets-clear",    label: "Sheets Clear",   description: "Clear a range",                 icon: "GSC", color: "#0f9d58", category: "Productivity", service: "google-sheets" },
  { type: "sheets-create",   label: "Sheets Create",  description: "Create a spreadsheet",          icon: "GSN", color: "#0f9d58", category: "Productivity", service: "google-sheets" },
  { type: "gdrive-list",     label: "Drive List",     description: "List Drive files",              icon: "GD",  color: "#4285f4", category: "Productivity", service: "google-drive" },
  { type: "gdrive-upload",   label: "Drive Upload",   description: "Upload a file",                 icon: "GDU", color: "#4285f4", category: "Productivity", service: "google-drive" },
  { type: "gdrive-download", label: "Drive Download", description: "Download file content",         icon: "GDD", color: "#4285f4", category: "Productivity", service: "google-drive" },
  { type: "gdrive-delete",   label: "Drive Delete",   description: "Delete a file",                 icon: "GDX", color: "#4285f4", category: "Productivity", service: "google-drive" },
  { type: "gdrive-create-folder", label: "Drive Folder", description: "Create a folder",             icon: "GDF", color: "#4285f4", category: "Productivity", service: "google-drive" },
  { type: "gdrive-share",    label: "Drive Share",    description: "Set permissions",               icon: "GDS", color: "#4285f4", category: "Productivity", service: "google-drive" },
  { type: "gcal-list-events", label: "Cal List",      description: "List calendar events",          icon: "GC",  color: "#4285f4", category: "Productivity", service: "google-calendar" },
  { type: "gcal-create-event", label: "Cal Create",   description: "Create an event",               icon: "GCC", color: "#4285f4", category: "Productivity", service: "google-calendar" },
  { type: "gcal-update-event", label: "Cal Update",   description: "Update an event",               icon: "GCU", color: "#4285f4", category: "Productivity", service: "google-calendar" },
  { type: "gcal-delete-event", label: "Cal Delete",   description: "Delete an event",               icon: "GCX", color: "#4285f4", category: "Productivity", service: "google-calendar" },
  { type: "gcal-list-calendars", label: "Cal List Cals", description: "List your calendars",        icon: "GCL", color: "#4285f4", category: "Productivity", service: "google-calendar" },
  { type: "notion-create-page", label: "Notion Page", description: "Create a Notion page",          icon: "NT",  color: "#000000", category: "Productivity", service: "notion" },
  { type: "notion-update-page", label: "Notion Update", description: "Update page properties",      icon: "NTU", color: "#000000", category: "Productivity", service: "notion" },
  { type: "notion-get-page", label: "Notion Get",     description: "Fetch a page",                  icon: "NTG", color: "#000000", category: "Productivity", service: "notion" },
  { type: "notion-query-database", label: "Notion DB",description: "Query a Notion database",       icon: "NTD", color: "#000000", category: "Productivity", service: "notion" },
  { type: "notion-append-block", label: "Notion Block", description: "Append blocks to a page",     icon: "NTB", color: "#000000", category: "Productivity", service: "notion" },
  { type: "notion-search",   label: "Notion Search",  description: "Search across workspace",       icon: "NTS", color: "#000000", category: "Productivity", service: "notion" },
  { type: "airtable-list",   label: "Airtable List",  description: "List records in a table",       icon: "AT",  color: "#fcb400", category: "Productivity", service: "airtable" },
  { type: "airtable-get",    label: "Airtable Get",   description: "Get a record by id",            icon: "ATG", color: "#fcb400", category: "Productivity", service: "airtable" },
  { type: "airtable-create", label: "Airtable Create", description: "Create records (bulk ≤ 10)",   icon: "ATC", color: "#fcb400", category: "Productivity", service: "airtable" },
  { type: "airtable-update", label: "Airtable Update", description: "Update a record",              icon: "ATU", color: "#fcb400", category: "Productivity", service: "airtable" },
  { type: "airtable-delete", label: "Airtable Delete", description: "Delete a record",              icon: "ATX", color: "#fcb400", category: "Productivity", service: "airtable" },
  { type: "airtable-upsert", label: "Airtable Upsert", description: "Upsert on merge keys",         icon: "ATP", color: "#fcb400", category: "Productivity", service: "airtable" },
  { type: "linear-create-issue", label: "Linear Create", description: "Create a Linear issue",      icon: "LN",  color: "#5e6ad2", category: "Productivity", service: "linear" },
  { type: "linear-update-issue", label: "Linear Update", description: "Update issue fields",        icon: "LNU", color: "#5e6ad2", category: "Productivity", service: "linear" },
  { type: "linear-search",   label: "Linear Search",  description: "Search issues",                 icon: "LNS", color: "#5e6ad2", category: "Productivity", service: "linear" },
  { type: "linear-get-issue", label: "Linear Get",    description: "Fetch one issue",               icon: "LNG", color: "#5e6ad2", category: "Productivity", service: "linear" },
  { type: "linear-create-comment", label: "Linear Comment", description: "Add a comment",           icon: "LNC", color: "#5e6ad2", category: "Productivity", service: "linear" },
  { type: "jira-create-issue", label: "Jira Create",  description: "Create a Jira issue",           icon: "JR",  color: "#0052cc", category: "Productivity", service: "jira" },
  { type: "jira-update-issue", label: "Jira Update",  description: "Update issue fields",           icon: "JRU", color: "#0052cc", category: "Productivity", service: "jira" },
  { type: "jira-get-issue",  label: "Jira Get",       description: "Fetch one issue",               icon: "JRG", color: "#0052cc", category: "Productivity", service: "jira" },
  { type: "jira-search",     label: "Jira Search",    description: "JQL search",                    icon: "JRS", color: "#0052cc", category: "Productivity", service: "jira" },
  { type: "jira-add-comment", label: "Jira Comment",  description: "Add an ADF comment",            icon: "JRC", color: "#0052cc", category: "Productivity", service: "jira" },
  { type: "jira-transition", label: "Jira Transition", description: "Move through workflow",        icon: "JRT", color: "#0052cc", category: "Productivity", service: "jira" },
  { type: "trello-create-card", label: "Trello Create", description: "Create a card",               icon: "TR",  color: "#0079bf", category: "Productivity", service: "trello" },
  { type: "trello-update-card", label: "Trello Update", description: "Update a card",               icon: "TRU", color: "#0079bf", category: "Productivity", service: "trello" },
  { type: "trello-get-card", label: "Trello Get",     description: "Fetch a card",                  icon: "TRG", color: "#0079bf", category: "Productivity", service: "trello" },
  { type: "trello-list-cards", label: "Trello List",  description: "List cards in a list",          icon: "TRL", color: "#0079bf", category: "Productivity", service: "trello" },
  { type: "trello-delete-card", label: "Trello Delete", description: "Delete a card",               icon: "TRX", color: "#0079bf", category: "Productivity", service: "trello" },
  { type: "trello-create-list", label: "Trello New List", description: "Create a list on a board",  icon: "TRN", color: "#0079bf", category: "Productivity", service: "trello" },
  { type: "trello-add-comment", label: "Trello Comment", description: "Comment on a card",          icon: "TRC", color: "#0079bf", category: "Productivity", service: "trello" },
  { type: "calendly-list-events", label: "Calendly List", description: "List scheduled events",     icon: "CL",  color: "#006bff", category: "Productivity", service: "calendly" },
  { type: "calendly-get-event", label: "Calendly Get", description: "Fetch an event",               icon: "CLG", color: "#006bff", category: "Productivity", service: "calendly" },
  { type: "calendly-list-invitees", label: "Calendly Invitees", description: "Event attendees",     icon: "CLI", color: "#006bff", category: "Productivity", service: "calendly" },
  { type: "calendly-cancel-event", label: "Calendly Cancel", description: "Cancel an event",        icon: "CLX", color: "#006bff", category: "Productivity", service: "calendly" },
  { type: "calendly-list-event-types", label: "Calendly Types", description: "Event types",         icon: "CLT", color: "#006bff", category: "Productivity", service: "calendly" },
  { type: "calendly-create-scheduling-link", label: "Calendly Link", description: "Single-use booking link", icon: "CLL", color: "#006bff", category: "Productivity", service: "calendly" },
  { type: "github-create-issue", label: "GH Issue",   description: "Create a GitHub issue",         icon: "GH",  color: "#24292e", category: "Productivity", service: "github" },
  { type: "github-post-comment", label: "GH Comment", description: "Comment on an issue/PR",        icon: "GHC", color: "#24292e", category: "Productivity", service: "github" },
  { type: "github-get-pr",   label: "GH Get PR",      description: "Fetch PR + diff",               icon: "GHP", color: "#24292e", category: "Productivity", service: "github" },
  { type: "github-create-pr", label: "GH New PR",     description: "Open a PR",                     icon: "GHN", color: "#24292e", category: "Productivity", service: "github" },
  { type: "github-list-files", label: "GH Files",     description: "List files in a PR",            icon: "GHF", color: "#24292e", category: "Productivity", service: "github" },
  { type: "github-create-repo", label: "GH Repo",     description: "Create a repo (idempotent)",    icon: "GHR", color: "#24292e", category: "Productivity", service: "github" },
  { type: "scaffold-files",  label: "Scaffold Files", description: "Extract files from markers",    icon: "SCF", color: "#737373", category: "Productivity", service: "git" },
  { type: "git-init-push",   label: "Git Init+Push",  description: "Init repo, commit, push",       icon: "GI",  color: "#737373", category: "Productivity", service: "git" },
  { type: "git-clone",       label: "Git Clone",      description: "Clone a remote repo",           icon: "GCL", color: "#737373", category: "Productivity", service: "git" },
  { type: "codebase-read",   label: "Read Codebase",  description: "Read repo contents into memory", icon: "CRD", color: "#737373", category: "Productivity", service: "git" },
  { type: "git-branch-push", label: "Git Branch Push", description: "Commit to a branch",           icon: "GBP", color: "#737373", category: "Productivity", service: "git" },
];

// ── CRM & Support ────────────────────────────────────────────────────
const CRM: NodeMetadata[] = [
  { type: "hubspot-create-contact", label: "HubSpot Contact", description: "Create a CRM contact",       icon: "HS",  color: "#ff7a59", category: "CRM & Support", service: "hubspot" },
  { type: "hubspot-update-contact", label: "HubSpot Update",  description: "Update contact props",       icon: "HSU", color: "#ff7a59", category: "CRM & Support", service: "hubspot" },
  { type: "hubspot-get-contact", label: "HubSpot Get",        description: "Fetch contact by id",        icon: "HSG", color: "#ff7a59", category: "CRM & Support", service: "hubspot" },
  { type: "hubspot-search-contacts", label: "HubSpot Search", description: "CRM v3 contact search",      icon: "HSS", color: "#ff7a59", category: "CRM & Support", service: "hubspot" },
  { type: "hubspot-create-deal", label: "HubSpot Deal",       description: "Create a deal",              icon: "HSD", color: "#ff7a59", category: "CRM & Support", service: "hubspot" },
  { type: "hubspot-create-engagement", label: "HubSpot Engage", description: "Note / call / email / task", icon: "HSE", color: "#ff7a59", category: "CRM & Support", service: "hubspot" },
  { type: "zendesk-create-ticket", label: "Zendesk Create",   description: "Open a support ticket",      icon: "ZD",  color: "#03363d", category: "CRM & Support", service: "zendesk" },
  { type: "zendesk-update-ticket", label: "Zendesk Update",   description: "Update a ticket",            icon: "ZDU", color: "#03363d", category: "CRM & Support", service: "zendesk" },
  { type: "zendesk-get-ticket",  label: "Zendesk Get",        description: "Fetch a ticket",             icon: "ZDG", color: "#03363d", category: "CRM & Support", service: "zendesk" },
  { type: "zendesk-search-tickets", label: "Zendesk Search",  description: "Zendesk query syntax",       icon: "ZDS", color: "#03363d", category: "CRM & Support", service: "zendesk" },
  { type: "zendesk-add-comment",  label: "Zendesk Comment",   description: "Add a ticket comment",       icon: "ZDC", color: "#03363d", category: "CRM & Support", service: "zendesk" },
  { type: "zendesk-list-users",  label: "Zendesk Users",      description: "List users (by role)",       icon: "ZDL", color: "#03363d", category: "CRM & Support", service: "zendesk" },
  { type: "mailchimp-add-member", label: "Mailchimp Add",     description: "Add a list member",          icon: "MC",  color: "#ffe01b", category: "CRM & Support", service: "mailchimp" },
  { type: "mailchimp-update-member", label: "Mailchimp Upsert", description: "Upsert by md5 email",      icon: "MCU", color: "#ffe01b", category: "CRM & Support", service: "mailchimp" },
  { type: "mailchimp-unsubscribe", label: "Mailchimp Unsub",  description: "Unsubscribe a member",       icon: "MCX", color: "#ffe01b", category: "CRM & Support", service: "mailchimp" },
  { type: "mailchimp-get-member", label: "Mailchimp Get",     description: "Fetch one member",           icon: "MCG", color: "#ffe01b", category: "CRM & Support", service: "mailchimp" },
  { type: "mailchimp-list-campaigns", label: "Mailchimp Camp", description: "List campaigns",            icon: "MCL", color: "#ffe01b", category: "CRM & Support", service: "mailchimp" },
  { type: "mailchimp-create-campaign", label: "MC New Camp",  description: "Create a campaign",          icon: "MCN", color: "#ffe01b", category: "CRM & Support", service: "mailchimp" },
  { type: "mailchimp-send-campaign", label: "MC Send Camp",   description: "Send a campaign",            icon: "MCS", color: "#ffe01b", category: "CRM & Support", service: "mailchimp" },
];

// ── Data & Storage ───────────────────────────────────────────────────
const DATA: NodeMetadata[] = [
  { type: "pg-query",      label: "Postgres Query",  description: "Run raw SQL",                       icon: "PG",  color: "#336791", category: "Data & Storage", service: "postgres" },
  { type: "pg-insert",     label: "Postgres Insert", description: "Bulk-safe insert",                  icon: "PGI", color: "#336791", category: "Data & Storage", service: "postgres" },
  { type: "pg-transaction", label: "Postgres TX",    description: "Multi-statement transaction",        icon: "PGT", color: "#336791", category: "Data & Storage", service: "postgres" },
  { type: "redis-get",     label: "Redis GET",       description: "Read a key",                        icon: "RD",  color: "#dc382d", category: "Data & Storage", service: "redis" },
  { type: "redis-set",     label: "Redis SET",       description: "Set a key (optional TTL)",          icon: "RDS", color: "#dc382d", category: "Data & Storage", service: "redis" },
  { type: "redis-publish", label: "Redis Publish",   description: "Publish pub/sub message",           icon: "RDP", color: "#dc382d", category: "Data & Storage", service: "redis" },
  { type: "redis-list-push", label: "Redis LPUSH",   description: "Push onto a list",                  icon: "RDL", color: "#dc382d", category: "Data & Storage", service: "redis" },
  { type: "mongo-find",    label: "Mongo Find",      description: "Find documents (filter + sort)",    icon: "MG",  color: "#13aa52", category: "Data & Storage", service: "mongodb" },
  { type: "mongo-find-one", label: "Mongo FindOne",  description: "Find a single document",            icon: "MGO", color: "#13aa52", category: "Data & Storage", service: "mongodb" },
  { type: "mongo-insert",  label: "Mongo Insert",    description: "Insert one or many",                icon: "MGI", color: "#13aa52", category: "Data & Storage", service: "mongodb" },
  { type: "mongo-update",  label: "Mongo Update",    description: "updateOne / updateMany",            icon: "MGU", color: "#13aa52", category: "Data & Storage", service: "mongodb" },
  { type: "mongo-delete",  label: "Mongo Delete",    description: "deleteOne / deleteMany",            icon: "MGX", color: "#13aa52", category: "Data & Storage", service: "mongodb" },
  { type: "mongo-aggregate", label: "Mongo Aggregate", description: "Aggregation pipeline",             icon: "MGA", color: "#13aa52", category: "Data & Storage", service: "mongodb" },
  { type: "mongo-count",   label: "Mongo Count",     description: "countDocuments",                    icon: "MGC", color: "#13aa52", category: "Data & Storage", service: "mongodb" },
  { type: "supabase-select", label: "Supabase Select", description: "PostgREST select",                 icon: "SB",  color: "#3ecf8e", category: "Data & Storage", service: "supabase" },
  { type: "supabase-insert", label: "Supabase Insert", description: "Insert rows",                      icon: "SBI", color: "#3ecf8e", category: "Data & Storage", service: "supabase" },
  { type: "supabase-update", label: "Supabase Update", description: "Update rows (requires filter)",    icon: "SBU", color: "#3ecf8e", category: "Data & Storage", service: "supabase" },
  { type: "supabase-upsert", label: "Supabase Upsert", description: "On conflict merge",                icon: "SBP", color: "#3ecf8e", category: "Data & Storage", service: "supabase" },
  { type: "supabase-delete", label: "Supabase Delete", description: "Delete rows (filter required)",    icon: "SBX", color: "#3ecf8e", category: "Data & Storage", service: "supabase" },
  { type: "supabase-rpc",  label: "Supabase RPC",    description: "Call a Postgres function",          icon: "SBR", color: "#3ecf8e", category: "Data & Storage", service: "supabase" },
  { type: "supabase-auth-signup", label: "Supabase Signup", description: "GoTrue signup",               icon: "SBA", color: "#3ecf8e", category: "Data & Storage", service: "supabase" },
  { type: "supabase-auth-signin", label: "Supabase Signin", description: "GoTrue password grant",       icon: "SBL", color: "#3ecf8e", category: "Data & Storage", service: "supabase" },
  { type: "pinecone-upsert", label: "Pinecone Upsert", description: "Upsert vectors + metadata",        icon: "PC",  color: "#000000", category: "Data & Storage", service: "pinecone" },
  { type: "pinecone-query", label: "Pinecone Query", description: "Vector similarity search",          icon: "PCQ", color: "#000000", category: "Data & Storage", service: "pinecone" },
  { type: "pinecone-fetch", label: "Pinecone Fetch", description: "Fetch by id",                       icon: "PCF", color: "#000000", category: "Data & Storage", service: "pinecone" },
  { type: "pinecone-delete", label: "Pinecone Delete", description: "Delete by id/filter",             icon: "PCX", color: "#000000", category: "Data & Storage", service: "pinecone" },
  { type: "pinecone-describe-index", label: "Pinecone Stats", description: "Index dimension + counts", icon: "PCS", color: "#000000", category: "Data & Storage", service: "pinecone" },
  { type: "s3-get",        label: "S3 Get",          description: "Download an object",                icon: "S3",  color: "#f90", category: "Data & Storage", service: "s3" },
  { type: "s3-put",        label: "S3 Put",          description: "Upload an object",                  icon: "S3U", color: "#f90", category: "Data & Storage", service: "s3" },
  { type: "s3-list",       label: "S3 List",         description: "List objects (prefix)",             icon: "S3L", color: "#f90", category: "Data & Storage", service: "s3" },
  { type: "s3-delete",     label: "S3 Delete",       description: "Delete an object",                  icon: "S3X", color: "#f90", category: "Data & Storage", service: "s3" },
  { type: "fs-read",       label: "FS Read",         description: "Read a local file",                 icon: "FS",  color: "#737373", category: "Data & Storage", service: "filesystem" },
  { type: "fs-write",      label: "FS Write",        description: "Write a local file",               icon: "FSW", color: "#737373", category: "Data & Storage", service: "filesystem" },
  { type: "fs-list",       label: "FS List",         description: "List directory",                   icon: "FSL", color: "#737373", category: "Data & Storage", service: "filesystem" },
  { type: "fs-delete",     label: "FS Delete",       description: "Delete a file",                    icon: "FSX", color: "#737373", category: "Data & Storage", service: "filesystem" },
  { type: "csv-parse",     label: "CSV Parse",       description: "Parse CSV into rows",              icon: "CSV", color: "#4ade80", category: "Data & Storage", service: "csv-json" },
  { type: "csv-generate",  label: "CSV Generate",    description: "Serialize rows to CSV",            icon: "CSG", color: "#4ade80", category: "Data & Storage", service: "csv-json" },
  { type: "json-transform", label: "JSON Transform", description: "Map / filter JSON",                icon: "JS",  color: "#4ade80", category: "Data & Storage", service: "csv-json" },
  { type: "json-merge",    label: "JSON Merge",      description: "Deep-merge objects",               icon: "JSM", color: "#4ade80", category: "Data & Storage", service: "csv-json" },
];

// ── Commerce ─────────────────────────────────────────────────────────
const COMMERCE: NodeMetadata[] = [
  { type: "stripe-create-customer", label: "Stripe Customer", description: "Create a customer",         icon: "ST",  color: "#635bff", category: "Commerce", service: "stripe" },
  { type: "stripe-list-customers",  label: "Stripe List Cust", description: "List customers",          icon: "STL", color: "#635bff", category: "Commerce", service: "stripe" },
  { type: "stripe-create-charge",   label: "Stripe Charge",   description: "Create a charge (legacy)",  icon: "STC", color: "#635bff", category: "Commerce", service: "stripe" },
  { type: "stripe-create-payment-intent", label: "Stripe PI", description: "Modern payment intent",     icon: "STP", color: "#635bff", category: "Commerce", service: "stripe" },
  { type: "stripe-create-invoice",  label: "Stripe Invoice",  description: "Create an invoice",         icon: "STI", color: "#635bff", category: "Commerce", service: "stripe" },
  { type: "stripe-create-subscription", label: "Stripe Sub",  description: "Create a subscription",     icon: "STS", color: "#635bff", category: "Commerce", service: "stripe" },
  { type: "stripe-create-checkout-session", label: "Stripe Checkout", description: "Hosted checkout",   icon: "STK", color: "#635bff", category: "Commerce", service: "stripe" },
  { type: "stripe-retrieve", label: "Stripe Retrieve", description: "Get any Stripe resource",          icon: "STR", color: "#635bff", category: "Commerce", service: "stripe" },
  { type: "stripe-list",     label: "Stripe List",     description: "List any resource",                icon: "STX", color: "#635bff", category: "Commerce", service: "stripe" },
  { type: "shopify-list-products", label: "Shopify Products", description: "List products",            icon: "SH",  color: "#96bf48", category: "Commerce", service: "shopify" },
  { type: "shopify-get-product",  label: "Shopify Get",      description: "Get a product",             icon: "SHG", color: "#96bf48", category: "Commerce", service: "shopify" },
  { type: "shopify-create-product", label: "Shopify Create", description: "Create a product",          icon: "SHC", color: "#96bf48", category: "Commerce", service: "shopify" },
  { type: "shopify-update-product", label: "Shopify Update", description: "Update a product",          icon: "SHU", color: "#96bf48", category: "Commerce", service: "shopify" },
  { type: "shopify-list-orders",  label: "Shopify Orders",    description: "List orders",              icon: "SHO", color: "#96bf48", category: "Commerce", service: "shopify" },
  { type: "shopify-get-order",    label: "Shopify Order",     description: "Get an order",             icon: "SHR", color: "#96bf48", category: "Commerce", service: "shopify" },
  { type: "shopify-create-order", label: "Shopify New Order", description: "Create an order",          icon: "SHN", color: "#96bf48", category: "Commerce", service: "shopify" },
  { type: "shopify-list-customers", label: "Shopify Cust",   description: "List / search customers",   icon: "SHL", color: "#96bf48", category: "Commerce", service: "shopify" },
];

// ── Cloud & DevOps ────────────────────────────────────────────────────
const CLOUD: NodeMetadata[] = [
  { type: "lm-deploy",       label: "LM Deploy",      description: "Deploy a service",               icon: "LM",  color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-quicklaunch",  label: "LM Quicklaunch", description: "One-command deploy",             icon: "LMQ", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-rollback",     label: "LM Rollback",    description: "Rollback a service",             icon: "LMR", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-status",       label: "LM Status",      description: "Fetch service health",           icon: "LMS", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-create-project", label: "LM New Project", description: "Idempotent project create",    icon: "LMP", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-list-projects", label: "LM Projects",   description: "List projects in a team",        icon: "LML", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-create-service", label: "LM New Service", description: "Provision a service",         icon: "LMN", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-delete-service", label: "LM Del Service", description: "Delete a service",            icon: "LMX", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-db-create",    label: "LM DB Create",   description: "Create a managed DB",            icon: "LMDB", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-db-query",     label: "LM DB Query",    description: "Run SQL on managed DB",          icon: "LMDQ", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-db-seed",      label: "LM DB Seed",     description: "Seed a DB from SQL",             icon: "LMDS", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-db-credentials", label: "LM DB Creds",  description: "Fetch DB credentials",           icon: "LMDC", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-domain-add",   label: "LM Domain",      description: "Attach a custom domain",         icon: "LMDM", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-domain-verify", label: "LM Verify",     description: "Verify a domain's DNS",          icon: "LMDV", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-domain-list",  label: "LM Domains",     description: "List configured domains",        icon: "LMDL", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-env-set",      label: "LM Env Set",     description: "Set env variables",              icon: "LME", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-env-list",     label: "LM Env List",    description: "List env variables",             icon: "LMEL", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-browser-screenshot", label: "LM Screenshot", description: "Chromium screenshot",        icon: "LMB", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-browser-test", label: "LM Browser Test", description: "Run a Playwright script",       icon: "LMT", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-browser-pdf",  label: "LM Browser PDF", description: "Render a URL as PDF",            icon: "LMPF", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-lightspeed",   label: "LM Lightspeed",  description: "One-shot AI",                    icon: "LMA", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
  { type: "lm-logs",         label: "LM Logs",        description: "Fetch recent service logs",      icon: "LMG", color: "#0ea5e9", category: "Cloud & DevOps", service: "launchmatic" },
];

// ── Utility ──────────────────────────────────────────────────────────
const UTILITY: NodeMetadata[] = [
  { type: "delay",       label: "Delay",       description: "Pause execution for N ms",  icon: "DLY", color: "#94a3b8", category: "Utility", service: "scheduler" },
  { type: "rate-limit",  label: "Rate Limit",  description: "Throttle per minute/hour",   icon: "RL",  color: "#94a3b8", category: "Utility", service: "scheduler" },
  { type: "batch",       label: "Batch",       description: "Batch inputs by size / time", icon: "BT",  color: "#94a3b8", category: "Utility", service: "scheduler" },
  { type: "debounce",    label: "Debounce",    description: "Debounce bursty inputs",     icon: "DB",  color: "#94a3b8", category: "Utility", service: "scheduler" },
  { type: "log",         label: "Log",         description: "Log a message",             icon: "LG",  color: "#94a3b8", category: "Utility", service: "logger" },
  { type: "metric",      label: "Metric",      description: "Emit a metric",             icon: "MT",  color: "#94a3b8", category: "Utility", service: "logger" },
  { type: "assert",      label: "Assert",      description: "Assert a condition",        icon: "AS",  color: "#94a3b8", category: "Utility", service: "logger" },
  { type: "timer",       label: "Timer",       description: "Measure elapsed time",      icon: "TM",  color: "#94a3b8", category: "Utility", service: "logger" },
  { type: "oauth-token", label: "OAuth Token", description: "Exchange grant for token", icon: "OA",  color: "#94a3b8", category: "Utility", service: "http-auth" },
  { type: "api-key-request", label: "API Request", description: "HTTP with API-key auth", icon: "AK", color: "#94a3b8", category: "Utility", service: "http-auth" },
  { type: "jwt-decode",  label: "JWT Decode",  description: "Decode without verifying",   icon: "JT",  color: "#94a3b8", category: "Utility", service: "http-auth" },
  { type: "basic-auth-request", label: "Basic Auth", description: "HTTP with Basic auth", icon: "BA", color: "#94a3b8", category: "Utility", service: "http-auth" },
];

export const NODE_METADATA: Record<string, NodeMetadata> = Object.fromEntries(
  [...CORE, ...AI, ...COMMS, ...PRODUCTIVITY, ...CRM, ...DATA, ...COMMERCE, ...CLOUD, ...UTILITY].map((m) => [m.type, m]),
);

/**
 * Look up metadata for a node type, falling back to a generic entry when
 * the type isn't in the catalog. The palette calls this for every type the
 * server reports so new plugins render SOMETHING even before we've added
 * a branded entry here.
 */
export function getNodeMetadata(type: string): NodeMetadata {
  const hit = NODE_METADATA[type];
  if (hit) return hit;

  // Derive a reasonable default from the type prefix. "zendesk-foo" → zendesk
  // service, grouped under Utility as a catch-all.
  const dashIdx = type.indexOf("-");
  const service = dashIdx > 0 ? type.slice(0, dashIdx) : type;
  const shortLabel = type
    .split("-")
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join(" ");

  return {
    type,
    label: shortLabel,
    description: `Plugin node: ${type}`,
    icon: type.slice(0, 3).toUpperCase(),
    color: "#64748b",
    category: "Utility",
    service,
  };
}

export const ALL_CATEGORIES: NodeCategory[] = [
  "Core",
  "AI",
  "Communication",
  "Productivity",
  "CRM & Support",
  "Data & Storage",
  "Commerce",
  "Cloud & DevOps",
  "Utility",
];
