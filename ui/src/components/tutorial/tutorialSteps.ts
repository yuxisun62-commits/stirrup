export interface TutorialStep {
  id: string;
  /** CSS selector for the target element. null = centered card (no spotlight) */
  target: string | null;
  title: string;
  description: string;
  placement: 'top' | 'bottom' | 'left' | 'right' | 'center';
  /** If true, skip gracefully when the target isn't in the DOM */
  optional?: boolean;
  /** Extra px around the spotlight cutout */
  spotlightPadding?: number;
  /**
   * Key for an inline visual illustration shown inside the tooltip when there's
   * no spotlight target. The TutorialWizard maps these keys to styled mockup
   * components so centered steps still have visual context.
   */
  visual?: 'welcome' | 'debug' | 'done';
  /**
   * If set, the tutorial asks App.tsx to open this panel when the step
   * becomes active. The tooltip renders above the modal (z-index 1100)
   * and the overlay is hidden (the modal has its own backdrop).
   */
  openPanel?: 'templates' | 'generate' | 'connections' | 'params' | 'export' | 'plugins';
}

/**
 * The tutorial should tell the canonical first-run story: what the app
 * is, how to build something (AI-generate or templates), how to run it,
 * how to get unstuck when something fails, and where the newer power-
 * user tools live (⌘K palette, zen mode, triggers, context). Updated
 * alongside the 0.7.x UI releases — if you add a feature that's not
 * obvious from the default layout, add a step here.
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    target: null,
    title: 'Welcome to Stirrup',
    description: 'Stirrup is a visual DAG workflow engine with AI-powered nodes. This tour covers the essentials in about a minute — you can skip any time or reopen it from the ? button.',
    placement: 'center',
    visual: 'welcome',
  },
  {
    id: 'sidebar',
    target: '[data-tutorial="sidebar"]',
    title: 'Workflows + Nodes',
    description: 'The sidebar holds your saved workflows (top) and the full node palette (bottom). Workflows show trigger pills, import source, and last-run status. 5+ workflows get a search bar automatically.',
    placement: 'right',
    spotlightPadding: 4,
  },
  {
    id: 'ai-generate',
    target: '[data-tutorial="ai-generate"]',
    title: 'AI Generate',
    description: 'Describe a workflow in plain English and Claude builds it — nodes, edges, params, the lot. "Review incoming GitHub PRs and post a summary to Slack" produces a runnable workflow in seconds.',
    placement: 'bottom',
    openPanel: 'generate',
  },
  {
    id: 'templates',
    target: '[data-tutorial="templates"]',
    title: 'Templates + Imports',
    description: 'Start from pre-built templates, or paste an n8n workflow or Make.com blueprint and Stirrup will import it — nodes, triggers, conditions, even {{ }} expressions and $json references. 37+ service plugins map automatically to native nodes.',
    placement: 'bottom',
    openPanel: 'templates',
  },
  {
    id: 'node-palette',
    target: '[data-tutorial="node-palette"]',
    title: 'Node Palette',
    description: '150+ node types across 9 categories (Core, AI, Communication, Productivity, CRM, Data, Commerce, Cloud, Utility). Search by name, service, or description. Drag any tile onto the canvas to add.',
    placement: 'right',
    spotlightPadding: 4,
  },
  {
    id: 'canvas',
    target: '[data-tutorial="canvas"]',
    title: 'Workflow Canvas',
    description: 'Drag nodes in, connect by pulling from one handle to another. Click an edge to set a branch condition. After a run, each node shows duration, iteration count, and branch taken as overlay badges. The ⇲ button in the bottom-right auto-arranges the graph.',
    placement: 'center',
    spotlightPadding: 0,
  },
  {
    id: 'node-inspector',
    target: '[data-tutorial="node-inspector"]',
    title: 'Node Inspector',
    description: 'Click a node to open this panel. Config is a real form (type-aware per node type — Slack channel, OpenAI model dropdown, etc.) not raw JSON. I/O maps inputs from upstream nodes. Results shows outputs after a run. Advanced sets retry policy.',
    placement: 'left',
    optional: true,
    spotlightPadding: 4,
  },
  {
    id: 'params-button',
    target: '[data-tutorial="params-button"]',
    title: 'Params + Context',
    description: 'Params declare the inputs users supply when running the workflow (with typed defaults + service bindings). Context declares shared default state every node can read via context.* mappings. Both open as modals from this button row.',
    placement: 'bottom',
    openPanel: 'params',
  },
  {
    id: 'connections',
    target: '[data-tutorial="connections-button"]',
    title: 'Connections',
    description: '40+ services: GitHub, Slack, OpenAI, Anthropic, Gmail, Notion, Airtable, Stripe, Pinecone, ElevenLabs, HubSpot, Shopify, and more. Search and category-group, one-click CLI connect where available, step-by-step setup guides for the rest. Credentials auto-inject into nodes that declare matching services.',
    placement: 'bottom',
    openPanel: 'connections',
  },
  {
    id: 'run-button',
    target: '[data-tutorial="run-button"]',
    title: 'Run Workflow',
    description: 'Run executes from every entry node in parallel. If the workflow declares params, you get a typed dialog. Watch nodes light up in real time — blue running, green completed, red failed. ⌘⏎ is the keyboard shortcut.',
    placement: 'top',
  },
  {
    id: 'execution-panel',
    target: '[data-tutorial="execution-panel"]',
    title: 'Execution Feedback',
    description: 'Progress bar, step-status pills, and a three-tab detail view: Status (clickable node pills), Timeline (gantt chart showing parallel vs. serial), and Events (raw SSE log). Every tab routes clicks back to the node inspector.',
    placement: 'top',
    spotlightPadding: 4,
  },
  {
    id: 'debug',
    target: null,
    title: 'Debug Failed Nodes',
    description: 'When a node fails, click it and hit Debug Node in the Results tab. The debugger shows the error, resolved inputs, and stack trace. "Analyze with AI" asks Claude to diagnose and suggest concrete field edits — apply them with one click without re-running the whole workflow.',
    placement: 'center',
    visual: 'debug',
  },
  {
    id: 'triggers',
    target: null,
    title: 'Triggers (run automatically)',
    description: 'Workflows can fire themselves on HTTP POST, inbound webhooks (with HMAC), cron schedules, or Telegram bot messages. Configure from the Triggers button in the header; the Live button next to it shows live fire counts and last-fired timestamps once the server is running.',
    placement: 'center',
  },
  {
    id: 'command-palette',
    target: null,
    title: '⌘K Command Palette',
    description: 'Press ⌘K (or Ctrl-K) anywhere to jump to any workflow, drop any node onto the canvas, or trigger actions like Run / Save / Templates / Connections. Arrow keys navigate, Enter selects.',
    placement: 'center',
  },
  {
    id: 'shortcuts',
    target: null,
    title: 'Keyboard shortcuts',
    description: '⌘S save · ⌘⏎ run · ⌘K palette · ⌘. toggle zen mode (hide sidebar + inspector for focused canvas work) · F fit view · Z zoom to selected · ⌘0 reset zoom. All gate on input-focus so typing in a textarea is safe.',
    placement: 'center',
  },
  {
    id: 'export',
    target: '[data-tutorial="export-button"]',
    title: 'Export & Deploy',
    description: 'Export as a standalone Node.js server or Docker container. Or deploy directly to Launchmatic — credentials become environment variables automatically. Triggers configured in the UI carry over to the deployed service.',
    placement: 'bottom',
    optional: true,
    openPanel: 'export',
  },
  {
    id: 'save',
    target: '[data-tutorial="save-button"]',
    title: 'Save',
    description: 'The UNSAVED badge appears when there are pending changes. Save persists to YAML on disk — version-control friendly. ⌘S is the shortcut and works even with focus in a textarea (we claim this one on purpose).',
    placement: 'bottom',
    optional: true,
  },
  {
    id: 'done',
    target: null,
    title: "You're ready",
    description: 'Try an AI-generated workflow or a template. If you hit a snag, the Debug Panel + AI auto-fix usually get you unstuck. Reopen this tour any time from the ? in the toolbar.',
    placement: 'center',
    visual: 'done',
  },
];
