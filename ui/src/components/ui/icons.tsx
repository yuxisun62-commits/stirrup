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

export function CheckIcon({ size = 14, style }: IconProps) {
  return (
    <svg {...baseProps(size)} style={{ flexShrink: 0, ...style }}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function RocketIcon({ size = 14, style }: IconProps) {
  return (
    <svg {...baseProps(size)} style={{ flexShrink: 0, ...style }}>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

export function ClipboardIcon({ size = 14, style }: IconProps) {
  return (
    <svg {...baseProps(size)} style={{ flexShrink: 0, ...style }}>
      <rect width={8} height={4} x={8} y={2} rx={1} ry={1} />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </svg>
  );
}

export function LightbulbIcon({ size = 14, style }: IconProps) {
  return (
    <svg {...baseProps(size)} style={{ flexShrink: 0, ...style }}>
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </svg>
  );
}

export function MenuIcon({ size = 14, style }: IconProps) {
  return (
    <svg {...baseProps(size)} style={{ flexShrink: 0, ...style }}>
      <line x1={4} x2={20} y1={12} y2={12} />
      <line x1={4} x2={20} y1={6} y2={6} />
      <line x1={4} x2={20} y1={18} y2={18} />
    </svg>
  );
}
