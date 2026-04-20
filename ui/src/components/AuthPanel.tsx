import { useEffect, useMemo, useState } from 'react';
import {
  getAuthStatus, startAuthFlow, pollAuthFlow, saveServiceToken, logoutService,
  detectCli, connectViaCli, cliLogin, listServices,
  type AuthStatus, type CliDetection,
} from '../api/client';
import { getServiceCatalogEntry, SERVICE_CATALOG } from './serviceCatalog';
import type { NodeCategory } from './nodeMetadata';
import { ALL_CATEGORIES } from './nodeMetadata';

/** Services whose CLI ships an interactive `<cli> login` command we can spawn */
const CLI_LOGIN_CAPABLE = new Set(['launchmatic', 'github']);
import { tokens, inputBase } from './ui/styles';
import { CheckIcon } from './ui/icons';

interface Props {
  onClose: () => void;
}

interface SetupStep {
  text: string;
  url?: string;
}

interface ServiceCard {
  service: string;
  label: string;
  description: string;
  category: NodeCategory;
  oauthSupported: boolean;
  tokenDocsUrl?: string;
  tokenInstructions?: string;
  /** Step-by-step setup guide shown as a collapsible section in the paste form */
  setupGuide?: SetupStep[];
}

/**
 * Build a fallback list from the client-side catalog — rendered while the
 * server's /auth/services response is in flight, and as a complete stand-
 * in if that request fails. Since the catalog has every service the app
 * knows about, users still see the full list in offline / bootstrap-error
 * cases; what they lose is `oauthSupported` accuracy and server-provided
 * token instructions.
 */
const FALLBACK_SERVICES: ServiceCard[] = Object.values(SERVICE_CATALOG).map((entry) => ({
  service: entry.service,
  label: entry.label,
  description: entry.description,
  category: entry.category,
  oauthSupported: entry.service === 'github',
  setupGuide: entry.setupGuide,
}));

