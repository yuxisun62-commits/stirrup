/**
 * Declarative config-field schemas for plugin node types.
 *
 * Each entry describes the form a plugin node's config should render as
 * so we don't have to write a dedicated React component per type. The
 * SchemaFormEditor walks the `fields` list and renders the appropriate
 * control for each — text, textarea, number, toggle, select, json, or
 * code. Anything the schema doesn't cover falls through to the generic
 * JSON editor (still editable, just not pretty).
 *
 * Coverage strategy: the ~40 node types covered below are the ones an
 * imported workflow is most likely to drop onto the canvas, based on
 * the frequency lists from real n8n + Make scenarios. Everything else
 * gets an auto-generated form from current config keys via the
 * AutoFormEditor fallback.
 */

export type FieldControl =
  | 'text'       // single-line input
  | 'textarea'   // multi-line
  | 'number'     // numeric input
  | 'toggle'     // boolean switch
  | 'select'     // dropdown from `options`
  | 'password'   // type=password input
  | 'json'       // JSON object/array, edited as JSON text
  | 'code';      // monospace textarea for code / templates / SQL

export interface FieldSchema {
  key: string;
  label: string;
  control: FieldControl;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  rows?: number;
  /** `select` only — dropdown options. */
  options?: Array<{ value: string; label: string }>;
  /** `number` only. */
  min?: number;
  max?: number;
  step?: number;
  /**
   * If provided, show this field only when the returned boolean is true.
   * Receives the current config object — common use is revealing
   * a field only when another is set to a specific value.
   */
  showWhen?: (config: Record<string, unknown>) => boolean;
}

export interface NodeSchema {
  type: string;
  fields: FieldSchema[];
}

// Model option lists exported so other schemas (or downstream tooling)
// can reuse them. The OpenAI + Anthropic lists aren't used by any schema
// below yet — the llm-prompt dedicated editor owns its own picker — but
// they're here so future schemas can stay consistent.
export const MODEL_OPTIONS_OPENAI = [
  { value: 'gpt-4o-mini', label: 'gpt-4o-mini (fast, cheap)' },
  { value: 'gpt-4o', label: 'gpt-4o' },
  { value: 'gpt-4-turbo', label: 'gpt-4-turbo' },
  { value: 'o1-mini', label: 'o1-mini' },
  { value: 'o1', label: 'o1' },
];

export const MODEL_OPTIONS_ANTHROPIC = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
];

