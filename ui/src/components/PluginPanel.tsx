import { useState, useEffect } from 'react';
import {
  listPluginCatalog, loadPlugin, listNodeTypes,
  type CatalogEntry, type NodeTypeInfo,
} from '../api/client';
import { tokens, inputBase } from './ui/styles';

interface Props {
  onClose: () => void;
}

const CATEGORY_ICONS: Record<string, string> = {
  integration: 'API',
  utility: 'UTL',
  database: 'DB',
  cloud: 'CLD',
};

const CATEGORY_COLORS: Record<string, string> = {
  integration: '#06b6d4',
  utility: '#8b5cf6',
  database: '#f59e0b',
  cloud: '#3b82f6',
};

export function PluginPanel({ onClose }: Props) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [nodeTypes, setNodeTypes] = useState<NodeTypeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPlugin, setLoadingPlugin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customSpecifier, setCustomSpecifier] = useState('');
  const [activeTab, setActiveTab] = useState<'catalog' | 'types'>('catalog');

  const refresh = () => {
    setLoading(true);
    Promise.all([listPluginCatalog(), listNodeTypes()])
      .then(([c, t]) => { setCatalog(c); setNodeTypes(t); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const handleLoad = async (name: string) => {
    setLoadingPlugin(name);
    setError(null);
    try {
      await loadPlugin(name);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingPlugin(null);
    }
  };

  const handleCustomLoad = async () => {
    if (!customSpecifier.trim()) return;
    await handleLoad(customSpecifier.trim());
    setCustomSpecifier('');
  };

  const loadedCount = catalog.filter((p) => p.isLoaded).length;

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
          width: 640, maxHeight: '85vh', borderRadius: 12,
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
              <div style={{ fontSize: 16, fontWeight: 700, color: tokens.text.primary }}>Plugins</div>
              <div style={{ fontSize: 11, color: tokens.text.muted, marginTop: 2 }}>
                {loadedCount} of {catalog.length} built-in plugins active / {nodeTypes.length} node types
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'none', border: 'none', color: tokens.text.muted, fontSize: 20, cursor: 'pointer',
            }}>x</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${tokens.border.subtle}` }}>
          {(['catalog', 'types'] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              flex: 1, padding: '8px 0', fontSize: 11, fontWeight: 600,
              border: 'none', cursor: 'pointer',
              backgroundColor: activeTab === tab ? tokens.bg.raised : 'transparent',
              color: activeTab === tab ? tokens.text.primary : tokens.text.muted,
              borderBottom: activeTab === tab ? `2px solid ${tokens.border.focus}` : '2px solid transparent',
              textTransform: 'uppercase', letterSpacing: '0.5px',
            }}>
              {tab === 'catalog' ? 'Built-in Plugins' : `Node Types (${nodeTypes.length})`}
            </button>
          ))}
        </div>

        {error && (
          <div style={{ padding: '8px 20px', backgroundColor: `${tokens.status.failed}08`, borderBottom: `1px solid ${tokens.border.subtle}` }}>
            <div style={{ fontSize: 11, color: tokens.status.failed }}>{error}</div>
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 30, color: tokens.text.muted }}>Loading...</div>
          ) : activeTab === 'catalog' ? (
            <PluginCatalog catalog={catalog} loadingPlugin={loadingPlugin} onLoad={handleLoad} />
          ) : (
            <NodeTypeList nodeTypes={nodeTypes} />
          )}
        </div>

        {/* Custom plugin loader */}
        <div style={{ padding: '10px 20px', borderTop: `1px solid ${tokens.border.subtle}` }}>
          <div style={{ fontSize: 10, color: tokens.text.muted, marginBottom: 4 }}>Load external plugin</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ ...inputBase, flex: 1, fontSize: 11, fontFamily: tokens.font.mono }}
              value={customSpecifier}
              onChange={(e) => setCustomSpecifier(e.target.value)}
              placeholder="npm-package-name or ./path/to/plugin"
              onKeyDown={(e) => e.key === 'Enter' && handleCustomLoad()}
            />
            <button
              onClick={handleCustomLoad}
              disabled={!customSpecifier.trim() || !!loadingPlugin}
              style={{
                padding: '6px 14px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                border: 'none',
                backgroundColor: customSpecifier.trim() ? tokens.border.focus : tokens.border.default,
                color: '#fff', cursor: customSpecifier.trim() ? 'pointer' : 'default',
              }}
            >Load</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PluginCatalog({ catalog, loadingPlugin, onLoad }: {
  catalog: CatalogEntry[]; loadingPlugin: string | null; onLoad: (name: string) => void;
}) {
  const categories = [...new Set(catalog.map((p) => p.category))];
  return (
    <div>
      {categories.map((cat) => (
        <div key={cat} style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: CATEGORY_COLORS[cat] ?? tokens.text.muted,
            textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{
              fontSize: 8, fontWeight: 800, padding: '2px 5px', borderRadius: 3,
              backgroundColor: `${CATEGORY_COLORS[cat] ?? '#475569'}20`,
            }}>{CATEGORY_ICONS[cat] ?? cat}</span>
            {cat}
          </div>
          {catalog.filter((p) => p.category === cat).map((plugin) => (
            <div key={plugin.name} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', marginBottom: 4, borderRadius: 8,
              backgroundColor: plugin.isLoaded ? `${tokens.status.completed}08` : tokens.bg.raised,
              border: `1px solid ${plugin.isLoaded ? `${tokens.status.completed}25` : tokens.border.subtle}`,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: tokens.text.primary }}>{plugin.name}</span>
                  {plugin.isLoaded && (
                    <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3, backgroundColor: `${tokens.status.completed}20`, color: tokens.status.completed }}>ACTIVE</span>
                  )}
                  {plugin.requiresInstall && !plugin.isLoaded && (
                    <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3, backgroundColor: `${tokens.status.paused}15`, color: tokens.status.paused }}>
                      NEEDS: {plugin.installHint}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: tokens.text.muted, lineHeight: 1.3 }}>{plugin.description}</div>
                {plugin.isLoaded && plugin.nodeTypes.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
                    {plugin.nodeTypes.map((t) => (
                      <span key={t} style={{
                        fontSize: 9, padding: '1px 5px', borderRadius: 3,
                        backgroundColor: tokens.bg.input, color: tokens.text.accent,
                        fontFamily: tokens.font.mono, border: `1px solid ${tokens.border.subtle}`,
                      }}>{t}</span>
                    ))}
                  </div>
                )}
              </div>
              {!plugin.isLoaded && (
                <button
                  onClick={() => onLoad(plugin.name)}
                  disabled={loadingPlugin === plugin.name}
                  style={{
                    padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5,
                    border: 'none', flexShrink: 0,
                    backgroundColor: loadingPlugin === plugin.name ? tokens.border.default : tokens.status.completed,
                    color: '#fff', cursor: loadingPlugin === plugin.name ? 'default' : 'pointer',
                  }}
                >{loadingPlugin === plugin.name ? '...' : 'Load'}</button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function NodeTypeList({ nodeTypes }: { nodeTypes: NodeTypeInfo[] }) {
  const builtIn = nodeTypes.filter((t) => t.isBuiltIn);
  const plugin = nodeTypes.filter((t) => !t.isBuiltIn);
  const grouped = new Map<string, NodeTypeInfo[]>();
  for (const t of plugin) {
    if (!grouped.has(t.source)) grouped.set(t.source, []);
    grouped.get(t.source)!.push(t);
  }

  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>
        Core ({builtIn.length})
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
      {[...grouped.entries()].map(([source, types]) => (
        <div key={source} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: tokens.text.accent, marginBottom: 6 }}>
            {source} ({types.length} types)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {types.map((t) => (
              <span key={t.type} style={{
                fontSize: 10, padding: '3px 8px', borderRadius: 3,
                backgroundColor: tokens.bg.raised, border: `1px solid ${tokens.border.subtle}`,
                color: tokens.text.secondary, fontFamily: tokens.font.mono,
              }}>{t.type}</span>
            ))}
          </div>
        </div>
      ))}
      {plugin.length === 0 && (
        <div style={{ fontSize: 11, color: tokens.text.muted, fontStyle: 'italic' }}>No plugin node types loaded yet.</div>
      )}
    </div>
  );
}
