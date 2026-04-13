import type { CSSProperties } from 'react';

// Design tokens
export const tokens = {
  bg: {
    base: '#0a0f1e',
    surface: '#111827',
    raised: '#1a2332',
    input: '#0d1424',
    hover: '#1e2d3d',
  },
  border: {
    subtle: '#1e293b',
    default: '#2a3a4a',
    focus: '#3b82f6',
    accent: '#475569',
  },
  text: {
    primary: '#e2e8f0',
    secondary: '#94a3b8',
    muted: '#64748b',
    accent: '#60a5fa',
  },
  status: {
    running: '#3b82f6',
    completed: '#10b981',
    failed: '#ef4444',
    skipped: '#6b7280',
    pending: '#475569',
    paused: '#f59e0b',
  },
  nodeColors: {
    transform: '#6366f1',
    condition: '#f59e0b',
    http: '#06b6d4',
    script: '#8b5cf6',
    'llm-prompt': '#f97316',
    'agent-tool-use': '#14b8a6',
    'decision-routing': '#a855f7',
    'code-generation': '#84cc16',
  } as Record<string, string>,
  font: {
    mono: "'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace",
    sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  radius: {
    sm: 4,
    md: 6,
    lg: 8,
  },
};

// Shared input styles
export const inputBase: CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  fontSize: 12,
  borderRadius: tokens.radius.md,
  border: `1px solid ${tokens.border.subtle}`,
  backgroundColor: tokens.bg.input,
  color: tokens.text.primary,
  boxSizing: 'border-box',
  fontFamily: tokens.font.sans,
  outline: 'none',
  transition: 'border-color 0.15s',
};

export const monoInput: CSSProperties = {
  ...inputBase,
  fontFamily: tokens.font.mono,
  fontSize: 11,
  lineHeight: 1.5,
};

export const labelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  color: tokens.text.muted,
  marginBottom: 3,
  marginTop: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  fontFamily: tokens.font.sans,
};

export const sectionStyle: CSSProperties = {
  padding: '10px 0',
  borderBottom: `1px solid ${tokens.border.subtle}`,
};

export const btnPrimary: CSSProperties = {
  padding: '6px 14px',
  fontSize: 11,
  fontWeight: 600,
  borderRadius: tokens.radius.md,
  border: 'none',
  backgroundColor: tokens.border.focus,
  color: '#fff',
  cursor: 'pointer',
  fontFamily: tokens.font.sans,
  transition: 'opacity 0.15s',
};

export const btnSecondary: CSSProperties = {
  padding: '5px 10px',
  fontSize: 11,
  fontWeight: 500,
  borderRadius: tokens.radius.md,
  border: `1px solid ${tokens.border.default}`,
  backgroundColor: 'transparent',
  color: tokens.text.secondary,
  cursor: 'pointer',
  fontFamily: tokens.font.sans,
  transition: 'background-color 0.15s',
};

export const btnDanger: CSSProperties = {
  ...btnSecondary,
  borderColor: '#7f1d1d',
  color: '#fca5a5',
};

export const selectStyle: CSSProperties = {
  ...inputBase,
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748b' d='M3 5l3 3 3-3'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 8px center',
  paddingRight: 24,
};
