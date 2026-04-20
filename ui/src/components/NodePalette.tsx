import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { tokens } from './ui/styles';
import { listNodeTypes } from '../api/client';
import { getNodeMetadata, ALL_CATEGORIES, type NodeCategory, type NodeMetadata } from './nodeMetadata';

/**
 * Dynamic node palette.
 *
 * Hits /api/node-types on mount to discover every type the server has
 * registered — built-ins plus whatever the loaded plugins contribute.
 * Each type is decorated with metadata from the catalog (label, icon,
 * color, category); unknown types fall back to a generic entry so we
 * still render every available type with something draggable.
 *
 * Search filters across label, description, type id, and service name
 * so users can find a node by whatever they remember. Categories
 * collapse to keep the list manageable when all 100+ nodes are loaded.
 */

export function NodePalette() {
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<NodeMetadata[] | null>(null);
  const [openCats, setOpenCats] = useState<Set<NodeCategory>>(() => new Set(['Core', 'AI']));
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    listNodeTypes()
      .then((list) => setTypes(list.map((t) => getNodeMetadata(t.type))))
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);

  const filtered = useMemo(() => {
    if (!types) return null;
    const q = query.trim().toLowerCase();
    if (!q) return types;
    return types.filter(
      (m) =>
        m.type.toLowerCase().includes(q) ||
        m.label.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        (m.service?.toLowerCase().includes(q) ?? false),
    );
  }, [types, query]);

  const grouped = useMemo(() => {
    if (!filtered) return null;
    const map = new Map<NodeCategory, NodeMetadata[]>();
    for (const m of filtered) {
      const list = map.get(m.category) ?? [];
      list.push(m);
      map.set(m.category, list);
    }
    return map;
  }, [filtered]);

  const onDragStart = (e: DragEvent, type: string) => {
    e.dataTransfer.setData('application/workflow-node-type', type);
    e.dataTransfer.effectAllowed = 'move';
  };

  if (collapsed) {
    return (
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${tokens.border.subtle}` }}>
        <button
          onClick={() => setCollapsed(false)}
          style={{
            width: '100%', padding: '6px', fontSize: 11, fontWeight: 600,
            backgroundColor: 'transparent', border: `1px dashed ${tokens.border.default}`,
            color: tokens.text.muted, cursor: 'pointer', borderRadius: 4,
          }}
        >
          + Show Node Palette
        </button>
      </div>
    );
  }

  // When the user types a query, auto-expand every category that still has
  // hits so they can see all matches without a second click. When the query
  // clears, fall back to whatever categories were open before.
  const isSearching = query.trim().length > 0;

  return (
    <div data-tutorial="node-palette" style={{ padding: '10px 12px', flex: 1, overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, color: tokens.text.muted,
          textTransform: 'uppercase', letterSpacing: '1px',
        }}>
          Nodes {types && <span style={{ color: tokens.text.secondary, fontWeight: 500 }}>({types.length})</span>}
        </span>
        <button
          onClick={() => setCollapsed(true)}
          style={{ background: 'none', border: 'none', color: tokens.text.muted, cursor: 'pointer', fontSize: 10 }}
        >
          collapse
        </button>
      </div>

      <input
        type="text"
        placeholder="Search nodes…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          width: '100%',
          padding: '6px 8px',
          fontSize: 11,
          backgroundColor: tokens.bg.input,
          border: `1px solid ${tokens.border.subtle}`,
          borderRadius: 5,
          color: tokens.text.primary,
          outline: 'none',
          marginBottom: 10,
          boxSizing: 'border-box',
        }}
      />

      {loadError && (
        <div style={{
          padding: 8, borderRadius: 5, fontSize: 10,
          background: '#7f1d1d40', border: '1px solid #b91c1c',
          color: '#fecaca', marginBottom: 8,
        }}>{loadError}</div>
      )}

      {!types && !loadError && (
        <div style={{ color: tokens.text.muted, fontSize: 11 }}>Loading node types…</div>
      )}

      {grouped && grouped.size === 0 && (
        <div style={{ color: tokens.text.muted, fontSize: 11, padding: '10px 0' }}>
          No nodes match "{query}".
        </div>
      )}

      {grouped &&
        ALL_CATEGORIES.map((category) => {
          const nodes = grouped.get(category);
          if (!nodes || nodes.length === 0) return null;
          const isOpen = isSearching || openCats.has(category);
          return (
            <div key={category} style={{ marginBottom: 10 }}>
              <button
                onClick={() => {
                  if (isSearching) return; // collapsing disabled while searching
                  setOpenCats((prev) => {
                    const next = new Set(prev);
                    if (next.has(category)) next.delete(category);
                    else next.add(category);
                    return next;
                  });
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '4px 2px',
                  background: 'none',
                  border: 'none',
                  borderBottom: `1px solid ${tokens.border.subtle}`,
                  cursor: isSearching ? 'default' : 'pointer',
                  marginBottom: 5,
                }}
              >
                <span style={{
                  fontSize: 9, fontWeight: 700, color: tokens.text.muted,
                  textTransform: 'uppercase', letterSpacing: '1.5px',
                }}>
                  {category}
                </span>
                <span style={{ fontSize: 10, color: tokens.text.muted, display: 'flex', gap: 6 }}>
                  <span style={{ opacity: 0.7 }}>{nodes.length}</span>
                  {!isSearching && <span>{isOpen ? '▾' : '▸'}</span>}
                </span>
              </button>
              {isOpen && nodes.map((node) => (
                <div
                  key={node.type}
                  draggable
                  onDragStart={(e) => onDragStart(e, node.type)}
                  style={{
                    padding: '6px 8px',
                    marginBottom: 3,
                    borderRadius: 5,
                    border: `1px solid ${node.color}30`,
                    backgroundColor: `${node.color}08`,
                    cursor: 'grab',
                    transition: 'background-color 0.15s, border-color 0.15s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = `${node.color}18`;
                    (e.currentTarget as HTMLElement).style.borderColor = `${node.color}50`;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = `${node.color}08`;
                    (e.currentTarget as HTMLElement).style.borderColor = `${node.color}30`;
                  }}
                  title={node.description}
                >
                  <div style={{
                    width: 26, height: 26, borderRadius: 4,
                    backgroundColor: `${node.color}20`, border: `1px solid ${node.color}40`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 8, fontWeight: 800, color: node.color,
                    fontFamily: tokens.font.mono, flexShrink: 0,
                    whiteSpace: 'nowrap', overflow: 'hidden',
                  }}>
                    {node.icon}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontSize: 11, fontWeight: 600, color: tokens.text.primary, lineHeight: 1.2,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {node.label}
                    </div>
                    <div style={{
                      fontSize: 9, color: tokens.text.muted, lineHeight: 1.3,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {node.description}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
        })}

      <div style={{
        marginTop: 8, padding: 8, borderRadius: 5,
        backgroundColor: `${tokens.border.subtle}50`,
        fontSize: 9, color: tokens.text.muted, lineHeight: 1.5,
      }}>
        Drag any node onto the canvas to add it. Connect nodes by dragging from one handle to another.
      </div>
    </div>
  );
}
