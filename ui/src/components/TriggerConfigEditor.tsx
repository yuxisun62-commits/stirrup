import { useState, useMemo } from 'react';
import type { WorkflowTrigger } from '../api/client';
import { tokens, inputBase } from './ui/styles';

/**
 * Design-time editor for a workflow's `triggers:` block.
 *
 * Four toggleable sections — one per supported trigger kind. Each
 * section hides its configuration fields when its toggle is off. Save
 * propagates a fresh WorkflowTrigger object upward (strips empty
 * sections so the YAML stays clean).
 *
 * Distinct from the live TriggersPanel, which is read-only runtime
 * status. This one is the design-time declaration that feeds the
 * server's TriggerManager after the workflow is saved.
 */

interface Props {
  triggers?: WorkflowTrigger;
  onChange: (triggers: WorkflowTrigger | undefined) => void;
  onClose: () => void;
}

const KIND_COLORS = {
  http: '#06b6d4',
  webhook: '#ec4899',
  cron: '#f59e0b',
  telegram: '#0088cc',
} as const;

export function TriggerConfigEditor({ triggers, onChange, onClose }: Props) {
  // Local draft — we commit to parent on Save so a user can bail via
  // Cancel / Esc without partial state leaking.
  const [draft, setDraft] = useState<WorkflowTrigger>(() => ({ ...(triggers ?? {}) }));

  const activeCount = useMemo(
    () =>
      (draft.http ? 1 : 0) +
      (draft.webhook ? 1 : 0) +
      (draft.cron ? 1 : 0) +
      (draft.telegram ? 1 : 0),
    [draft],
  );

  const setHttp = (enabled: boolean) =>
    setDraft((d) => ({ ...d, http: enabled ? { path: `/${Math.random().toString(36).slice(2, 8)}`, method: 'POST' } : undefined }));
  const setWebhook = (enabled: boolean) =>
    setDraft((d) => ({ ...d, webhook: enabled ? { source: 'github' } : undefined }));
  const setCron = (enabled: boolean) =>
    setDraft((d) => ({ ...d, cron: enabled ? { schedule: '0 * * * *' } : undefined }));
  const setTelegram = (enabled: boolean) =>
    setDraft((d) => ({ ...d, telegram: enabled ? {} : undefined }));

  const save = () => {
    // Normalize: strip empty objects so the persisted YAML doesn't
    // have ghost keys. If NOTHING is enabled, pass undefined to remove
    // the field entirely from the workflow.
    const next: WorkflowTrigger = {};
    if (draft.http) next.http = draft.http;
    if (draft.webhook) next.webhook = draft.webhook;
    if (draft.cron) next.cron = draft.cron;
    if (draft.telegram) next.telegram = draft.telegram;
    onChange(Object.keys(next).length > 0 ? next : undefined);
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(640px, 100vw)',
          maxHeight: '85vh',
          backgroundColor: tokens.bg.surface,
          border: `1px solid ${tokens.border.default}`,
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 18px',
          borderBottom: `1px solid ${tokens.border.subtle}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: tokens.text.primary }}>Workflow Triggers</div>
            <div style={{ fontSize: 11, color: tokens.text.muted, marginTop: 2 }}>
              Declare how this workflow fires automatically. {activeCount} enabled.
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: tokens.text.muted,
            fontSize: 20, cursor: 'pointer', padding: 4,
          }}>x</button>
        </div>

        {/* Body — one section per kind */}
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          <TriggerSection
            label="HTTP"
            description="Fire the workflow when a POST/GET hits a chosen path under /triggers/http/…"
            color={KIND_COLORS.http}
            enabled={!!draft.http}
            onToggle={setHttp}
          >
            {draft.http && (
              <>
                <Field label="Path">
                  <input
                    style={{ ...inputBase, fontFamily: tokens.font.mono }}
                    value={draft.http.path ?? ''}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, http: { ...d.http, path: e.target.value || undefined } }))
                    }
                    placeholder="/my-workflow"
                  />
                </Field>
                <Field label="Method">
                  <select
                    style={{ ...inputBase }}
                    value={draft.http.method ?? 'POST'}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, http: { ...d.http, method: e.target.value as 'POST' | 'GET' } }))
                    }
                  >
                    <option>POST</option>
                    <option>GET</option>
                  </select>
                </Field>
                <Hint>
                  Endpoint will be: <code style={{ color: tokens.text.accent }}>
                    /triggers/http{draft.http.path ?? '/<path>'}
                  </code>
                </Hint>
              </>
            )}
          </TriggerSection>

          <TriggerSection
            label="Webhook"
            description="Fire on inbound webhook matching a source (github, stripe, ...). Optional HMAC secret."
            color={KIND_COLORS.webhook}
            enabled={!!draft.webhook}
            onToggle={setWebhook}
          >
            {draft.webhook && (
              <>
                <Field label="Source">
                  <input
                    style={{ ...inputBase, fontFamily: tokens.font.mono }}
                    value={draft.webhook.source}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, webhook: { ...d.webhook!, source: e.target.value } }))
                    }
                    placeholder="github"
                  />
                </Field>
                <Field label="Events (comma-separated)" hint="e.g. pull_request.opened, push">
                  <input
                    style={{ ...inputBase, fontFamily: tokens.font.mono }}
                    value={(draft.webhook.events ?? []).join(', ')}
                    onChange={(e) => {
                      const list = e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                      setDraft((d) => ({
                        ...d,
                        webhook: { ...d.webhook!, events: list.length > 0 ? list : undefined },
                      }));
                    }}
                  />
                </Field>
                <Field label="HMAC secret" hint="When set, incoming POSTs must carry a matching X-Hub-Signature-256 header">
                  <input
                    style={{ ...inputBase, fontFamily: tokens.font.mono }}
                    type="password"
                    value={draft.webhook.secret ?? ''}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        webhook: { ...d.webhook!, secret: e.target.value || undefined },
                      }))
                    }
                  />
                </Field>
                <Hint>
                  Endpoint will be: <code style={{ color: tokens.text.accent }}>
                    /triggers/webhook/{draft.webhook.source}
                  </code>
                </Hint>
              </>
            )}
          </TriggerSection>

          <TriggerSection
            label="Cron Schedule"
            description="Fire on a cron schedule (5-field expression). Optional IANA timezone."
            color={KIND_COLORS.cron}
            enabled={!!draft.cron}
            onToggle={setCron}
          >
            {draft.cron && (
              <>
                <Field label="Schedule">
                  <input
                    style={{ ...inputBase, fontFamily: tokens.font.mono }}
                    value={draft.cron.schedule}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, cron: { ...d.cron!, schedule: e.target.value } }))
                    }
                    placeholder="0 9 * * 1-5"
                  />
                </Field>
                <Field label="Timezone">
                  <input
                    style={{ ...inputBase, fontFamily: tokens.font.mono }}
                    value={draft.cron.timezone ?? ''}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        cron: { ...d.cron!, timezone: e.target.value || undefined },
                      }))
                    }
                    placeholder="America/New_York"
                  />
                </Field>
                <Hint>
                  Common shortcuts: <code>*/5 * * * *</code> every 5 min ·
                  <code> 0 * * * *</code> hourly ·
                  <code> 0 0 * * *</code> daily at midnight
                </Hint>
              </>
            )}
          </TriggerSection>

          <TriggerSection
            label="Telegram Bot"
            description="Long-poll a Telegram bot and fire on each incoming message. Requires a token in Connections → telegram."
            color={KIND_COLORS.telegram}
            enabled={!!draft.telegram}
            onToggle={setTelegram}
          >
            {draft.telegram && (
              <>
                <Field label="Allowed chat IDs" hint="Comma-separated. Leave blank to accept any chat.">
                  <input
                    style={{ ...inputBase, fontFamily: tokens.font.mono }}
                    value={(draft.telegram.allowedChatIds ?? []).join(', ')}
                    onChange={(e) => {
                      const list = e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                      setDraft((d) => ({
                        ...d,
                        telegram: {
                          ...d.telegram!,
                          allowedChatIds: list.length > 0 ? list : undefined,
                        },
                      }));
                    }}
                  />
                </Field>
                <Field label="Commands" hint="Comma-separated. If set, only messages starting with one of these fire the workflow.">
                  <input
                    style={{ ...inputBase, fontFamily: tokens.font.mono }}
                    value={(draft.telegram.commands ?? []).join(', ')}
                    onChange={(e) => {
                      const list = e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                      setDraft((d) => ({
                        ...d,
                        telegram: {
                          ...d.telegram!,
                          commands: list.length > 0 ? list : undefined,
                        },
                      }));
                    }}
                    placeholder="/start, /run"
                  />
                </Field>
              </>
            )}
          </TriggerSection>
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 16px', borderTop: `1px solid ${tokens.border.subtle}`,
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '7px 14px', fontSize: 12, fontWeight: 600, borderRadius: 5,
              border: `1px solid ${tokens.border.default}`,
              backgroundColor: 'transparent', color: tokens.text.muted,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            style={{
              padding: '7px 16px', fontSize: 12, fontWeight: 700, borderRadius: 5,
              border: 'none',
              backgroundColor: tokens.status.completed, color: '#fff',
              cursor: 'pointer',
            }}
          >
            Save triggers
          </button>
        </div>
      </div>
    </div>
  );
}

function TriggerSection({
  label, description, color, enabled, onToggle, children,
}: {
  label: string; description: string; color: string;
  enabled: boolean; onToggle: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div style={{
      marginBottom: 12,
      borderRadius: 8,
      border: `1px solid ${enabled ? `${color}40` : tokens.border.subtle}`,
      backgroundColor: enabled ? `${color}08` : tokens.bg.raised,
      overflow: 'hidden',
    }}>
      <label style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: 12, cursor: 'pointer', userSelect: 'none',
      }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          style={{ cursor: 'pointer', accentColor: color, width: 16, height: 16 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: enabled ? color : tokens.text.primary,
            letterSpacing: 0.3,
          }}>
            {label}
          </div>
          <div style={{ fontSize: 11, color: tokens.text.muted, marginTop: 2 }}>
            {description}
          </div>
        </div>
      </label>
      {enabled && children && (
        <div style={{
          padding: '0 14px 14px',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        fontSize: 10, fontWeight: 600, color: tokens.text.muted,
        textTransform: 'uppercase', letterSpacing: 0.5,
        display: 'block', marginBottom: 3,
      }}>
        {label}
      </label>
      {children}
      {hint && (
        <div style={{
          fontSize: 10, color: tokens.text.muted, marginTop: 2, fontStyle: 'italic',
        }}>{hint}</div>
      )}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, color: tokens.text.muted, marginTop: 2,
      padding: '6px 8px', borderRadius: 4,
      backgroundColor: `${tokens.border.subtle}40`,
    }}>
      {children}
    </div>
  );
}
