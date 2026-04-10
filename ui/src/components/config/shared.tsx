import type { CSSProperties } from 'react';
import { inputBase, monoInput, labelStyle, selectStyle, tokens } from '../ui/styles';

interface FieldProps {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}

export function Field({ label, hint, required, children }: FieldProps) {
  return (
    <div style={{ marginBottom: 2 }}>
      <label style={labelStyle}>
        {label}
        {required && <span style={{ color: '#ef4444', fontSize: 9 }}>*</span>}
      </label>
      {children}
      {hint && (
        <div style={{ fontSize: 10, color: tokens.text.muted, marginTop: 2, fontStyle: 'italic' }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export function TextInput({ value, onChange, placeholder, mono }: {
  value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean;
}) {
  return (
    <input
      style={mono ? monoInput : inputBase}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      onFocus={(e) => { (e.target as HTMLElement).style.borderColor = tokens.border.focus; }}
      onBlur={(e) => { (e.target as HTMLElement).style.borderColor = tokens.border.subtle; }}
    />
  );
}

export function TextArea({ value, onChange, placeholder, rows, mono }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; mono?: boolean;
}) {
  const style: CSSProperties = {
    ...(mono ? monoInput : inputBase),
    height: 'auto',
    minHeight: (rows ?? 6) * 20,
    resize: 'vertical',
  };
  return (
    <textarea
      style={style}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows ?? 3}
      onFocus={(e) => { (e.target as HTMLElement).style.borderColor = tokens.border.focus; }}
      onBlur={(e) => { (e.target as HTMLElement).style.borderColor = tokens.border.subtle; }}
    />
  );
}

export function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      style={selectStyle}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function NumberInput({ value, onChange, placeholder, min, max, step }: {
  value: number | undefined; onChange: (v: number | undefined) => void;
  placeholder?: string; min?: number; max?: number; step?: number;
}) {
  return (
    <input
      type="number"
      style={{ ...inputBase, width: 120 }}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      onFocus={(e) => { (e.target as HTMLElement).style.borderColor = tokens.border.focus; }}
      onBlur={(e) => { (e.target as HTMLElement).style.borderColor = tokens.border.subtle; }}
    />
  );
}

export function Toggle({ value, onChange, label }: {
  value: boolean; onChange: (v: boolean) => void; label?: string;
}) {
  const trackStyle: CSSProperties = {
    width: 36,
    height: 20,
    borderRadius: 10,
    backgroundColor: value ? tokens.border.focus : tokens.border.default,
    cursor: 'pointer',
    position: 'relative',
    transition: 'background-color 0.2s',
    flexShrink: 0,
  };
  const thumbStyle: CSSProperties = {
    width: 16,
    height: 16,
    borderRadius: '50%',
    backgroundColor: '#fff',
    position: 'absolute',
    top: 2,
    left: value ? 18 : 2,
    transition: 'left 0.2s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={trackStyle} onClick={() => onChange(!value)}>
        <div style={thumbStyle} />
      </div>
      {label && <span style={{ fontSize: 12, color: tokens.text.secondary }}>{label}</span>}
    </div>
  );
}

export function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 700,
      color: tokens.text.muted,
      textTransform: 'uppercase',
      letterSpacing: '1px',
      padding: '8px 0 4px',
      borderTop: `1px solid ${tokens.border.subtle}`,
      marginTop: 8,
    }}>
      {title}
    </div>
  );
}
