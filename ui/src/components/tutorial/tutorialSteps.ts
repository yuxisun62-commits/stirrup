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
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    target: null,
    title: 'Welcome to Stirrup',
    description: 'Stirrup is a visual DAG workflow engine with AI-powered nodes. This tutorial will walk you through the key features. You can skip at any time or reopen it from the ? button in the toolbar.',
    placement: 'center',
    visual: 'welcome',
  },
  {
    id: 'sidebar',
    target: '[data-tutorial="sidebar"]',
    title: 'Sidebar',
    description: 'Your workflow library and tools live here. The sidebar shows your saved workflows and the node palette for building new ones.',
    placement: 'right',
    spotlightPadding: 4,
  },
  {
    id: 'ai-generate',
    target: '[data-tutorial="ai-generate"]',
    title: 'AI Generate',
    description: 'Describe what you want in plain English and Claude will generate a complete workflow for you — nodes, edges, params, and all.',
    placement: 'bottom',
  },
  {
    id: 'templates',
    target: '[data-tutorial="templates"]',
    title: 'Templates',
    description: 'Start from 20+ pre-built workflow templates: PR reviews, deployment pipelines, marketing broadcasts, LinkedIn posts, and more.',
    placement: 'bottom',
  },
  {
    id: 'node-palette',
    target: '[data-tutorial="node-palette"]',
    title: 'Node Palette',
    description: 'Drag any node type onto the canvas. There are 8 built-in types: Transform, Condition, HTTP, Script (deterministic) and LLM Prompt, Agent, Decision Routing, Code Gen (AI-powered).',
    placement: 'right',
    spotlightPadding: 4,
  },
  {
    id: 'canvas',
    target: '[data-tutorial="canvas"]',
    title: 'Workflow Canvas',
    description: 'This is your DAG editor. Drag nodes from the palette, connect them by dragging from one handle to another. Click an edge to set a condition for branching. Press Delete to remove selected nodes or edges.',
    placement: 'center',
    spotlightPadding: 0,
  },
  {
    id: 'node-inspector',
    target: '[data-tutorial="node-inspector"]',
    title: 'Node Inspector',
    description: 'Click any node on the canvas to open its inspector here. It has four tabs: Config (type-specific editors), I/O (input/output mappings), Results (execution outputs), and Advanced (retry policy, delete).',
    placement: 'left',
    optional: true,
    spotlightPadding: 4,
  },
  {
    id: 'params-button',
    target: '[data-tutorial="params-button"]',
    title: 'Workflow Parameters',
    description: 'Define the inputs users provide when running this workflow. Add params with types, defaults, descriptions, and service bindings (for auto-injecting credentials). These show up in the Run dialog.',
    placement: 'bottom',
  },
  {
    id: 'connections',
    target: '[data-tutorial="connections-button"]',
    title: 'Service Connections',
    description: 'Connect third-party services here: GitHub (OAuth), Launchmatic, Slack, Anthropic, LinkedIn, Stripe, and more. Saved credentials are auto-injected into workflows that need them.',
    placement: 'bottom',
  },
  {
    id: 'run-button',
    target: '[data-tutorial="run-button"]',
    title: 'Run Workflow',
    description: 'Click Run to execute your workflow. If it has parameters, a dialog will prompt you for values. Connected service credentials are injected automatically. You can watch nodes light up in real-time on the canvas.',
    placement: 'top',
  },
  {
    id: 'execution-panel',
    target: '[data-tutorial="execution-panel"]',
    title: 'Execution Feedback',
    description: 'During and after execution, this panel shows the progress bar, step-by-step status pills, and timing. Click any completed or failed node to see its outputs in the inspector.',
    placement: 'top',
    spotlightPadding: 4,
  },
  {
    id: 'debug',
    target: null,
    title: 'Debug Failed Nodes',
    description: 'When a node fails, click it to open the Debug Panel. You\'ll see the exact error, resolved inputs, and stack trace. Click "Analyze with AI" and Claude will diagnose the issue and suggest concrete field edits you can apply with one click.',
    placement: 'center',
    visual: 'debug',
  },
  {
    id: 'export',
    target: '[data-tutorial="export-button"]',
    title: 'Export & Deploy',
    description: 'Export your workflow as a standalone Node.js server or Docker container. Or deploy directly to Launchmatic as a persistent hosted service — your tokens are injected as environment variables.',
    placement: 'bottom',
  },
  {
    id: 'save',
    target: '[data-tutorial="save-button"]',
    title: 'Save',
    description: 'Save your workflow to disk. The yellow "UNSAVED" badge in the toolbar tells you when there are unsaved changes. Workflows are stored as YAML files you can version-control.',
    placement: 'bottom',
  },
  {
    id: 'done',
    target: null,
    title: 'You\'re ready!',
    description: 'That covers the essentials. Try loading a template, running it, and exploring the results. You can reopen this tutorial anytime from the ? button in the toolbar. Happy building!',
    placement: 'center',
    visual: 'done',
  },
];
