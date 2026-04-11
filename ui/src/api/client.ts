const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export interface WorkflowParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  description?: string;
  required?: boolean;
  default?: unknown;
  service?: string;
}

// Auth API
export interface AuthStatus {
  authenticated: boolean;
  userName?: string;
  userId?: string;
  service?: string;
}
export interface DeviceFlowStart {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  expiresIn: number;
  interval: number;
}
export interface ServiceInfo {
  service: string;
  oauthSupported: boolean;
  tokenDocsUrl?: string;
  tokenInstructions?: string;
}
export const getServiceInfo = (service: string) =>
  request<ServiceInfo>(`/auth/services/${service}`);
export const getAuthStatus = () =>
  request<{ services: Record<string, AuthStatus> }>('/auth/status');
export const getServiceAuthStatus = (service: string) =>
  request<AuthStatus>(`/auth/status/${service}`);
export const startAuthFlow = (service: string, scope?: string) =>
  request<DeviceFlowStart>(`/auth/login/${service}/start`, {
    method: 'POST',
    body: JSON.stringify({ scope }),
  });
export const pollAuthFlow = (service: string, deviceCode: string) =>
  request<{ status: 'pending' | 'completed'; authenticated?: boolean; userName?: string; slowDown?: boolean }>(
    `/auth/login/${service}/poll`,
    { method: 'POST', body: JSON.stringify({ deviceCode }) }
  );
export const saveServiceToken = (service: string, token: string, userName?: string) =>
  request<{ saved: boolean; service: string; userName?: string }>(`/auth/token/${service}`, {
    method: 'POST',
    body: JSON.stringify({ token, userName }),
  });
export const logoutService = (service: string) =>
  request<{ removed: boolean }>(`/auth/logout/${service}`, { method: 'DELETE' });

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  description?: string;
  params?: WorkflowParam[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  context?: Record<string, unknown>;
}

export interface WorkflowNode {
  id: string;
  type: string;
  name: string;
  description?: string;
  inputs: Array<{ from: string; to: string }>;
  outputs: string[];
  config: Record<string, unknown>;
  retry?: { maxAttempts: number; backoffMs: number; backoffMultiplier: number };
  branches?: Record<string, string[]>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: string;
}

export interface ExecutionState {
  executionId: string;
  workflowId: string;
  status: string;
  context: Record<string, unknown>;
  steps: Record<string, StepResult>;
  createdAt: string;
  updatedAt: string;
}

export interface StepResult {
  nodeId: string;
  status: string;
  outputs: Record<string, unknown>;
  error?: { message: string; attempt: number };
  startedAt: string;
  completedAt?: string;
  attempts: number;
  selectedBranch?: string;
}

// Workflows
export const listWorkflows = () => request<WorkflowDefinition[]>('/workflows');
export const getWorkflow = (id: string) => request<WorkflowDefinition>(`/workflows/${id}`);
export const saveWorkflow = (wf: WorkflowDefinition) =>
  request<WorkflowDefinition>(`/workflows/${wf.id}`, { method: 'PUT', body: JSON.stringify(wf) });
export const createWorkflow = (wf: WorkflowDefinition) =>
  request<WorkflowDefinition>('/workflows', { method: 'POST', body: JSON.stringify(wf) });
export const deleteWorkflow = (id: string) =>
  request<{ ok: boolean }>(`/workflows/${id}`, { method: 'DELETE' });

// Executions
export const executeWorkflow = (id: string, context?: Record<string, unknown>) =>
  request<ExecutionState>(`/workflows/${id}/execute`, { method: 'POST', body: JSON.stringify({ context }) });
export const listExecutions = (workflowId?: string) =>
  request<ExecutionState[]>(`/executions${workflowId ? `?workflowId=${workflowId}` : ''}`);
export const getExecution = (id: string) => request<ExecutionState>(`/executions/${id}`);
export const resumeExecution = (id: string) =>
  request<ExecutionState>(`/executions/${id}/resume`, { method: 'POST' });
export const pauseExecution = (id: string) =>
  request<{ ok: boolean }>(`/executions/${id}/pause`, { method: 'POST' });

// Plugins
export interface PluginInfo {
  name: string;
  version: string;
  source: string;
  nodeTypes: string[];
  tools: string[];
}

export interface NodeTypeInfo {
  type: string;
  isBuiltIn: boolean;
  source: string;
}

export interface CatalogEntry {
  name: string;
  description: string;
  category: string;
  isLoaded: boolean;
  requiresInstall: boolean;
  peerDep?: string;
  installHint?: string;
  nodeTypes: string[];
  tools: string[];
}

export const listPlugins = () => request<PluginInfo[]>('/plugins');
export const listPluginCatalog = () => request<CatalogEntry[]>('/plugins/catalog');
export const loadPlugin = (specifier: string) =>
  request<PluginInfo>('/plugins/load', { method: 'POST', body: JSON.stringify({ specifier }) });
export const listNodeTypes = () => request<NodeTypeInfo[]>('/node-types');

// Export
export async function exportWorkflow(workflowId: string, format: 'node' | 'docker'): Promise<Blob> {
  const res = await fetch('/api/export/workflow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId, format }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.blob();
}

// AI Generation & Validation
export const generateWorkflow = (prompt: string) =>
  request<WorkflowDefinition>('/generate/workflow', { method: 'POST', body: JSON.stringify({ prompt }) });
export interface EnrichedError {
  message: string;
  suggestion?: string;
  nodeId?: string;
  severity: 'error' | 'warning';
}
export const validateWorkflowApi = (workflow: WorkflowDefinition) =>
  request<{ valid: boolean; errors: string[]; enriched?: EnrichedError[] }>('/generate/validate', { method: 'POST', body: JSON.stringify(workflow) });
export const fixWorkflow = (workflow: WorkflowDefinition, errors: string[]) =>
  request<WorkflowDefinition>('/generate/fix', { method: 'POST', body: JSON.stringify({ workflow, errors }) });

// Templates
export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  nodeCount: number;
  edgeCount: number;
  nodeTypes: string[];
  category: string;
}

export const listTemplates = () => request<TemplateInfo[]>('/templates');
export const getTemplate = (id: string) => request<WorkflowDefinition>(`/templates/${id}`);

// SSE
export function subscribeToExecution(executionId: string, onEvent: (type: string, data: unknown) => void): () => void {
  const source = new EventSource(`${BASE}/executions/${executionId}/events`);
  const types = ['execution:start', 'execution:complete', 'execution:fail', 'node:start', 'node:complete', 'node:fail', 'node:skip', 'node:retry'];
  for (const type of types) {
    source.addEventListener(type, (e) => {
      onEvent(type, JSON.parse((e as MessageEvent).data));
    });
  }
  return () => source.close();
}
