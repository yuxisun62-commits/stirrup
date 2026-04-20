/**
 * Client-side augmentation for the /auth/services endpoint.
 *
 * The server knows _which_ services have auth docs, OAuth support, CLI
 * integrations, etc.; the client adds display-layer metadata — human
 * label, description, category, optional step-by-step setup guide.
 *
 * When the server reports a service that isn't in this catalog, the
 * AuthPanel still renders it (with a sensible default label) so new
 * services are visible immediately. The catalog is additive polish.
 */

import type { NodeCategory } from './nodeMetadata';

export interface ServiceCatalogEntry {
  service: string;
  label: string;
  description: string;
  category: NodeCategory;
  setupGuide?: Array<{ text: string; url?: string }>;
}

export const SERVICE_CATALOG: Record<string, ServiceCatalogEntry> = {
  // AI providers
  anthropic:   { service: 'anthropic',   label: 'Anthropic',   category: 'AI', description: 'Claude API — powers every AI node when set' },
  openai:      { service: 'openai',      label: 'OpenAI',      category: 'AI', description: 'ChatGPT + DALL-E + Whisper + embeddings' },
  gemini:      { service: 'gemini',      label: 'Google Gemini', category: 'AI', description: 'Gemini models for llm-prompt and friends' },
  groq:        { service: 'groq',        label: 'Groq',        category: 'AI', description: 'Ultra-fast Llama/Mixtral inference' },
  perplexity:  { service: 'perplexity',  label: 'Perplexity',  category: 'AI', description: 'LLM with live web search and citations' },
  mistral:     { service: 'mistral',     label: 'Mistral',     category: 'AI', description: 'Mistral Large / Small / Codestral' },
  huggingface: { service: 'huggingface', label: 'Hugging Face', category: 'AI', description: 'Any open-source model via Inference API' },
  elevenlabs:  { service: 'elevenlabs',  label: 'ElevenLabs',  category: 'AI', description: 'Best-in-class TTS and voice cloning' },
  replicate:   { service: 'replicate',   label: 'Replicate',   category: 'AI', description: 'Run any hosted model (Flux, SDXL, Llama)' },

  // Communication
  slack: {
    service: 'slack', label: 'Slack', category: 'Communication',
    description: 'Send messages, blocks, upload files, list channels',
    setupGuide: [
      { text: 'Go to api.slack.com/apps and click "Create New App" → "From Scratch"', url: 'https://api.slack.com/apps?new_app=1' },
      { text: 'Name it "Stirrup" (or anything), pick your workspace, click Create' },
      { text: 'In the left sidebar click "OAuth & Permissions"' },
      { text: 'Scroll to "Bot Token Scopes" and add: chat:write, channels:read, files:write' },
      { text: 'Scroll up and click "Install to Workspace" → Authorize' },
      { text: 'Copy the "Bot User OAuth Token" (starts with xoxb-) and paste it above' },
    ],
  },
  discord:     { service: 'discord',     label: 'Discord',     category: 'Communication', description: 'Bot messages, reactions, history' },
  telegram:    { service: 'telegram',    label: 'Telegram',    category: 'Communication', description: 'Bot send + long-poll trigger' },
  gmail:       { service: 'gmail',       label: 'Gmail',       category: 'Communication', description: 'Send + search via Google API' },
  sendgrid:    { service: 'sendgrid',    label: 'SendGrid',    category: 'Communication', description: 'Transactional email + marketing' },
  resend:      { service: 'resend',      label: 'Resend',      category: 'Communication', description: 'Dev-first transactional email' },
  twilio:      { service: 'twilio',      label: 'Twilio',      category: 'Communication', description: 'SMS, WhatsApp, voice, Verify' },
  email:       { service: 'email',       label: 'SMTP Email',  category: 'Communication', description: 'Generic SMTP via nodemailer' },
  linkedin:    { service: 'linkedin',    label: 'LinkedIn',    category: 'Communication', description: 'Post to personal or org feed' },
  typefully:   { service: 'typefully',   label: 'Typefully',   category: 'Communication', description: 'Schedule X threads + LinkedIn posts' },
  buffer:      { service: 'buffer',      label: 'Buffer',      category: 'Communication', description: 'Cross-platform scheduling' },

  // Productivity
  'google-sheets':   { service: 'google-sheets',   label: 'Google Sheets',   category: 'Productivity', description: 'Read/append/update spreadsheet ranges' },
  'google-drive':    { service: 'google-drive',    label: 'Google Drive',    category: 'Productivity', description: 'List, upload, download, share files' },
  'google-calendar': { service: 'google-calendar', label: 'Google Calendar', category: 'Productivity', description: 'Events: list, create, update, delete' },
  google:            { service: 'google',          label: 'Google (generic)', category: 'Productivity', description: 'Shared Google OAuth token for Sheets/Drive/Calendar/Gmail' },
  notion:            { service: 'notion',          label: 'Notion',          category: 'Productivity', description: 'Pages, database queries, blocks, search' },
  airtable:          { service: 'airtable',        label: 'Airtable',        category: 'Productivity', description: 'List/create/update/upsert records' },
  linear:            { service: 'linear',          label: 'Linear',          category: 'Productivity', description: 'Issue CRUD + search via GraphQL' },
  jira:              { service: 'jira',            label: 'Jira',            category: 'Productivity', description: 'Cloud issues, JQL search, transitions' },
  trello:            { service: 'trello',          label: 'Trello',          category: 'Productivity', description: 'Cards, lists, comments' },
  calendly:          { service: 'calendly',        label: 'Calendly',        category: 'Productivity', description: 'Events + single-use booking links' },
  github:            { service: 'github',          label: 'GitHub',          category: 'Productivity', description: 'PRs, issues, comments, code search' },

  // CRM & Support
  hubspot:   { service: 'hubspot',   label: 'HubSpot',   category: 'CRM & Support', description: 'Contacts, deals, engagements' },
  zendesk:   { service: 'zendesk',   label: 'Zendesk',   category: 'CRM & Support', description: 'Support tickets + user lookups' },
  mailchimp: { service: 'mailchimp', label: 'Mailchimp', category: 'CRM & Support', description: 'Audience members + campaigns' },

  // Data & Storage
  postgres: { service: 'postgres', label: 'PostgreSQL',  category: 'Data & Storage', description: 'Raw SQL queries, bulk insert, transactions' },
  redis:    { service: 'redis',    label: 'Redis',       category: 'Data & Storage', description: 'Key/value, pub/sub, lists' },
  mongodb:  { service: 'mongodb',  label: 'MongoDB',     category: 'Data & Storage', description: 'Find, insert, update, aggregate' },
  supabase: { service: 'supabase', label: 'Supabase',    category: 'Data & Storage', description: 'PostgREST + GoTrue auth' },
  pinecone: { service: 'pinecone', label: 'Pinecone',    category: 'Data & Storage', description: 'Vector upsert, query, fetch' },
  aws:      { service: 'aws',      label: 'AWS',         category: 'Data & Storage', description: 'S3 and other AWS services' },

  // Commerce
  stripe:  { service: 'stripe',  label: 'Stripe',  category: 'Commerce', description: 'Customers, charges, invoices, subscriptions' },
  shopify: { service: 'shopify', label: 'Shopify', category: 'Commerce', description: 'Products, orders, customers' },

  // Cloud & DevOps
  launchmatic: { service: 'launchmatic', label: 'Launchmatic', category: 'Cloud & DevOps', description: 'Deploy services, DBs, domains, browser tests' },
  gcloud:      { service: 'gcloud',      label: 'Google Cloud', category: 'Cloud & DevOps', description: 'GCS, BigQuery, Cloud Run, Pub/Sub' },
};

/**
 * Derive a default catalog entry for services the server reports that
 * aren't in the client-side augmentation. Keeps the UI usable even when
 * new services ship ahead of a UI release.
 */
export function getServiceCatalogEntry(service: string): ServiceCatalogEntry {
  const hit = SERVICE_CATALOG[service];
  if (hit) return hit;
  const label = service
    .split('-')
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join(' ');
  return {
    service,
    label: label || service,
    description: `Connect ${label} to use its plugin nodes`,
    category: 'Utility',
  };
}
