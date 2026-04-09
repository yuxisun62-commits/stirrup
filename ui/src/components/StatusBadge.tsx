import { tokens } from './ui/styles';

export function StatusBadge({ status, size }: { status: string; size?: 'sm' | 'md' }) {
  const small = size === 'sm';
  const color = (tokens.status as Record<string, string>)[status] ?? tokens.status.pending;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: small ? '1px 6px' : '2px 8px',
        borderRadius: 4,
        fontSize: small ? 9 : 10,
        fontWeight: 700,
        color,
        backgroundColor: `${color}15`,
        border: `1px solid ${color}30`,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        fontFamily: tokens.font.mono,
      }}
    >
      <span style={{
        width: small ? 5 : 6, height: small ? 5 : 6, borderRadius: '50%',
        backgroundColor: color,
        animation: status === 'running' ? 'pulse 1.5s ease-in-out infinite' : undefined,
      }} />
      {status}
    </span>
  );
}
