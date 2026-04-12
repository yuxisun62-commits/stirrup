import { useEffect, useState } from 'react';
import {
  getAuthStatus, startAuthFlow, pollAuthFlow, saveServiceToken, logoutService,
  detectCli, connectViaCli, cliLogin,
  type AuthStatus, type CliDetection,
} from '../api/client';

/** Services whose CLI ships an interactive `<cli> login` command we can spawn */
const CLI_LOGIN_CAPABLE = new Set(['launchmatic', 'github']);
import { tokens, inputBase } from './ui/styles';
import { CheckIcon } from './ui/icons';

interface Props {
  onClose: () => void;
}

interface ServiceCard {
  service: string;
  label: string;
  description: string;
  oauthSupported: boolean;
  tokenDocsUrl?: string;
  tokenInstructions?: string;
}

const KNOWN_SERVICES: ServiceCard[] = [
  {
    service: 'github',
    label: 'GitHub',
    description: 'PRs, issues, comments, file listing, code search',
    oauthSupported: true,
  },
  {
    service: 'launchmatic',
    label: 'Launchmatic',
    description: 'Deploy services, manage databases, run browser tests',
    oauthSupported: false,
    tokenDocsUrl: 'https://app.launchmatic.io/settings/api-keys',
    tokenInstructions: 'Install the Launchmatic CLI (`npm i -g @launchmatic/cli`), run `lm login`, then create an API key with `lm api-key create stirrup` and paste it here.',
  },
  {
    service: 'stripe',
    label: 'Stripe',
    description: 'Charges, customers, payments, invoices',
    oauthSupported: false,
    tokenDocsUrl: 'https://dashboard.stripe.com/apikeys',
    tokenInstructions: 'Get a secret API key from your Stripe dashboard, or run `stripe login` and Stirrup will detect it.',
  },
  {
    service: 'aws',
    label: 'AWS',
    description: 'S3, Lambda, DynamoDB, and all AWS services',
    oauthSupported: false,
    tokenInstructions: 'Run `aws configure` to set up credentials — Stirrup will detect them automatically.',
  },
  {
    service: 'gcloud',
    label: 'Google Cloud',
    description: 'GCS, BigQuery, Cloud Run, Pub/Sub',
    oauthSupported: false,
    tokenInstructions: 'Run `gcloud auth login` and Stirrup will grab a fresh access token.',
  },
  {
    service: 'slack',
    label: 'Slack',
    description: 'Send messages, upload files, list channels',
    oauthSupported: false,
    tokenDocsUrl: 'https://api.slack.com/apps',
    tokenInstructions: 'Create a Slack app at api.slack.com/apps, install it to your workspace, and copy the bot token (xoxb-...).',
  },
  {
    service: 'jira',
    label: 'Jira',
    description: 'Create issues, transitions, search',
    oauthSupported: false,
    tokenDocsUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
    tokenInstructions: 'Create an API token from your Atlassian account settings.',
  },
  {
    service: 'hubspot',
    label: 'HubSpot',
    description: 'Contacts, deals, search, engagements',
    oauthSupported: false,
    tokenDocsUrl: 'https://app.hubspot.com/private-apps',
    tokenInstructions: 'Create a private app in HubSpot to generate an access token.',
  },
  {
    service: 'typefully',
    label: 'Typefully',
    description: 'Schedule X/Twitter threads and LinkedIn posts with an AI-friendly draft API',
    oauthSupported: false,
    tokenDocsUrl: 'https://typefully.com/settings/integrations',
    tokenInstructions: 'Open Typefully → Settings → Integrations → API Keys, create a key, and paste it here.',
  },
  {
    service: 'buffer',
    label: 'Buffer',
    description: 'Schedule posts to LinkedIn, Facebook, Instagram, and Threads',
    oauthSupported: false,
    tokenDocsUrl: 'https://publish.buffer.com/account/apps',
    tokenInstructions: 'Open Buffer → Account → Apps & Extras → API Access. Create an access token and paste it here.',
  },
  {
    service: 'replicate',
    label: 'Replicate',
    description: 'Run any hosted model — Flux/SDXL for images, Whisper for audio, Llama for text',
    oauthSupported: false,
    tokenDocsUrl: 'https://replicate.com/account/api-tokens',
    tokenInstructions: 'Open Replicate → Account → API Tokens, create a token, and paste it here.',
  },
  {
    service: 'linkedin',
    label: 'LinkedIn',
    description: 'Post to personal or org feed, fetch post stats, list recent shares',
    oauthSupported: false,
    tokenDocsUrl: 'https://www.linkedin.com/developers/apps',
    tokenInstructions: 'Create a LinkedIn Developer App at linkedin.com/developers/apps, run the OAuth flow with scopes `w_member_social r_liteprofile`, and paste the resulting access token here. Tokens are long-lived (~60 days).',
  },
  {
    service: 'anthropic',
    label: 'Anthropic',
    description: 'API key for every AI node — Claude prompts, agentic tool use, decision routing, code generation',
    oauthSupported: false,
    tokenDocsUrl: 'https://console.anthropic.com/settings/keys',
    tokenInstructions: 'Open the Anthropic Console → API Keys → Create Key. Paste the resulting `sk-ant-...` key here.',
  },
];

export function AuthPanel({ onClose }: Props) {
  const [authStatus, setAuthStatus] = useState<Record<string, AuthStatus>>({});
  const [storeLocation, setStoreLocation] = useState<string>('');
  const [cliDetection, setCliDetection] = useState<Record<string, CliDetection>>({});
  const [authingService, setAuthingService] = useState<string | null>(null);
  const [authPrompt, setAuthPrompt] = useState<{
    service: string;
    userCode: string;
    verificationUri: string;
  } | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [pasteFor, setPasteFor] = useState<string | null>(null);
  const [pasteValue, setPasteValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    getAuthStatus().then((res) => {
      setAuthStatus(res.services);
      if (res.storeLocation) setStoreLocation(res.storeLocation);
    }).catch(() => {});
    // Detect CLI sessions for all known services in parallel
    Promise.all(
      KNOWN_SERVICES.map((svc) =>
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

  useEffect(refresh, []);

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
    try {
      await saveServiceToken(service, pasteValue.trim());
      setPasteFor(null);
      setPasteValue('');
      refresh();
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
                {connectedCount} of {KNOWN_SERVICES.length} services authenticated
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

        {/* Service list */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {KNOWN_SERVICES.map((svc) => {
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
                        {svc.tokenDocsUrl && (
                          <> <a href={svc.tokenDocsUrl} target="_blank" rel="noopener" style={{ color: tokens.text.accent, textDecoration: 'underline' }}>Open docs →</a></>
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
                    <div style={{ fontSize: 10, color: tokens.text.muted, marginTop: 6 }}>
                      Saved to ~/.stirrup/tokens.json (0600 permissions)
                    </div>
                  </div>
                )}
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
