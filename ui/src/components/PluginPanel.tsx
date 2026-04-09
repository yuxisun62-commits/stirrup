import { useState, useEffect } from 'react';
import { listPlugins, loadPlugin, listNodeTypes, type PluginInfo, type NodeTypeInfo } from '../api/client';
import { tokens, inputBase } from './ui/styles';

interface Props {
  onClose: () => void;
}

export function PluginPanel({ onClose }: Props) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [nodeTypes, setNodeTypes] = useState<NodeTypeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [specifier, setSpecifier] = useState('');
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'plugins' | 'types'>('plugins');

  const refresh = () => {
    setLoading(true);
    Promise.all([listPlugins(), listNodeTypes()])
      .then(([p, t]) => { setPlugins(p); setNodeTypes(t); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const handleLoad = async () => {
    if (!specifier.trim()) return;
    setInstalling(true);
    setError(null);
    try {
      await loadPlugin(specifier.trim());
      setSpecifier('');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 600, maxHeight: '80vh', borderRadius: 12,
          backgroundColor: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${tokens.border.subtle}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: tokens.text.primary }}>Plugins & Node Types</div>
              <div style={{ fontSize: 11, color: tokens.text.muted, marginTop: 2 }}>
                {plugins.length} plugin{plugins.length !== 1 ? 's' : ''} loaded / {nodeTypes.length} node types available
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'none', border: 'none', color: tokens.text.muted, fontSize: 20, cursor: 'pointer', padding: '4px 8px',
            }}>x</button>
          </div>
        </div>

        {/* Load plugin input */}
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${tokens.border.subtle}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>
            Load Plugin
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ ...inputBase, flex: 1, fontSize: 12, fontFamily: tokens.font.mono }}
              value={specifier}
              onChange={(e) => setSpecifier(e.target.value)}
              placeholder="npm package name or local path (e.g., ./plugins/public/github.ts)"
              onKeyDown={(e) => e.key === 'Enter' && handleLoad()}
            />
            <button
              onClick={handleLoad}
              disabled={!specifier.trim() || installing}
              style={{
                padding: '6px 16px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                border: 'none',
                backgroundColor: specifier.trim() && !installing ? tokens.border.focus : tokens.border.default,
                color: '#fff', cursor: specifier.trim() && !installing ? 'pointer' : 'default',
              }}
            >
              {installing ? 'Loading...' : 'Load'}
            </button>
          </div>
          {error && (
            <div style={{ fontSize: 11, color: tokens.status.failed, marginTop: 6 }}>{error}</div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${tokens.border.subtle}` }}>
          {(['plugins', 'types'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: '8px 0', fontSize: 11, fontWeight: 600,
                border: 'none', cursor: 'pointer',
                backgroundColor: activeTab === tab ? tokens.bg.raised : 'transparent',
                color: activeTab === tab ? tokens.text.primary : tokens.text.muted,
                borderBottom: activeTab === tab ? `2px solid ${tokens.border.focus}` : '2px solid transparent',
                textTransform: 'uppercase', letterSpacing: '0.5px',
              }}
            >
              {tab === 'plugins' ? `Plugins (${plugins.length})` : `Node Types (${nodeTypes.length})`}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 30, color: tokens.text.muted }}>Loading...</div>
          ) : activeTab === 'plugins' ? (
            <PluginList plugins={plugins} />
          ) : (
            <NodeTypeList nodeTypes={nodeTypes} />
          )}
        </div>
      </div>
    </div>
  );
}

function PluginList({ plugins }: { plugins: PluginInfo[] }) {
  if (plugins.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 30 }}>
        <div style={{ fontSize: 12, color: tokens.text.muted }}>No plugins loaded</div>
        <div style={{ fontSize: 11, color: tokens.text.muted, marginTop: 4 }}>
          Load a plugin using the input above, or add plugins to .stirrup.json
        </div>
      </div>
    );
  }

  return (
    <div>
      {plugins.map((p) => (
        <div key={p.source} style={{
          padding: 12, marginBottom: 8, borderRadius: 8,
          backgroundColor: tokens.bg.raised, border: `1px solid ${tokens.border.subtle}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: tokens.text.primary }}>{p.name}</span>
            <span style={{
              fontSize: 9, padding: '1px 6px', borderRadius: 3,
              backgroundColor: `${tokens.border.focus}20`, color: tokens.text.accent,
              fontFamily: tokens.font.mono,
            }}>{p.version}</span>
          </div>
          <div style={{ fontSize: 10, color: tokens.text.muted, fontFamily: tokens.font.mono, marginBottom: 8 }}>
            {p.source}
          </div>

          {p.nodeTypes.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: tokens.text.muted, fontWeight: 600 }}>Node types: </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
                {p.nodeTypes.map((t) => (
                  <span key={t} style={{
                    fontSize: 10, padding: '2px 6px', borderRadius: 3,
                    backgroundColor: `${tokens.nodeColors['llm-prompt']}15`,
                    color: tokens.nodeColors['llm-prompt'],
                    fontFamily: tokens.font.mono,
                  }}>{t}</span>
                ))}
              </div>
            </div>
          )}

          {p.tools.length > 0 && (
            <div>
              <span style={{ fontSize: 10, color: tokens.text.muted, fontWeight: 600 }}>Tools: </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
                {p.tools.map((t) => (
                  <span key={t} style={{
                    fontSize: 10, padding: '2px 6px', borderRadius: 3,
                    backgroundColor: `${tokens.nodeColors.transform}15`,
                    color: tokens.nodeColors.transform,
                    fontFamily: tokens.font.mono,
                  }}>{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function NodeTypeList({ nodeTypes }: { nodeTypes: NodeTypeInfo[] }) {
  const builtIn = nodeTypes.filter((t) => t.isBuiltIn);
  const plugin = nodeTypes.filter((t) => !t.isBuiltIn);

  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>
        Built-in ({builtIn.length})
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 16 }}>
        {builtIn.map((t) => (
          <span key={t.type} style={{
            fontSize: 11, padding: '4px 10px', borderRadius: 4,
            border: `1px solid ${tokens.nodeColors[t.type] ?? tokens.border.default}40`,
            backgroundColor: `${tokens.nodeColors[t.type] ?? tokens.border.default}10`,
            color: tokens.nodeColors[t.type] ?? tokens.text.secondary,
            fontFamily: tokens.font.mono, fontWeight: 500,
          }}>{t.type}</span>
        ))}
      </div>

      {plugin.length > 0 && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>
            From Plugins ({plugin.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {plugin.map((t) => (
              <span key={t.type} style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 4,
                border: `1px solid ${tokens.border.default}`,
                backgroundColor: tokens.bg.raised,
                color: tokens.text.secondary,
                fontFamily: tokens.font.mono, fontWeight: 500,
              }}>
                {t.type}
                <span style={{ fontSize: 9, color: tokens.text.muted, marginLeft: 4 }}>({t.source})</span>
              </span>
            ))}
          </div>
        </>
      )}

      {plugin.length === 0 && (
        <div style={{ fontSize: 11, color: tokens.text.muted, fontStyle: 'italic' }}>
          No plugin node types loaded. Load a plugin to add more types.
        </div>
      )}
    </div>
  );
}
