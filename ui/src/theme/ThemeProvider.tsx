import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PALETTES, type Palette, type ThemeId } from './palettes';
import { tokens } from '../components/ui/styles';

/**
 * Theme context.
 *
 * Approach: we mutate the shared `tokens` object in place on every
 * theme change. This lets every component that imports `tokens`
 * continue to work unchanged — `tokens.bg.base` is a plain string the
 * components read inline for style props. The React context's sole job
 * is to signal a re-render so components pick up the new values.
 *
 * Alpha-tint patterns like `${tokens.border.subtle}30` continue to
 * work because the value is a hex string in both palettes. A subtle
 * border in light mode evaluates `#e2e8f030` — still subtle, if a
 * little cooler than the dark-theme version.
 *
 * The choice is persisted to localStorage so reloads remember the
 * preference. Respects prefers-color-scheme on first visit.
 */

const LS_KEY = 'stirrup-theme';

interface ThemeContextValue {
  theme: ThemeId;
  palette: Palette;
  setTheme: (t: ThemeId) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function initialTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(LS_KEY) as ThemeId | null;
    if (stored === 'dark' || stored === 'light') return stored;
  } catch { /* localStorage blocked */ }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

function applyPalette(palette: Palette): void {
  // Mutate `tokens` in place — components that have already read
  // values will get fresh ones on their next render (triggered by
  // the context value change).
  Object.assign(tokens.bg, palette.bg);
  Object.assign(tokens.border, palette.border);
  Object.assign(tokens.text, palette.text);

  // Also set a data-theme attribute on <html> so CSS files that want
  // to style on theme (React Flow internals, scrollbars) can key on it.
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = palette === PALETTES.dark ? 'dark' : 'light';
    document.body.style.backgroundColor = palette.bg.base;
    document.body.style.color = palette.text.primary;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(initialTheme);

  // Apply palette synchronously on first paint so the dark→light swap
  // doesn't flash mid-load on subsequent visits.
  useEffect(() => {
    applyPalette(PALETTES[theme]);
    try { localStorage.setItem(LS_KEY, theme); } catch { /* non-fatal */ }
  }, [theme]);

  const setTheme = useCallback((t: ThemeId) => setThemeState(t), []);
  const toggle = useCallback(() => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')), []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, palette: PALETTES[theme], setTheme, toggle }),
    [theme, setTheme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be called inside <ThemeProvider>');
  return ctx;
}
