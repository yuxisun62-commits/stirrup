/**
 * Color palettes for dark + light themes.
 *
 * Only `bg`, `text`, and `border` are theme-swapped. Status colors
 * (running / completed / failed / etc.) and node-type brand colors
 * stay identical across themes — they're brand-coded and look fine on
 * both backgrounds.
 *
 * Alpha-tint usage (`${tokens.bg.subtle}30` etc.) continues to work
 * because the token values are hex strings, not CSS vars. The cost is
 * that subtle tints in light mode are computed off the LIGHT palette
 * hex rather than the dark-palette hex — which is correct for most
 * cases but may produce slightly different visual weight. Acceptable
 * for a first pass; a full color-mix() refactor can come later.
 */

export type ThemeId = 'dark' | 'light';

export interface Palette {
  bg: {
    base: string;
    surface: string;
    raised: string;
    input: string;
    hover: string;
  };
  border: {
    subtle: string;
    default: string;
    focus: string;
    accent: string;
  };
  text: {
    primary: string;
    secondary: string;
    muted: string;
    accent: string;
  };
}

export const DARK_PALETTE: Palette = {
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
};

export const LIGHT_PALETTE: Palette = {
  bg: {
    base: '#f8fafc',
    surface: '#ffffff',
    raised: '#f1f5f9',
    input: '#ffffff',
    hover: '#eef2f7',
  },
  border: {
    subtle: '#e2e8f0',
    default: '#cbd5e1',
    focus: '#3b82f6',
    accent: '#94a3b8',
  },
  text: {
    primary: '#0f172a',
    secondary: '#475569',
    muted: '#64748b',
    accent: '#2563eb',
  },
};

export const PALETTES: Record<ThemeId, Palette> = {
  dark: DARK_PALETTE,
  light: LIGHT_PALETTE,
};
