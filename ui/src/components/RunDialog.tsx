import { useState, useEffect, useMemo } from 'react';
import { tokens, inputBase, monoInput } from './ui/styles';
import { CheckIcon } from './ui/icons';
import {
  getAuthStatus, startAuthFlow, pollAuthFlow, getServiceInfo, saveServiceToken,
  listGithubRepos,
  type AuthStatus, type ServiceInfo, type GithubRepoSummary,
} from '../api/client';

interface WorkflowParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  description?: string;
  required?: boolean;
  default?: unknown;
  service?: string;
  picker?: 'github-repo';
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
  const [serviceInfo, setServiceInfo] = useState<Record<string, ServiceInfo>>({});
  const [pasteTokenFor, setPasteTokenFor] = useState<string | null>(null);
  const [pasteTokenValue, setPasteTokenValue] = useState('');

  // Fetch auth status on mount
  useEffect(() => {
    getAuthStatus().then((res) => setAuthStatus(res.services)).catch(() => {});
    // Fetch service info for each service-backed param
    const services = [...new Set(params.filter((p) => p.service).map((p) => p.service!))];
    Promise.all(services.map((s) => getServiceInfo(s).catch(() => null))).then((infos) => {
      const map: Record<string, ServiceInfo> = {};
      infos.forEach((info, i) => { if (info) map[services[i]] = info; });
      setServiceInfo(map);
    });
  }, []);

  const handleSaveToken = async (service: string) => {
    if (!pasteTokenValue.trim()) return;
    try {
      const result = await saveServiceToken(service, pasteTokenValue.trim());
      setAuthStatus((s) => ({ ...s, [service]: { authenticated: true, userName: result.userName } }));
      if (result.warning) {
        // Saved but wrong format — alert so user can fix before running
        alert(`Warning: ${result.warning}`);
      }
      setPasteTokenFor(null);
      setPasteTokenValue('');
    } catch (err) {
      alert(`Failed to save token: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const [codeCopied, setCodeCopied] = useState(false);

  const startAuth = async (service: string) => {
    setAuthingService(service);
    setCodeCopied(false);
    try {
      const flow = await startAuthFlow(service);
      // IMPORTANT: do NOT auto-open the verification URL here. This runs
      // after an async await, so the browser considers the click gesture
      // stale and popup blockers kick in (Safari always, Chrome sometimes).
      // The prompt below shows a "Copy code & open GitHub" button the user
      // clicks themselves — that's a fresh user gesture, so popups always
      // open and clipboard writes always succeed.
      setAuthPrompt({ service, userCode: flow.userCode, verificationUri: flow.verificationUri });

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

  /** Copy code + open verification URL inside the user gesture so popup
      blockers don't fire. See comment in startAuth above. */
  const copyCodeAndOpen = async () => {
    if (!authPrompt) return;
    try {
      await navigator.clipboard.writeText(authPrompt.userCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // Clipboard failures in insecure contexts are non-fatal
    }
    window.open(authPrompt.verificationUri, '_blank', 'noopener,noreferrer');
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
            <div style={{ fontSize: 12, fontWeight: 700, color: tokens.text.primary, marginBottom: 4 }}>
              Authenticating with {authPrompt.service}
            </div>
            <div style={{ fontSize: 11, color: tokens.text.secondary, marginBottom: 10 }}>
              Click <b>Open GitHub</b>, then paste this code on the page that opens:
            </div>
            <div style={{
              fontSize: 24, fontWeight: 800, fontFamily: tokens.font.mono,
              color: tokens.nodeColors['llm-prompt'], letterSpacing: 4,
              textAlign: 'center', padding: 14, borderRadius: 6,
              backgroundColor: tokens.bg.input, border: `1px solid ${tokens.border.subtle}`,
              userSelect: 'all',
              marginBottom: 10,
            }}>
              {authPrompt.userCode}
            </div>
            <button
              onClick={copyCodeAndOpen}
              style={{
                width: '100%', padding: '9px 14px', fontSize: 12, fontWeight: 700, borderRadius: 6,
                border: 'none',
                background: `linear-gradient(135deg, ${tokens.nodeColors['llm-prompt']}, ${tokens.nodeColors['decision-routing']})`,
                color: '#fff', cursor: 'pointer',
              }}
            >
              {codeCopied ? 'Code copied — opening GitHub…' : 'Copy code & open GitHub'}
            </button>
            <div style={{
              fontSize: 10, color: tokens.text.muted, marginTop: 8,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                backgroundColor: tokens.status.running,
                animation: 'pulse 1.5s ease-in-out infinite',
                display: 'inline-block',
              }} />
              Waiting for you to authorize on GitHub…
            </div>
            <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
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
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                    }}>
                      {isAuthed && <CheckIcon size={10} />}
                      {isAuthed
                        ? `${p.service.toUpperCase()}${userName ? ` ${userName}` : ' SAVED'}`
                        : p.service.toUpperCase()}
                    </span>
                  )}
                </div>
                {p.description && (
                  <div style={{ fontSize: 11, color: tokens.text.muted, marginBottom: 4 }}>{p.description}</div>
                )}

                {/* Service-backed params: show stored credential status */}
                {p.service && isAuthed ? (
                  <div style={{
                    padding: '7px 10px', fontSize: 11, borderRadius: 6,
                    backgroundColor: `${tokens.status.completed}08`,
                    border: `1px solid ${tokens.status.completed}30`,
                    color: tokens.status.completed,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <CheckIcon />
                      Using saved {p.service} credential{userName ? ` (${userName})` : ''}
                    </span>
                    <button
                      onClick={() => { setPasteTokenFor(p.service!); setPasteTokenValue(''); }}
                      style={{
                        fontSize: 10, padding: '2px 8px', borderRadius: 3,
                        background: 'none', border: `1px solid ${tokens.status.completed}30`,
                        color: tokens.status.completed, cursor: 'pointer',
                      }}
                    >Replace</button>
                  </div>
                ) : p.service ? (
                  (() => {
                    const info = serviceInfo[p.service];
                    const supportsOAuth = info?.oauthSupported ?? false;
                    const isPasting = pasteTokenFor === p.service;

                    // Token paste form
                    if (isPasting) {
                      return (
                        <div style={{
                          padding: 10, borderRadius: 6,
                          backgroundColor: `${tokens.nodeColors['llm-prompt']}08`,
                          border: `1px solid ${tokens.nodeColors['llm-prompt']}30`,
                        }}>
                          {info?.tokenInstructions && (
                            <div style={{ fontSize: 11, color: tokens.text.secondary, marginBottom: 6, lineHeight: 1.4 }}>
                              {info.tokenInstructions}
                              {info.tokenDocsUrl && (
                                <> <a href={info.tokenDocsUrl} target="_blank" rel="noopener" style={{ color: tokens.text.accent, textDecoration: 'underline' }}>Open docs →</a></>
                              )}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input
                              style={{ ...inputBase, flex: 1, fontFamily: tokens.font.mono }}
                              type="password"
                              autoFocus
                              value={pasteTokenValue}
                              onChange={(e) => setPasteTokenValue(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleSaveToken(p.service!)}
                              placeholder={`Paste your ${p.service} token...`}
                            />
                            <button
                              onClick={() => handleSaveToken(p.service!)}
                              disabled={!pasteTokenValue.trim()}
                              style={{
                                padding: '6px 14px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none',
                                backgroundColor: pasteTokenValue.trim() ? tokens.status.completed : tokens.border.default,
                                color: '#fff', cursor: pasteTokenValue.trim() ? 'pointer' : 'default',
                              }}
                            >Save</button>
                            <button
                              onClick={() => { setPasteTokenFor(null); setPasteTokenValue(''); }}
                              style={{
                                padding: '6px 10px', fontSize: 11, borderRadius: 6,
                                border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
                                color: tokens.text.muted, cursor: 'pointer',
                              }}
                            >Cancel</button>
                          </div>
                          <div style={{ fontSize: 10, color: tokens.text.muted, marginTop: 6 }}>
                            Token will be saved to ~/.stirrup/tokens.json (0600 permissions) and reused automatically.
                          </div>
                        </div>
                      );
                    }

                    // OAuth or paste-to-save buttons
                    return (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          style={{ ...inputBase, flex: 1 }}
                          type="password"
                          value={values[p.name] ?? ''}
                          onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                          placeholder={supportsOAuth ? 'Paste a token, or click Connect →' : 'Paste a one-time token, or save it for reuse →'}
                        />
                        {supportsOAuth ? (
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
                        ) : (
                          <button
                            onClick={() => { setPasteTokenFor(p.service!); setPasteTokenValue(values[p.name] ?? ''); }}
                            style={{
                              padding: '6px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none',
                              background: `linear-gradient(135deg, #06b6d4, #3b82f6)`,
                              color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap',
                            }}
                          >
                            Save & Reuse
                          </button>
                        )}
                      </div>
                    );
                  })()
                ) : p.picker === 'github-repo' ? (
                  <GithubRepoPicker
                    value={values[p.name] ?? ''}
                    onChange={(v) => setValues((vals) => ({ ...vals, [p.name]: v }))}
                    githubAuthed={!!authStatus.github?.authenticated}
                    onConnectGithub={() => startAuth('github')}
                  />
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

/**
 * Searchable picker for GitHub repos. Loads the user's accessible repos via
 * the stored OAuth token, lets them filter by typing, and emits the selected
 * `owner/name` back to the parent. Also supports manual typing as a fallback
 * (useful for repos that aren't in the first 100 results, or for typing a
 * repo you don't have access to but the workflow does via a different token).
 *
 * Three states:
 *   1. Not authenticated → prompt to connect GitHub
 *   2. Loading           → spinner
 *   3. Loaded            → search input + filtered list
 */
function GithubRepoPicker({
  value,
  onChange,
  githubAuthed,
  onConnectGithub,
}: {
  value: string;
  onChange: (v: string) => void;
  githubAuthed: boolean;
  onConnectGithub: () => void;
}) {
  const [repos, setRepos] = useState<GithubRepoSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Load repos as soon as we have GitHub auth
  useEffect(() => {
    if (!githubAuthed || repos !== null) return;
    setLoading(true);
    setError(null);
    listGithubRepos()
      .then((res) => setRepos(res.repos))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [githubAuthed, repos]);

  const filtered = useMemo(() => {
    if (!repos) return [];
    const q = value.trim().toLowerCase();
    if (!q) return repos.slice(0, 8);
    return repos
      .filter((r) =>
        r.fullName.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 8);
  }, [repos, value]);

  // Not authenticated → show connect prompt
  if (!githubAuthed) {
    return (
      <div style={{
        padding: 10, borderRadius: 6,
        backgroundColor: `${tokens.nodeColors['llm-prompt']}08`,
        border: `1px solid ${tokens.nodeColors['llm-prompt']}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}>
        <span style={{ fontSize: 11, color: tokens.text.secondary }}>
          Connect GitHub to browse your repos.
        </span>
        <button
          onClick={onConnectGithub}
          style={{
            padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5, border: 'none',
            background: `linear-gradient(135deg, ${tokens.nodeColors['llm-prompt']}, ${tokens.nodeColors['decision-routing']})`,
            color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          Connect GitHub
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        style={{ ...inputBase, fontFamily: tokens.font.mono }}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={loading ? 'Loading repos...' : 'owner/name — start typing to filter'}
      />
      {loading && (
        <div style={{
          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
          width: 12, height: 12, borderRadius: '50%',
          border: '2px solid ' + tokens.text.muted, borderTopColor: 'transparent',
          animation: 'spin 0.8s linear infinite',
        }} />
      )}
      {error && (
        <div style={{ fontSize: 10, color: tokens.status.failed, marginTop: 3 }}>
          {error} — falling back to manual entry
        </div>
      )}
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2, zIndex: 10,
          maxHeight: 280, overflow: 'auto',
          backgroundColor: tokens.bg.surface,
          border: `1px solid ${tokens.border.default}`,
          borderRadius: 6,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          {filtered.map((repo) => (
            <div
              key={repo.fullName}
              onMouseDown={(e) => {
                // mouseDown (not click) so it fires before the input's blur closes the dropdown
                e.preventDefault();
                onChange(repo.fullName);
                setOpen(false);
              }}
              style={{
                padding: '7px 10px', cursor: 'pointer',
                borderBottom: `1px solid ${tokens.border.subtle}`,
                display: 'flex', flexDirection: 'column', gap: 2,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = tokens.bg.hover; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  fontSize: 12, fontFamily: tokens.font.mono, color: tokens.text.primary, fontWeight: 600,
                }}>
                  {repo.fullName}
                </span>
                {repo.private && (
                  <span style={{
                    fontSize: 8, padding: '1px 5px', borderRadius: 3, fontWeight: 700,
                    backgroundColor: `${tokens.text.muted}25`, color: tokens.text.muted,
                    textTransform: 'uppercase', letterSpacing: '0.5px',
                  }}>
                    PRIVATE
                  </span>
                )}
              </div>
              {repo.description && (
                <div style={{
                  fontSize: 10, color: tokens.text.muted, lineHeight: 1.3,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {repo.description}
                </div>
              )}
            </div>
          ))}
          {repos && repos.length > 100 && (
            <div style={{ padding: '6px 10px', fontSize: 10, color: tokens.text.muted, fontStyle: 'italic' }}>
              Showing first 100 repos by recent activity. Type to filter.
            </div>
          )}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
