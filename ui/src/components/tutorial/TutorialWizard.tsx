/**
 * Interactive tutorial overlay. Renders via a portal to document.body at z-index
 * 950 (below modals at 1000, above mobile drawers at 901). Uses an SVG mask to
 * cut a spotlight hole over the target element, and positions a tooltip card
 * relative to the target.
 */
import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { tokens } from '../ui/styles';
import type { TutorialStep } from './tutorialSteps';

interface Props {
  step: TutorialStep;
  currentStep: number;
  totalSteps: number;
  isFirst: boolean;
  isLast: boolean;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const OVERLAY_Z = 950;
const TOOLTIP_Z = 951;
const SPOTLIGHT_RADIUS = 8;
const GAP = 12; // px between spotlight and tooltip

export function TutorialWizard({
  step, currentStep, totalSteps, isFirst, isLast,
  onNext, onPrev, onSkip,
}: Props) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [visible, setVisible] = useState(false);

  // Measure target element and position tooltip
  const measure = useCallback(() => {
    if (!step.target) {
      setTargetRect(null);
      // Center the tooltip
      const tw = Math.min(420, window.innerWidth - 32);
      setTooltipPos({
        top: Math.max(80, window.innerHeight / 2 - 120),
        left: (window.innerWidth - tw) / 2,
      });
      setVisible(true);
      return;
    }

    const el = document.querySelector(step.target);
    if (!el) {
      setTargetRect(null);
      setTooltipPos({
        top: Math.max(80, window.innerHeight / 2 - 120),
        left: (window.innerWidth - Math.min(420, window.innerWidth - 32)) / 2,
      });
      setVisible(true);
      return;
    }

    // Scroll into view if needed
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Small delay for scroll to settle
    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      const pad = step.spotlightPadding ?? 6;
      const spotlight: Rect = {
        x: rect.left - pad,
        y: rect.top - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      };
      setTargetRect(spotlight);

      // Position tooltip
      const tooltipEl = tooltipRef.current;
      const tw = tooltipEl?.offsetWidth ?? 340;
      const th = tooltipEl?.offsetHeight ?? 200;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let top = 0;
      let left = 0;

      switch (step.placement) {
        case 'bottom':
          top = spotlight.y + spotlight.height + GAP;
          left = spotlight.x + spotlight.width / 2 - tw / 2;
          if (top + th > vh - 16) { top = spotlight.y - th - GAP; } // flip to top
          break;
        case 'top':
          top = spotlight.y - th - GAP;
          left = spotlight.x + spotlight.width / 2 - tw / 2;
          if (top < 16) { top = spotlight.y + spotlight.height + GAP; } // flip to bottom
          break;
        case 'right':
          top = spotlight.y + spotlight.height / 2 - th / 2;
          left = spotlight.x + spotlight.width + GAP;
          if (left + tw > vw - 16) { left = spotlight.x - tw - GAP; } // flip to left
          break;
        case 'left':
          top = spotlight.y + spotlight.height / 2 - th / 2;
          left = spotlight.x - tw - GAP;
          if (left < 16) { left = spotlight.x + spotlight.width + GAP; } // flip to right
          break;
        case 'center':
          top = vh / 2 - th / 2;
          left = (vw - tw) / 2;
          break;
      }

      // Clamp to viewport
      left = Math.max(16, Math.min(left, vw - tw - 16));
      top = Math.max(16, Math.min(top, vh - th - 16));

      setTooltipPos({ top, left });
      setVisible(true);
    });
  }, [step]);

  // Re-measure on step change
  useEffect(() => {
    setVisible(false);
    const timer = setTimeout(measure, 50);
    return () => clearTimeout(timer);
  }, [step.id, measure]);

  // Re-measure on resize
  useEffect(() => {
    const handler = () => measure();
    window.addEventListener('resize', handler, { passive: true });
    return () => window.removeEventListener('resize', handler);
  }, [measure]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip();
      if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); isLast ? onSkip() : onNext(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); if (!isFirst) onPrev(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onNext, onPrev, onSkip, isFirst, isLast]);

  const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: OVERLAY_Z,
    transition: 'opacity 0.2s',
    opacity: visible ? 1 : 0,
  };

  const tooltipStyle: CSSProperties = {
    position: 'fixed',
    zIndex: TOOLTIP_Z,
    top: tooltipPos.top,
    left: tooltipPos.left,
    width: Math.min(420, window.innerWidth - 32),
    backgroundColor: tokens.bg.surface,
    border: `1px solid ${tokens.border.default}`,
    borderRadius: 10,
    boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    padding: 20,
    transition: 'opacity 0.2s, transform 0.2s',
    opacity: visible ? 1 : 0,
    transform: visible ? 'translateY(0)' : 'translateY(8px)',
  };

  const btnBase: CSSProperties = {
    padding: '7px 16px',
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: tokens.font.sans,
  };

  const portal = (
    <>
      {/* SVG overlay with spotlight hole */}
      <svg style={overlayStyle} viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`} preserveAspectRatio="none">
        <defs>
          <mask id="tutorial-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.x}
                y={targetRect.y}
                width={targetRect.width}
                height={targetRect.height}
                rx={SPOTLIGHT_RADIUS}
                ry={SPOTLIGHT_RADIUS}
                fill="black"
                style={{ transition: 'all 0.3s ease' }}
              />
            )}
          </mask>
        </defs>
        <rect
          x="0" y="0" width="100%" height="100%"
          fill="rgba(0,0,0,0.65)"
          mask="url(#tutorial-mask)"
        />
      </svg>

      {/* Click-through zone over the spotlight (so the overlay doesn't block hover) */}
      {targetRect && (
        <div
          style={{
            position: 'fixed',
            zIndex: OVERLAY_Z,
            top: targetRect.y,
            left: targetRect.x,
            width: targetRect.width,
            height: targetRect.height,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Tooltip card */}
      <div ref={tooltipRef} style={tooltipStyle}>
        {/* Progress dots */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4, marginBottom: 12,
        }}>
          {Array.from({ length: totalSteps }, (_, i) => (
            <div
              key={i}
              style={{
                width: i === currentStep ? 16 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === currentStep
                  ? tokens.border.focus
                  : i < currentStep
                    ? tokens.status.completed
                    : tokens.border.default,
                transition: 'all 0.2s',
              }}
            />
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 10, color: tokens.text.muted }}>
            {currentStep + 1} / {totalSteps}
          </span>
        </div>

        {/* Title */}
        <div style={{
          fontSize: 16, fontWeight: 700, color: tokens.text.primary,
          marginBottom: 8,
        }}>
          {step.title}
        </div>

        {/* Description */}
        <div style={{
          fontSize: 13, color: tokens.text.secondary, lineHeight: 1.6,
          marginBottom: 16,
        }}>
          {step.description}
        </div>

        {/* Navigation buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!isFirst && (
            <button
              onClick={onPrev}
              style={{
                ...btnBase,
                border: `1px solid ${tokens.border.default}`,
                backgroundColor: 'transparent',
                color: tokens.text.secondary,
              }}
            >
              Back
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={onSkip}
            style={{
              ...btnBase,
              border: 'none',
              backgroundColor: 'transparent',
              color: tokens.text.muted,
            }}
          >
            {isLast ? '' : 'Skip'}
          </button>
          <button
            onClick={isLast ? onSkip : onNext}
            style={{
              ...btnBase,
              border: 'none',
              backgroundColor: tokens.border.focus,
              color: '#fff',
            }}
          >
            {isLast ? 'Get started' : 'Next'}
          </button>
        </div>

        {/* Keyboard hint */}
        <div style={{ fontSize: 10, color: tokens.text.muted, marginTop: 10, textAlign: 'center' }}>
          Arrow keys to navigate, Esc to skip
        </div>
      </div>
    </>
  );

  return createPortal(portal, document.body);
}