const MODEL_OPTIONS_GROQ = [
  { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (versatile)' },
  { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (instant)' },
  { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
  { value: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 distill' },
];

const SCHEMAS: NodeSchema[] = [
  // ─── Communication ──────────────────────────────────────────────
  {
    type: 'slack-send',
    fields: [
      { key: 'channel', label: 'Channel', control: 'text', placeholder: '#deploys or C0123ABCDEF', required: true },
      { key: 'text', label: 'Message', control: 'textarea', rows: 3, required: true, hint: 'Supports Slack mrkdwn' },
      { key: 'threadTs', label: 'Thread TS', control: 'text', hint: 'Reply inside a thread (ts from a previous message)' },
    ],
  },
  {
    type: 'slack-send-blocks',
    fields: [
      { key: 'channel', label: 'Channel', control: 'text', required: true },
      { key: 'text', label: 'Fallback text', control: 'text', hint: 'Shown in notifications when blocks can\'t render' },
      { key: 'blocks', label: 'Blocks (JSON array)', control: 'json', rows: 8, required: true },
    ],
  },
  {
    type: 'discord-send',
    fields: [
      { key: 'channelId', label: 'Channel ID', control: 'text', required: true },
      { key: 'content', label: 'Message', control: 'textarea', rows: 3 },
      { key: 'embeds', label: 'Embeds (JSON array)', control: 'json', rows: 5, hint: 'Optional rich embeds' },
      { key: 'tts', label: 'Text-to-speech', control: 'toggle' },
    ],
  },
  {
    type: 'telegram-send',
    fields: [
      { key: 'chatId', label: 'Chat ID', control: 'text', required: true, hint: 'Numeric id or @channel_username' },
      { key: 'text', label: 'Message', control: 'textarea', rows: 3, required: true },
      { key: 'parseMode', label: 'Parse mode', control: 'select', options: [
        { value: '', label: 'None' },
        { value: 'Markdown', label: 'Markdown' },
        { value: 'MarkdownV2', label: 'MarkdownV2' },
        { value: 'HTML', label: 'HTML' },
      ]},
      { key: 'disableWebPagePreview', label: 'Disable link preview', control: 'toggle' },
    ],
  },
  {
    type: 'gmail-send',
    fields: [
      { key: 'to', label: 'To', control: 'text', required: true, hint: 'Comma-separated email addresses' },
      { key: 'subject', label: 'Subject', control: 'text', required: true },
      { key: 'body', label: 'Body', control: 'textarea', rows: 8, required: true },
      { key: 'html', label: 'Treat body as HTML', control: 'toggle' },
      { key: 'cc', label: 'CC', control: 'text' },
      { key: 'bcc', label: 'BCC', control: 'text' },
      { key: 'replyTo', label: 'Reply-To', control: 'text' },
    ],
  },
  {
    type: 'resend-send',
    fields: [
      { key: 'from', label: 'From', control: 'text', required: true, hint: 'Must be on a verified domain' },
      { key: 'to', label: 'To', control: 'text', required: true },
      { key: 'subject', label: 'Subject', control: 'text', required: true },
      { key: 'html', label: 'HTML body', control: 'textarea', rows: 6 },
      { key: 'text', label: 'Text body (fallback)', control: 'textarea', rows: 4 },
      { key: 'cc', label: 'CC', control: 'text' },
      { key: 'bcc', label: 'BCC', control: 'text' },
    ],
  },
  {
    type: 'sendgrid-send',
    fields: [
      { key: 'from', label: 'From', control: 'text', required: true },
      { key: 'fromName', label: 'From name', control: 'text' },
      { key: 'to', label: 'To', control: 'text', required: true },
      { key: 'subject', label: 'Subject', control: 'text', required: true },
      { key: 'text', label: 'Plain-text body', control: 'textarea', rows: 4 },
      { key: 'html', label: 'HTML body', control: 'textarea', rows: 6 },
    ],
  },
  {
    type: 'twilio-sms',
    fields: [
      { key: 'from', label: 'From (E.164)', control: 'text', required: true, placeholder: '+15550001111' },
      { key: 'to', label: 'To (E.164)', control: 'text', required: true },
      { key: 'body', label: 'Message', control: 'textarea', rows: 3, required: true },
      { key: 'mediaUrl', label: 'Media URL', control: 'text', hint: 'Optional MMS attachment' },
    ],
  },
  {
    type: 'webhook-send',
    fields: [
      { key: 'url', label: 'URL', control: 'text', required: true, placeholder: 'https://api.example.com/webhook' },
      { key: 'method', label: 'Method', control: 'select', options: ['POST','PUT','PATCH','GET','DELETE'].map(v => ({value:v, label:v})) },
      { key: 'headers', label: 'Headers (JSON)', control: 'json', rows: 4 },
      { key: 'payload', label: 'Payload (JSON or string)', control: 'json', rows: 6 },
      { key: 'signingSecret', label: 'HMAC signing secret', control: 'password' },
      { key: 'retries', label: 'Retries', control: 'number', min: 0, max: 10 },
      { key: 'timeoutMs', label: 'Timeout (ms)', control: 'number', min: 0 },
    ],
  },

  // ─── AI ────────────────────────────────────────────────────────
  {
    type: 'openai-image',
    fields: [
      { key: 'prompt', label: 'Prompt', control: 'textarea', rows: 4, required: true },
      { key: 'model', label: 'Model', control: 'select', options: [
        { value: 'gpt-image-1', label: 'gpt-image-1' },
        { value: 'dall-e-3', label: 'dall-e-3' },
        { value: 'dall-e-2', label: 'dall-e-2' },
      ]},
      { key: 'size', label: 'Size', control: 'select', options: [
        { value: '1024x1024', label: '1024 x 1024' },
        { value: '1792x1024', label: '1792 x 1024' },
        { value: '1024x1792', label: '1024 x 1792' },
        { value: '512x512', label: '512 x 512 (DALL-E 2)' },
      ]},
      { key: 'quality', label: 'Quality', control: 'select', options: [
        { value: 'standard', label: 'standard' }, { value: 'hd', label: 'hd' },
      ]},
      { key: 'n', label: 'Count', control: 'number', min: 1, max: 10 },
    ],
  },
  {
    type: 'openai-tts',
    fields: [
      { key: 'text', label: 'Text', control: 'textarea', rows: 4, required: true },
      { key: 'voice', label: 'Voice', control: 'select', options: [
        'alloy','echo','fable','onyx','nova','shimmer',
      ].map(v => ({ value: v, label: v }))},
      { key: 'model', label: 'Model', control: 'select', options: [
        { value: 'tts-1', label: 'tts-1 (fast)' },
        { value: 'tts-1-hd', label: 'tts-1-hd' },
      ]},
      { key: 'speed', label: 'Speed', control: 'number', min: 0.25, max: 4, step: 0.25 },
      { key: 'format', label: 'Format', control: 'select', options: [
        'mp3','opus','aac','flac',
      ].map(v => ({ value: v, label: v }))},
    ],
  },
  {
    type: 'openai-whisper',
    fields: [
      { key: 'audioUrl', label: 'Audio URL', control: 'text', hint: 'Or supply audioBase64' },
      { key: 'audioBase64', label: 'Audio (base64)', control: 'textarea', rows: 3 },
      { key: 'filename', label: 'Filename', control: 'text' },
      { key: 'language', label: 'Language (ISO code)', control: 'text', placeholder: 'en' },
      { key: 'prompt', label: 'Prompt (style guide)', control: 'textarea', rows: 2 },
      { key: 'responseFormat', label: 'Response format', control: 'select', options: [
        'json','text','srt','verbose_json','vtt',
      ].map(v => ({value:v,label:v}))},
    ],
  },
  {
    type: 'openai-embeddings',
    fields: [
      { key: 'input', label: 'Input (string or JSON array)', control: 'textarea', rows: 4, required: true },
      { key: 'model', label: 'Model', control: 'select', options: [
        { value: 'text-embedding-3-small', label: 'text-embedding-3-small' },
        { value: 'text-embedding-3-large', label: 'text-embedding-3-large' },
        { value: 'text-embedding-ada-002', label: 'text-embedding-ada-002 (legacy)' },
      ]},
      { key: 'dimensions', label: 'Dimensions', control: 'number', min: 1, hint: 'Optional truncate for 3-series' },
    ],
  },
  {
    type: 'groq-chat',
    fields: [
      { key: 'messages', label: 'Messages (JSON array)', control: 'json', rows: 6, required: true,
        hint: '[{"role":"system","content":"..."},{"role":"user","content":"..."}]' },
      { key: 'model', label: 'Model', control: 'select', options: MODEL_OPTIONS_GROQ },
      { key: 'temperature', label: 'Temperature', control: 'number', min: 0, max: 2, step: 0.1 },
      { key: 'maxTokens', label: 'Max tokens', control: 'number', min: 1 },
    ],
  },
  {
    type: 'perplexity-search',
    fields: [
      { key: 'query', label: 'Query', control: 'textarea', rows: 3, required: true },
      { key: 'model', label: 'Model', control: 'select', options: [
        { value: 'sonar', label: 'sonar' },
        { value: 'sonar-pro', label: 'sonar-pro' },
        { value: 'sonar-reasoning', label: 'sonar-reasoning' },
      ]},
      { key: 'recency', label: 'Recency filter', control: 'select', options: [
        { value: '', label: 'Any time' },
        { value: 'month', label: 'Past month' },
        { value: 'week', label: 'Past week' },
        { value: 'day', label: 'Past 24h' },
        { value: 'hour', label: 'Past hour' },
      ]},
      { key: 'domainFilter', label: 'Domain filter (JSON array)', control: 'json', rows: 2 },
    ],
  },
  {
    type: 'elevenlabs-tts',
    fields: [
      { key: 'text', label: 'Text', control: 'textarea', rows: 4, required: true },
      { key: 'voiceId', label: 'Voice ID', control: 'text', required: true,
        hint: 'Get via elevenlabs-list-voices, or use a stock voice like "21m00Tcm4TlvDq8ikWAM"' },
      { key: 'modelId', label: 'Model', control: 'select', options: [
        { value: 'eleven_turbo_v2_5', label: 'Turbo v2.5 (fast)' },
        { value: 'eleven_multilingual_v2', label: 'Multilingual v2' },
        { value: 'eleven_monolingual_v1', label: 'Monolingual v1' },
      ]},
      { key: 'stability', label: 'Stability', control: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'similarityBoost', label: 'Similarity boost', control: 'number', min: 0, max: 1, step: 0.05 },
    ],
  },

  // ─── Productivity ──────────────────────────────────────────────
  {
    type: 'sheets-append',
    fields: [
      { key: 'spreadsheetId', label: 'Spreadsheet ID', control: 'text', required: true },
      { key: 'range', label: 'Range (A1)', control: 'text', placeholder: 'Sheet1!A:Z', required: true },
      { key: 'values', label: 'Rows (JSON 2-D array)', control: 'json', rows: 5, required: true,
        hint: '[["Alice", 42], ["Bob", 10]]' },
      { key: 'valueInputOption', label: 'Value input option', control: 'select', options: [
        { value: 'USER_ENTERED', label: 'USER_ENTERED (parse formulas)' },
        { value: 'RAW', label: 'RAW' },
      ]},
    ],
  },
  {
    type: 'sheets-read',
    fields: [
      { key: 'spreadsheetId', label: 'Spreadsheet ID', control: 'text', required: true },
      { key: 'range', label: 'Range (A1)', control: 'text', placeholder: 'Sheet1!A1:D10', required: true },
      { key: 'valueRenderOption', label: 'Value render option', control: 'select', options: [
        { value: 'FORMATTED_VALUE', label: 'FORMATTED_VALUE' },
        { value: 'UNFORMATTED_VALUE', label: 'UNFORMATTED_VALUE' },
        { value: 'FORMULA', label: 'FORMULA' },
      ]},
    ],
  },
  {
    type: 'notion-create-page',
    fields: [
      { key: 'parentDatabaseId', label: 'Parent database ID', control: 'text',
        hint: 'Set this OR parentPageId' },
      { key: 'parentPageId', label: 'Parent page ID', control: 'text' },
      { key: 'title', label: 'Title', control: 'text' },
      { key: 'titleProperty', label: 'Title property name', control: 'text', placeholder: 'Name' },
      { key: 'properties', label: 'Properties (JSON)', control: 'json', rows: 6,
        hint: 'Notion property shape: { "Status": {"select": {"name": "Todo"}} }' },
      { key: 'children', label: 'Children blocks (JSON array)', control: 'json', rows: 5 },
    ],
  },
  {
    type: 'notion-query-database',
    fields: [
      { key: 'databaseId', label: 'Database ID', control: 'text', required: true },
      { key: 'filter', label: 'Filter (JSON)', control: 'json', rows: 5 },
      { key: 'sorts', label: 'Sorts (JSON array)', control: 'json', rows: 3 },
      { key: 'pageSize', label: 'Page size', control: 'number', min: 1, max: 100 },
    ],
  },
  {
    type: 'airtable-create',
    fields: [
      { key: 'baseId', label: 'Base ID', control: 'text', required: true, placeholder: 'appXXXX' },
      { key: 'tableId', label: 'Table name or ID', control: 'text', required: true },
      { key: 'records', label: 'Record(s) — JSON', control: 'json', rows: 6, required: true,
        hint: 'Single: {"Name":"Alice"} or array for bulk (≤ 10)' },
      { key: 'typecast', label: 'Typecast', control: 'toggle', hint: 'Auto-coerce field types' },
    ],
  },
  {
    type: 'airtable-list',
    fields: [
      { key: 'baseId', label: 'Base ID', control: 'text', required: true },
      { key: 'tableId', label: 'Table name or ID', control: 'text', required: true },
      { key: 'view', label: 'View', control: 'text' },
      { key: 'filterByFormula', label: 'Filter formula', control: 'text',
        placeholder: "{Status} = 'Active'" },
      { key: 'maxRecords', label: 'Max records', control: 'number', min: 1 },
    ],
  },
  {
    type: 'linear-create-issue',
    fields: [
      { key: 'teamId', label: 'Team ID', control: 'text', required: true },
      { key: 'title', label: 'Title', control: 'text', required: true },
      { key: 'description', label: 'Description', control: 'textarea', rows: 6 },
      { key: 'priority', label: 'Priority', control: 'select', options: [
        { value: '', label: 'None' },
        { value: '1', label: '1 — Urgent' },
        { value: '2', label: '2 — High' },
        { value: '3', label: '3 — Medium' },
        { value: '4', label: '4 — Low' },
      ]},
      { key: 'stateId', label: 'State ID', control: 'text' },
      { key: 'assigneeId', label: 'Assignee ID', control: 'text' },
      { key: 'projectId', label: 'Project ID', control: 'text' },
      { key: 'labels', label: 'Label IDs (JSON array)', control: 'json', rows: 2 },
    ],
  },
  {
    type: 'jira-create-issue',
    fields: [
      { key: 'baseUrl', label: 'Base URL', control: 'text', required: true, placeholder: 'https://acme.atlassian.net' },
      { key: 'projectKey', label: 'Project key', control: 'text', required: true, placeholder: 'ABC' },
      { key: 'issueType', label: 'Issue type', control: 'text', required: true, placeholder: 'Bug' },
      { key: 'summary', label: 'Summary', control: 'text', required: true },
      { key: 'description', label: 'Description', control: 'textarea', rows: 6 },
      { key: 'priority', label: 'Priority', control: 'text' },
      { key: 'labels', label: 'Labels (JSON array)', control: 'json', rows: 2 },
      { key: 'assigneeAccountId', label: 'Assignee account ID', control: 'text' },
    ],
  },
  {
    type: 'github-create-issue',
    fields: [
      { key: 'owner', label: 'Owner', control: 'text', required: true },
      { key: 'repo', label: 'Repo', control: 'text', required: true },
      { key: 'title', label: 'Title', control: 'text', required: true },
      { key: 'body', label: 'Body', control: 'textarea', rows: 8 },
      { key: 'labels', label: 'Labels (JSON array)', control: 'json', rows: 2 },
    ],
  },

  // ─── Commerce ────────────────────────────────────────────────────
  {
    type: 'stripe-create-customer',
    fields: [
      { key: 'email', label: 'Email', control: 'text', required: true },
      { key: 'name', label: 'Name', control: 'text' },
      { key: 'phone', label: 'Phone', control: 'text' },
      { key: 'description', label: 'Description', control: 'textarea', rows: 2 },
      { key: 'metadata', label: 'Metadata (JSON)', control: 'json', rows: 3 },
    ],
  },
  {
    type: 'stripe-create-payment-intent',
    fields: [
      { key: 'amount', label: 'Amount (smallest currency unit)', control: 'number', min: 50, required: true,
        hint: 'Stripe takes amounts in cents — 2000 = $20.00' },
      { key: 'currency', label: 'Currency (ISO)', control: 'text', required: true, placeholder: 'usd' },
      { key: 'customer', label: 'Customer ID', control: 'text' },
      { key: 'paymentMethod', label: 'Payment method ID', control: 'text' },
      { key: 'confirm', label: 'Confirm on create', control: 'toggle' },
      { key: 'description', label: 'Description', control: 'text' },
    ],
  },
  {
    type: 'shopify-create-product',
    fields: [
      { key: 'title', label: 'Title', control: 'text', required: true },
      { key: 'body_html', label: 'Description (HTML)', control: 'textarea', rows: 5 },
      { key: 'vendor', label: 'Vendor', control: 'text' },
      { key: 'product_type', label: 'Product type', control: 'text' },
      { key: 'tags', label: 'Tags (JSON array)', control: 'json', rows: 2 },
      { key: 'variants', label: 'Variants (JSON array)', control: 'json', rows: 5 },
    ],
  },

  // ─── Data & Storage ──────────────────────────────────────────────
  {
    type: 'pg-query',
    fields: [
      { key: 'query', label: 'SQL', control: 'code', rows: 6, required: true },
      { key: 'params', label: 'Parameters (JSON array)', control: 'json', rows: 2,
        hint: 'Positional — $1, $2, ...' },
      { key: 'connectionString', label: 'Connection string', control: 'password',
        hint: 'Overrides DATABASE_URL' },
    ],
  },
  {
    type: 'mongo-find',
    fields: [
      { key: 'database', label: 'Database', control: 'text', required: true },
      { key: 'collection', label: 'Collection', control: 'text', required: true },
      { key: 'filter', label: 'Filter (JSON)', control: 'json', rows: 4 },
      { key: 'projection', label: 'Projection (JSON)', control: 'json', rows: 2 },
      { key: 'sort', label: 'Sort (JSON)', control: 'json', rows: 2 },
      { key: 'limit', label: 'Limit', control: 'number', min: 1 },
      { key: 'skip', label: 'Skip', control: 'number', min: 0 },
    ],
  },
  {
    type: 'supabase-select',
    fields: [
      { key: 'table', label: 'Table', control: 'text', required: true },
      { key: 'select', label: 'Columns', control: 'text', placeholder: '*' },
      { key: 'filters', label: 'Filters (JSON)', control: 'json', rows: 3,
        hint: '{ column: "value" } for eq, or "gte.18" for operators' },
      { key: 'limit', label: 'Limit', control: 'number', min: 1 },
      { key: 'order', label: 'Order (PostgREST)', control: 'text', placeholder: 'created_at.desc' },
    ],
  },
  {
    type: 'pinecone-query',
    fields: [
      { key: 'indexHost', label: 'Index host', control: 'text', required: true,
        placeholder: 'my-index-abc123.svc.us-east-1.pinecone.io' },
      { key: 'vector', label: 'Query vector (JSON array)', control: 'json', rows: 3, required: true },
      { key: 'topK', label: 'Top K', control: 'number', min: 1, max: 1000 },
      { key: 'includeMetadata', label: 'Include metadata', control: 'toggle' },
      { key: 'includeValues', label: 'Include values', control: 'toggle' },
      { key: 'filter', label: 'Filter (JSON)', control: 'json', rows: 3 },
      { key: 'namespace', label: 'Namespace', control: 'text' },
    ],
  },
  {
    type: 's3-put',
    fields: [
      { key: 'bucket', label: 'Bucket', control: 'text', required: true },
      { key: 'key', label: 'Key', control: 'text', required: true },
      { key: 'body', label: 'Body', control: 'textarea', rows: 5 },
      { key: 'contentType', label: 'Content-Type', control: 'text', placeholder: 'application/json' },
    ],
  },
  {
    type: 's3-get',
    fields: [
      { key: 'bucket', label: 'Bucket', control: 'text', required: true },
      { key: 'key', label: 'Key', control: 'text', required: true },
    ],
  },

  // ─── Core (extras beyond the 8 that already have dedicated editors) ──
  {
    type: 'iterate',
    fields: [
      { key: 'innerNodeType', label: 'Inner node type', control: 'text', required: true,
        placeholder: 'transform / http / llm-prompt / ...' },
      { key: 'innerConfig', label: 'Inner config (JSON)', control: 'json', rows: 6, required: true },
      { key: 'inputsPath', label: 'Input array path', control: 'text',
        hint: 'Dot-path into inputs that yields the array to iterate' },
      { key: 'concurrency', label: 'Concurrency', control: 'number', min: 1, max: 100 },
    ],
  },
  {
    type: 'passthrough',
    fields: [
      { key: 'label', label: 'Label', control: 'text', hint: 'Cosmetic — shown on canvas' },
      { key: 'metadata', label: 'Metadata (JSON)', control: 'json', rows: 4 },
    ],
  },
  {
    type: 'fail',
    fields: [
      { key: 'message', label: 'Failure message', control: 'textarea', rows: 3, required: true },
    ],
  },
  {
    type: 'sub-workflow',
    fields: [
      { key: 'workflowId', label: 'Workflow ID', control: 'text', required: true },
      { key: 'inputs', label: 'Inputs passed into child (JSON)', control: 'json', rows: 5 },
    ],
  },
  {
    type: 'merge',
    fields: [
      { key: 'mode', label: 'Mode', control: 'select', required: true, options: [
        { value: 'append', label: 'append — concat all sources' },
        { value: 'combine', label: 'combine — pairwise zip' },
        { value: 'mergeByKey', label: 'mergeByKey — join on a field' },
        { value: 'multiplex', label: 'multiplex — cartesian product' },
        { value: 'chooseBranch', label: 'chooseBranch — first non-empty' },
      ]},
      { key: 'mergeByKey', label: 'Merge key', control: 'text',
        hint: 'Field name to join on (mergeByKey mode only)' },
    ],
  },
];

export const SCHEMA_MAP: Record<string, NodeSchema> = Object.fromEntries(
  SCHEMAS.map((s) => [s.type, s]),
);

export function getNodeSchema(type: string): NodeSchema | undefined {
  return SCHEMA_MAP[type];
}
