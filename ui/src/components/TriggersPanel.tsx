import { useEffect, useState } from 'react';
import { listTriggers, testTrigger, type TriggerStatus } from '../api/client';
import { tokens } from './ui/styles';

interface TriggersPanelProps {
  onClose: () => void;
}

const KIND_COLOR: Record<string, string> = {
  http: tokens.nodeColors.http ?? '#06b6d4',
  webhook: '#ec4899',
  cron: '#f59e0b',
  telegram: '#3b82f6',
};

const KIND_ICON: Record<string, string> = {
  http: 'HTTP',
  webhook: 'HOOK',
  cron: 'CRON',
  telegram: 'TG',
};

export function TriggersPanel({ onClose }: TriggersPanelProps) {
  const [triggers, setTriggers] = useState<TriggerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const { triggers: list } = await listTriggers();
      setTriggers(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // Poll every 4s so fire counts/last-fired timestamps feel live without
    // a WebSocket. Cheap — the endpoint just walks an in-memory array.
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  const handleTest = async (workflowId: string) => {
    setTesting(workflowId);
    try {
      const result = await testTrigger(workflowId, { _trigger: 'manual-test' });
      alert(`Fired: execution ${result.executionId} — ${result.status}`);
      await refresh();
    } catch (err) {
      alert(`Test failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTesting(null);
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0,
      width: 'min(560px, 100vw)', backgroundColor: tokens.bg.surface,
      borderLeft: `1px solid ${tokens.border.default}`,
      display: 'flex', flexDirection: 'column', zIndex: 1000,
      boxShadow: '-8px 0 24px rgba(0,0,0,0.4)',
    }}>
      <div style={{
        padding: '14px 18px', borderBottom: `1px solid ${tokens.border.subtle}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: tokens.text.primary }}>Triggers</div>
          <div style={{ fontSize: 11, color: tokens.text.muted, marginTop: 2 }}>
            Workflows that fire automatically — HTTP, webhooks, schedules, Telegram.
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: tokens.text.muted,
          fontSize: 20, cursor: 'pointer', padding: 4,
        }}>x</button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
        {loading && <div style={{ color: tokens.text.muted, fontSize: 12 }}>Loading...</div>}
        {error && (
          <div style={{
            padding: 10, borderRadius: 6, fontSize: 12,
            background: '#7f1d1d40', border: '1px solid #b91c1c', color: '#fecaca',
          }}>{error}</div>
        )}
        {!loading && !error && triggers.length === 0 && (
          <div style={{
            padding: 20, textAlign: 'center', fontSize: 12,
            color: tokens.text.muted, border: `1px dashed ${tokens.border.default}`,
            borderRadius: 8,
          }}>
            No triggers active.<br />
            Add <code style={{ color: tokens.text.accent }}>triggers:</code> to a workflow's YAML
            (cron, telegram, http, webhook) and save.
          </div>
        )}

        {triggers.map((t) => (
          <div key={`${t.workflowId}-${t.kind}`} style={{
            padding: 12, marginBottom: 10, borderRadius: 8,
            background: tokens.bg.raised,
            border: `1px solid ${t.lastError ? '#b91c1c60' : tokens.border.subtle}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 4,
                background: `${KIND_COLOR[t.kind]}22`, color: KIND_COLOR[t.kind],
                letterSpacing: 0.5,
              }}>{KIND_ICON[t.kind]}</span>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: tokens.text.primary }}>
                {t.workflowId}
              </div>
              <button
                onClick={() => handleTest(t.workflowId)}
                disabled={testing === t.workflowId}
                style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 4,
                  border: `1px solid ${tokens.border.default}`,
                  background: tokens.bg.input, color: tokens.text.secondary,
                  cursor: testing === t.workflowId ? 'wait' : 'pointer',
                }}
              >{testing === t.workflowId ? 'Firing...' : 'Test'}</button>
            </div>
            <div style={{
              fontSize: 11, fontFamily: tokens.font.mono,
              color: tokens.text.secondary, marginBottom: 6,
            }}>{t.label}</div>
            <div style={{ display: 'flex', gap: 16, fontSize: 10, color: tokens.text.muted }}>
              <div>Fires: <span style={{ color: tokens.text.primary, fontWeight: 600 }}>{t.fireCount}</span></div>
              {t.lastFiredAt && (
                <div>Last: <span style={{ color: tokens.text.primary }}>{formatRelative(t.lastFiredAt)}</span></div>
              )}
            </div>
            {t.lastError && (
              <div style={{
                marginTop: 8, padding: 8, borderRadius: 4, fontSize: 11,
                background: '#7f1d1d30', color: '#fca5a5',
                fontFamily: tokens.font.mono,
              }}>
                Last error: {t.lastError.message}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{
        padding: '10px 14px', borderTop: `1px solid ${tokens.border.subtle}`,
        fontSize: 10, color: tokens.text.muted,
      }}>
        Trigger endpoints: <code>/triggers/http/...</code>, <code>/triggers/webhook/:source</code>.
        Telegram bot token: Connections panel, service "telegram".
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const ago = Date.now() - new Date(iso).getTime();
  if (ago < 1000) return 'just now';
  if (ago < 60_000) return `${Math.floor(ago / 1000)}s ago`;
  if (ago < 3_600_000) return `${Math.floor(ago / 60_000)}m ago`;
  if (ago < 86_400_000) return `${Math.floor(ago / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}
