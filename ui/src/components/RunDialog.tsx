import { useState, useEffect } from 'react';
import { tokens, inputBase, monoInput } from './ui/styles';
import { getAuthStatus, startAuthFlow, pollAuthFlow, type AuthStatus } from '../api/client';

interface WorkflowParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  description?: string;
  required?: boolean;
  default?: unknown;
  service?: string;
}

interface Props {
  params: WorkflowParam[];
  workflowId: string;
  workflowName: string;
  onRun: (values: Record<string, unknown>) => void;
  onClose: () => void;
}

const SECRET_KEYWORDS = ['token', 'secret', 'password', 'key', 'credential'];
const isSecretParam = (name: string) => SECRET_KEYWORDS.some((k) => name.toLowerCase().includes(k));

function loadSavedValues(workflowId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(`stirrup:params:${workflowId}`);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveValues(workflowId: string, values: Record<string, string>) {
  try {
    const toSave: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (!isSecretParam(k)) toSave[k] = v;
    }
    localStorage.setItem(`stirrup:params:${workflowId}`, JSON.stringify(toSave));
  } catch { /* ignore */ }
}

export function RunDialog({ params, workflowId, workflowName, onRun, onClose }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const saved = loadSavedValues(workflowId);
    const initial: Record<string, string> = {};
    for (const p of params) {
      if (saved[p.name] !== undefined) {
        initial[p.name] = saved[p.name];
      } else if (p.default !== undefined) {
        initial[p.name] = typeof p.default === 'object' ? JSON.stringify(p.default) : String(p.default);
      } else {
        initial[p.name] = '';
      }
    }
    return initial;
  });

  const [authStatus, setAuthStatus] = useState<Record<string, AuthStatus>>({});
  const [authingService, setAuthingService] = useState<string | null>(null);
  const [authPrompt, setAuthPrompt] = useState<{ service: string; userCode: string; verificationUri: string } | null>(null);

  // Fetch auth status on mount
  useEffect(() => {
    getAuthStatus().then((res) => setAuthStatus(res.services)).catch(() => {});
  }, []);

  const startAuth = async (service: string) => {
    setAuthingService(service);
    try {
      const flow = await startAuthFlow(service);
      setAuthPrompt({ service, userCode: flow.userCode, verificationUri: flow.verificationUri });

      // Open browser
      window.open(flow.verificationUri, '_blank');

      // Poll until completed or expired
      const interval = (flow.interval ?? 5) * 1000;
      let pollDelay = interval;
      const maxAttempts = 180;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, pollDelay));
        try {
          const result = await pollAuthFlow(service, flow.deviceCode);
          if (result.status === 'completed') {
            setAuthStatus((s) => ({ ...s, [service]: { authenticated: true, userName: result.userName } }));
            setAuthPrompt(null);
            setAuthingService(null);
            return;
          }
          if (result.slowDown) pollDelay += 5000;
        } catch (err) {
          // Stop on hard errors
          throw err;
        }
      }
      throw new Error('Authentication timed out');
    } catch (err) {
      alert(`Auth failed: ${err instanceof Error ? err.message : String(err)}`);
      setAuthPrompt(null);
      setAuthingService(null);
    }
  };

  const handleRun = () => {
    saveValues(workflowId, values);
    const coerced: Record<string, unknown> = {};
    for (const p of params) {
      // If param has a service and we're authenticated, skip — engine will inject
      if (p.service && authStatus[p.service]?.authenticated && !values[p.name]) continue;
      const raw = values[p.name] ?? '';
      if (!raw && !p.required) continue;
      switch (p.type) {
        case 'number': coerced[p.name] = Number(raw); break;
        case 'boolean': coerced[p.name] = raw === 'true' || raw === '1'; break;
        case 'json':
          try { coerced[p.name] = JSON.parse(raw); } catch { coerced[p.name] = raw; }
          break;
        default: coerced[p.name] = raw;
      }
    }
    onRun(coerced);
  };

  // A required param is "missing" only if it has no value AND no auto-fill from OAuth
  const missingRequired = params
    .filter((p) => {
      if (!p.required) return false;
      if (values[p.name]?.trim()) return false;
      if (p.service && authStatus[p.service]?.authenticated) return false;
      return true;
    })
    .map((p) => p.name);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 520, maxHeight: '85vh', borderRadius: 12,
          backgroundColor: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${tokens.border.subtle}` }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: tokens.text.primary }}>Run Workflow</div>
          <div style={{ fontSize: 12, color: tokens.text.muted, marginTop: 2 }}>{workflowName}</div>
        </div>

        {/* Auth prompt overlay */}
        {authPrompt && (
          <div style={{
            padding: 16, borderBottom: `1px solid ${tokens.border.subtle}`,
            backgroundColor: `${tokens.nodeColors['llm-prompt']}10`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: tokens.text.primary, marginBottom: 6 }}>
              Authenticating with {authPrompt.service}
            </div>
            <div style={{ fontSize: 11, color: tokens.text.secondary, marginBottom: 8 }}>
              A browser tab opened. Enter this code to continue:
            </div>
            <div style={{
              fontSize: 22, fontWeight: 800, fontFamily: tokens.font.mono,
              color: tokens.nodeColors['llm-prompt'], letterSpacing: 4,
              textAlign: 'center', padding: 12, borderRadius: 6,
              backgroundColor: tokens.bg.input, border: `1px solid ${tokens.border.subtle}`,
              userSelect: 'all',
            }}>
              {authPrompt.userCode}
            </div>
            <div style={{ fontSize: 11, color: tokens.text.muted, marginTop: 6 }}>
              Waiting for authorization...
            </div>
          </div>
        )}

        {/* Params form */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
          {params.length === 0 && (
            <div style={{ color: tokens.text.muted, fontSize: 12, fontStyle: 'italic' }}>
              No parameters declared. The workflow will run with default context values.
            </div>
          )}
          {params.map((p) => {
            const isAuthed = p.service ? !!authStatus[p.service]?.authenticated : false;
            const userName = p.service ? authStatus[p.service]?.userName : undefined;

            return (
              <div key={p.name} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 12, fontWeight: 600, color: tokens.text.primary,
                    fontFamily: tokens.font.mono,
                  }}>
                    {p.name}
                  </span>
                  <span style={{ fontSize: 10, color: tokens.text.muted }}>({p.type})</span>
                  {p.required && <span style={{ fontSize: 9, color: '#ef4444', fontWeight: 700 }}>REQUIRED</span>}
                  {p.service && (
                    <span style={{
                      fontSize: 9, padding: '1px 6px', borderRadius: 3, fontWeight: 700,
                      backgroundColor: isAuthed ? `${tokens.status.completed}20` : `${tokens.border.default}`,
                      color: isAuthed ? tokens.status.completed : tokens.text.muted,
                      textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}>
                      {isAuthed ? `OAUTH ✓ ${userName ?? p.service}` : `${p.service.toUpperCase()} OAUTH`}
                    </span>
                  )}
                </div>
                {p.description && (
                  <div style={{ fontSize: 11, color: tokens.text.muted, marginBottom: 4 }}>{p.description}</div>
                )}

                {/* Service-backed params: show OAuth status instead of input */}
                {p.service && isAuthed ? (
                  <div style={{
                    padding: '7px 10px', fontSize: 11, borderRadius: 6,
                    backgroundColor: `${tokens.status.completed}08`,
                    border: `1px solid ${tokens.status.completed}30`,
                    color: tokens.status.completed,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <span>✓ Will use {p.service} OAuth token{userName ? ` (as ${userName})` : ''}</span>
                  </div>
                ) : p.service ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      style={{ ...inputBase, flex: 1 }}
                      type="password"
                      value={values[p.name] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                      placeholder="Paste a token, or click Connect →"
                    />
                    <button
                      onClick={() => startAuth(p.service!)}
                      disabled={authingService === p.service}
                      style={{
                        padding: '6px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none',
                        background: `linear-gradient(135deg, ${tokens.nodeColors['llm-prompt']}, ${tokens.nodeColors['decision-routing']})`,
                        color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap',
                      }}
                    >
                      {authingService === p.service ? '...' : `Connect ${p.service}`}
                    </button>
                  </div>
                ) : p.type === 'boolean' ? (
                  <select
                    style={{ ...inputBase, width: 120 }}
                    value={values[p.name] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                  >
                    <option value="">— select —</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : p.type === 'json' ? (
                  <textarea
                    style={{ ...monoInput, height: 60, resize: 'vertical' }}
                    value={values[p.name] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                    placeholder={`{"key": "value"}`}
                  />
                ) : (
                  <input
                    style={p.type === 'number' ? { ...inputBase, width: 160 } : inputBase}
                    type={p.type === 'number' ? 'number' : 'text'}
                    value={values[p.name] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                    placeholder={p.default !== undefined ? String(p.default) : undefined}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: `1px solid ${tokens.border.subtle}`,
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
        }}>
          {missingRequired.length > 0 && (
            <span style={{ fontSize: 10, color: '#ef4444', marginRight: 'auto' }}>
              Missing: {missingRequired.join(', ')}
            </span>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '7px 16px', fontSize: 12, borderRadius: 6,
              border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
              color: tokens.text.secondary, cursor: 'pointer', fontWeight: 500,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleRun}
            disabled={missingRequired.length > 0}
            style={{
              padding: '7px 20px', fontSize: 12, fontWeight: 600, borderRadius: 6,
              border: 'none',
              backgroundColor: missingRequired.length === 0 ? tokens.status.completed : tokens.border.default,
              color: '#fff', cursor: missingRequired.length === 0 ? 'pointer' : 'default',
            }}
          >
            Run
          </button>
        </div>
      </div>
    </div>
  );
}
