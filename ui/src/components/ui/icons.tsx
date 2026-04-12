/**
 * Shared icon components for Stirrup's UI.
 *
 * Each icon takes a size prop (default 14) and uses currentColor so they
 * inherit the text color of the surrounding button. Paths are adapted from
 * Lucide (lucide.dev, ISC licensed) — simplified and inlined so we don't
 * pull in the full package for a handful of glyphs.
 *
 * Usage:
 *   <BugIcon /> Debug Node
 *   <BotIcon size={16} /> Analyze with AI
 */
import type { CSSProperties } from 'react';

interface IconProps {
  size?: number;
  style?: CSSProperties;
}

const baseProps = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export function BugIcon({ size = 14, style }: IconProps) {
  return (
    <svg {...baseProps(size)} style={{ flexShrink: 0, ...style }}>
      <path d="m8 2 1.88 1.88" />
      <path d="M14.12 3.88 16 2" />
      <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
      <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
      <path d="M12 20v-9" />
      <path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
      <path d="M6 13H2" />
      <path d="M3 21c0-2.1 1.7-3.9 3.8-4" />
      <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" />
      <path d="M22 13h-4" />
      <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" />
    </svg>
  );
}

export function BotIcon({ size = 14, style }: IconProps) {
  return (
    <svg {...baseProps(size)} style={{ flexShrink: 0, ...style }}>
      <path d="M12 8V4H8" />
      <rect width={16} height={12} x={4} y={8} rx={2} />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}