export function AuthPanel({ onClose }: Props) {
  const [authStatus, setAuthStatus] = useState<Record<string, AuthStatus>>({});
  const [storeLocation, setStoreLocation] = useState<string>('');
  const [cliDetection, setCliDetection] = useState<Record<string, CliDetection>>({});
  const [authingService, setAuthingService] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceCard[]>(FALLBACK_SERVICES);
  const [query, setQuery] = useState('');
  const [openCats, setOpenCats] = useState<Set<NodeCategory>>(() => new Set(ALL_CATEGORIES));
  const [authPrompt, setAuthPrompt] = useState<{
    service: string;
    userCode: string;
    verificationUri: string;
  } | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [pasteFor, setPasteFor] = useState<string | null>(null);
  const [pasteValue, setPasteValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tokenWarning, setTokenWarning] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const refresh = () => {
    getAuthStatus().then((res) => {
      setAuthStatus(res.services);
      if (res.storeLocation) setStoreLocation(res.storeLocation);
    }).catch(() => {});
    // Detect CLI sessions for every service the server reports having CLI support.
    Promise.all(
      services.map((svc) =>
        detectCli(svc.service).then((d) => [svc.service, d] as const).catch(() => null)
      )
    ).then((results) => {
      const map: Record<string, CliDetection> = {};
      for (const r of results) {
        if (r) map[r[0]] = r[1];
      }
      setCliDetection(map);
    });
  };

  // Fetch the server's service list on mount and merge with the client
  // catalog (for labels/descriptions/categories/setup guides). Server data
  // wins for auth capability fields (oauthSupported, tokenDocsUrl, etc).
  useEffect(() => {
    listServices()
      .then(({ services: remote }) => {
        const merged: ServiceCard[] = remote.map((s) => {
          const cat = getServiceCatalogEntry(s.service);
          return {
            service: s.service,
            label: cat.label,
            description: cat.description,
            category: cat.category,
            oauthSupported: s.oauthSupported,
            tokenDocsUrl: s.tokenDocsUrl,
            tokenInstructions: s.tokenInstructions,
            setupGuide: cat.setupGuide,
          };
        });
        // Sort alphabetically within categories so the list is stable across
        // refreshes regardless of server iteration order.
        merged.sort((a, b) => a.label.localeCompare(b.label));
        setServices(merged);
      })
      .catch(() => {
        // Fall through to FALLBACK_SERVICES already in state.
      });
  }, []);

  // Refresh auth status + CLI detection whenever the service list changes.
  useEffect(refresh, [services]);

  // Filter + group for render. Empty query shows everything, otherwise
  // match across label, description, and service id — covers both "slack"
  // and "send messages" style searches.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return services;
    return services.filter((s) =>
      s.label.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.service.toLowerCase().includes(q),
    );
  }, [services, query]);

  const grouped = useMemo(() => {
    const map = new Map<NodeCategory, ServiceCard[]>();
    for (const svc of filtered) {
      const list = map.get(svc.category) ?? [];
      list.push(svc);
      map.set(svc.category, list);
    }
    return map;
  }, [filtered]);

  const isSearching = query.trim().length > 0;

  const handleCliConnect = async (service: string) => {
    setAuthingService(service);
    setError(null);
    try {
      await connectViaCli(service);
      refresh();
    } catch (err) {
      setError(`CLI connect failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAuthingService(null);
    }
  };

  const handleCliLogin = async (service: string) => {
    setAuthingService(service);
    setError(null);
    try {
      await cliLogin(service);
      refresh();
    } catch (err) {
      setError(`Browser login failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAuthingService(null);
    }
  };

  const startOauth = async (service: string) => {
    setAuthingService(service);
    setError(null);
    setCodeCopied(false);
    try {
      const flow = await startAuthFlow(service);

      // IMPORTANT: do NOT auto-open the verification URL here. We're inside
      // an async callback that has already awaited startAuthFlow, so any
      // window.open() call now is considered detached from the user gesture
      // and gets blocked by Safari (always) and Chrome (sometimes). The UI
      // instead shows a prominent "Open GitHub" button the user clicks —
      // that click is a fresh user gesture, so popups always work.
      setAuthPrompt({
        service,
        userCode: flow.userCode,
        verificationUri: flow.verificationUri,
      });

      const interval = (flow.interval ?? 5) * 1000;
      let pollDelay = interval;
      const maxAttempts = 180;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, pollDelay));
        const result = await pollAuthFlow(service, flow.deviceCode);
        if (result.status === 'completed') {
          refresh();
          setAuthPrompt(null);
          setAuthingService(null);
          return;
        }
        if (result.slowDown) pollDelay += 5000;
      }
      throw new Error('Authentication timed out');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setAuthPrompt(null);
      setAuthingService(null);
    }
  };

  /**
   * Copy the user code to clipboard AND open the verification URL in a new
   * tab. Both happen inside the direct user click, so the popup always
   * opens and the clipboard write always succeeds.
   */
  const copyCodeAndOpen = async () => {
    if (!authPrompt) return;
    try {
      await navigator.clipboard.writeText(authPrompt.userCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // Clipboard write can fail in insecure contexts — not fatal, user
      // can still select and copy manually
    }
    window.open(authPrompt.verificationUri, '_blank', 'noopener,noreferrer');
  };

  const handleSaveToken = async (service: string) => {
    if (!pasteValue.trim()) return;
    setTokenWarning(null);
    try {
      const result = await saveServiceToken(service, pasteValue.trim());
      if (result.warning) {
        // Token was saved but the format looks wrong — show warning
        // but don't close the paste form so the user can replace it
        setTokenWarning(result.warning);
        refresh(); // Still refresh so the card updates to "connected"
      } else {
        setPasteFor(null);
        setPasteValue('');
        refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleLogout = async (service: string) => {
    if (!confirm(`Remove saved credentials for ${service}?`)) return;
    try {
      await logoutService(service);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const connectedCount = Object.values(authStatus).filter((s) => s.authenticated).length;

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
          width: 600, maxHeight: '85vh', borderRadius: 12,
          backgroundColor: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${tokens.border.subtle}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: tokens.text.primary }}>Connected Services</div>
              <div style={{ fontSize: 11, color: tokens.text.muted, marginTop: 2 }}>
                {connectedCount} of {services.length} services authenticated
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'none', border: 'none', color: tokens.text.muted, fontSize: 20, cursor: 'pointer',
            }}>x</button>
          </div>
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
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={copyCodeAndOpen}
                style={{
                  flex: 1, padding: '9px 14px', fontSize: 12, fontWeight: 700, borderRadius: 6,
                  border: 'none',
                  background: `linear-gradient(135deg, ${tokens.nodeColors['llm-prompt']}, ${tokens.nodeColors['decision-routing']})`,
                  color: '#fff', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                {codeCopied ? 'Code copied — opening GitHub…' : 'Copy code & open GitHub'}
              </button>
            </div>
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

        {error && (
          <div style={{
            padding: '8px 20px', backgroundColor: `${tokens.status.failed}10`,
            borderBottom: `1px solid ${tokens.border.subtle}`, fontSize: 11, color: tokens.status.failed,
          }}>
            {error}
          </div>
        )}

        {/* Search */}
        <div style={{ padding: '10px 20px 0 20px' }}>
          <input
            type="text"
            placeholder="Search services…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: '100%', padding: '8px 10px', fontSize: 12,
              backgroundColor: tokens.bg.input,
              border: `1px solid ${tokens.border.subtle}`,
              borderRadius: 6, color: tokens.text.primary,
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Service list — grouped by category */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {grouped.size === 0 && (
            <div style={{ textAlign: 'center', padding: 20, fontSize: 12, color: tokens.text.muted }}>
              No services match "{query}".
            </div>
          )}
          {ALL_CATEGORIES.map((category) => {
            const catServices = grouped.get(category);
            if (!catServices || catServices.length === 0) return null;
            const isOpen = isSearching || openCats.has(category);
            return (
              <div key={category} style={{ marginBottom: 12 }}>
                <button
                  onClick={() => {
                    if (isSearching) return;
                    setOpenCats((prev) => {
                      const next = new Set(prev);
                      if (next.has(category)) next.delete(category);
                      else next.add(category);
                      return next;
                    });
                  }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 4px', background: 'none', border: 'none',
                    borderBottom: `1px solid ${tokens.border.subtle}`,
                    cursor: isSearching ? 'default' : 'pointer', marginBottom: 8,
                  }}
                >
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: tokens.text.muted,
                    textTransform: 'uppercase', letterSpacing: '1.5px',
                  }}>
                    {category}
                  </span>
                  <span style={{ fontSize: 10, color: tokens.text.muted, display: 'flex', gap: 6 }}>
                    <span style={{ opacity: 0.7 }}>
                      {catServices.filter((s) => authStatus[s.service]?.authenticated).length}/{catServices.length}
                    </span>
                    {!isSearching && <span>{isOpen ? '▾' : '▸'}</span>}
                  </span>
                </button>
                {isOpen && catServices.map((svc) => {
            const status = authStatus[svc.service];
            const isConnected = status?.authenticated;
            const isPasting = pasteFor === svc.service;
            const cli = cliDetection[svc.service];
            const canUseCli = cli?.available && cli?.authenticated;
            const canCliLogin = cli?.available && !cli?.authenticated && CLI_LOGIN_CAPABLE.has(svc.service);
            const isAuthing = authingService === svc.service;

            return (
              <div key={svc.service} style={{
                marginBottom: 8, borderRadius: 8,
                backgroundColor: isConnected ? `${tokens.status.completed}08` : tokens.bg.raised,
                border: `1px solid ${isConnected ? `${tokens.status.completed}30` : tokens.border.subtle}`,
                overflow: 'hidden',
              }}>
                <div style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: tokens.text.primary }}>{svc.label}</span>
                      {isConnected && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                          backgroundColor: `${tokens.status.completed}25`, color: tokens.status.completed,
                          textTransform: 'uppercase', letterSpacing: '0.5px',
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                        }}>
                          <CheckIcon size={10} />
                          {status?.userName ?? 'CONNECTED'}
                        </span>
                      )}
                      {!isConnected && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                          backgroundColor: svc.oauthSupported ? `${tokens.nodeColors['llm-prompt']}20` : `${tokens.border.default}`,
                          color: svc.oauthSupported ? tokens.nodeColors['llm-prompt'] : tokens.text.muted,
                          textTransform: 'uppercase', letterSpacing: '0.5px',
                        }}>
                          {svc.oauthSupported ? 'OAUTH' : 'API TOKEN'}
                        </span>
                      )}
                      {!isConnected && canUseCli && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                          backgroundColor: `${tokens.status.completed}20`, color: tokens.status.completed,
                          textTransform: 'uppercase', letterSpacing: '0.5px',
                        }}>
                          CLI DETECTED{cli?.user ? ` · ${cli.user}` : ''}
                        </span>
                      )}
                      {!isConnected && canCliLogin && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                          backgroundColor: `${tokens.text.accent}20`, color: tokens.text.accent,
                          textTransform: 'uppercase', letterSpacing: '0.5px',
                        }}>
                          CLI READY · NOT LOGGED IN
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: tokens.text.muted, lineHeight: 1.4 }}>
                      {svc.description}
                    </div>
                    {/* Deep link to provider's key-management page — only for unconnected services
                        that need a manual token. Lets the user jump straight to where they create the key. */}
                    {!isConnected && svc.tokenDocsUrl && (
                      <a
                        href={svc.tokenDocsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          marginTop: 4, fontSize: 10, fontWeight: 600,
                          color: tokens.text.accent, textDecoration: 'none',
                          letterSpacing: '0.2px',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = 'underline'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = 'none'; }}
                      >
                        Open {svc.label} {svc.service === 'slack' ? 'apps' : 'API keys'} ↗
                      </a>
                    )}
                  </div>

                  {isConnected ? (
                    <button
                      onClick={() => handleLogout(svc.service)}
                      style={{
                        padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5,
                        border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
                        color: tokens.text.muted, cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      Disconnect
                    </button>
                  ) : canUseCli ? (
                    <button
                      onClick={() => handleCliConnect(svc.service)}
                      disabled={isAuthing}
                      style={{
                        padding: '6px 14px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none',
                        background: `linear-gradient(135deg, ${tokens.status.completed}, #10b981)`,
                        color: '#fff', cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      {isAuthing ? '...' : 'Use Local CLI'}
                    </button>
                  ) : canCliLogin ? (
                    <button
                      onClick={() => handleCliLogin(svc.service)}
                      disabled={isAuthing}
                      title={`Spawns \`${svc.service === 'launchmatic' ? 'lm' : 'gh'} login\` and waits for the browser flow to finish. If you're already signed into github.com, this is one click.`}
                      style={{
                        padding: '6px 14px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none',
                        background: `linear-gradient(135deg, ${tokens.text.accent}, ${tokens.border.focus})`,
                        color: '#fff', cursor: isAuthing ? 'default' : 'pointer', flexShrink: 0,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      {isAuthing && (
                        <span style={{
                          width: 10, height: 10, borderRadius: '50%',
                          border: '2px solid #fff', borderTopColor: 'transparent',
                          animation: 'spin 0.8s linear infinite', display: 'inline-block',
                        }} />
                      )}
                      {isAuthing ? 'Waiting for browser…' : `Login with ${svc.label}`}
                    </button>
                  ) : svc.oauthSupported ? (
                    <button
                      onClick={() => startOauth(svc.service)}
                      disabled={authingService === svc.service}
                      style={{
                        padding: '6px 14px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none',
                        background: `linear-gradient(135deg, ${tokens.nodeColors['llm-prompt']}, ${tokens.nodeColors['decision-routing']})`,
                        color: '#fff', cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      {authingService === svc.service ? '...' : 'Connect'}
                    </button>
                  ) : (
                    <button
                      onClick={() => { setPasteFor(svc.service); setPasteValue(''); }}
                      style={{
                        padding: '6px 14px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none',
                        background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
                        color: '#fff', cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      Add Token
                    </button>
                  )}
                </div>

                {/* Token paste form */}
                {isPasting && (
                  <div style={{
                    padding: 12, borderTop: `1px solid ${tokens.border.subtle}`,
                    backgroundColor: tokens.bg.surface,
                  }}>
                    {svc.tokenInstructions && (
                      <div style={{ fontSize: 11, color: tokens.text.secondary, marginBottom: 8, lineHeight: 1.4 }}>
                        {svc.tokenInstructions}
                        {svc.tokenDocsUrl && !svc.setupGuide && (
                          <> <a href={svc.tokenDocsUrl} target="_blank" rel="noopener" style={{ color: tokens.text.accent, textDecoration: 'underline' }}>Open docs →</a></>
                        )}
                      </div>
                    )}

                    {/* Collapsible step-by-step setup guide */}
                    {svc.setupGuide && (
                      <div style={{ marginBottom: 10 }}>
                        <button
                          onClick={() => setGuideOpen(!guideOpen)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            background: 'none', border: 'none', padding: 0,
                            cursor: 'pointer', fontSize: 11, fontWeight: 600,
                            color: tokens.text.accent,
                          }}
                        >
                          <span style={{
                            fontSize: 8, transition: 'transform 0.15s',
                            transform: guideOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                            display: 'inline-block',
                          }}>
                            &#9654;
                          </span>
                          {guideOpen ? 'Hide setup guide' : 'Show setup guide — create a Slack app in 2 minutes'}
                        </button>
                        {guideOpen && (
                          <ol style={{
                            margin: '8px 0 0 0', padding: '0 0 0 20px',
                            fontSize: 11, color: tokens.text.secondary, lineHeight: 1.8,
                          }}>
                            {svc.setupGuide.map((step, si) => (
                              <li key={si} style={{ marginBottom: 2 }}>
                                {step.url ? (
                                  <a
                                    href={step.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: tokens.text.accent, textDecoration: 'none' }}
                                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = 'underline'; }}
                                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = 'none'; }}
                                  >
                                    {step.text} ↗
                                  </a>
                                ) : (
                                  step.text
                                )}
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        style={{ ...inputBase, flex: 1, fontFamily: tokens.font.mono }}
                        type="password"
                        autoFocus
                        value={pasteValue}
                        onChange={(e) => setPasteValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveToken(svc.service)}
                        placeholder={`Paste your ${svc.label} token...`}
                      />
                      <button
                        onClick={() => handleSaveToken(svc.service)}
                        disabled={!pasteValue.trim()}
                        style={{
                          padding: '6px 14px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none',
                          backgroundColor: pasteValue.trim() ? tokens.status.completed : tokens.border.default,
                          color: '#fff', cursor: pasteValue.trim() ? 'pointer' : 'default',
                        }}
                      >Save</button>
                      <button
                        onClick={() => { setPasteFor(null); setPasteValue(''); }}
                        style={{
                          padding: '6px 10px', fontSize: 11, borderRadius: 6,
                          border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
                          color: tokens.text.muted, cursor: 'pointer',
                        }}
                      >Cancel</button>
                    </div>
                    {tokenWarning && (
                      <div style={{
                        marginTop: 8, padding: 8, borderRadius: 4,
                        backgroundColor: `${tokens.status.paused}10`,
                        border: `1px solid ${tokens.status.paused}30`,
                        fontSize: 11, color: tokens.status.paused, lineHeight: 1.4,
                      }}>
                        {tokenWarning}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: tokens.text.muted, marginTop: 6 }}>
                      Saved to ~/.stirrup/tokens.json (0600 permissions)
                    </div>
                  </div>
                )}
              </div>
            );
                })}
              </div>
            );
          })}
        </div>

        <div style={{
          padding: '10px 20px', borderTop: `1px solid ${tokens.border.subtle}`,
          fontSize: 10, color: tokens.text.muted,
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          <div>Credentials are auto-injected into workflows that declare matching service params.</div>
          {storeLocation && (
            <div style={{ fontFamily: tokens.font.mono, color: tokens.text.secondary }}>
              Stored in: {storeLocation} (mode 0600)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
