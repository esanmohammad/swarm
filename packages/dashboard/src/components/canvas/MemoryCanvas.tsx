import { useState, useEffect } from 'react';
import { Brain, Trash2, Search, Plus, X, Tag } from 'lucide-react';
import type { WsCommand } from '../../types';

interface MemoryEntry {
  id: string;
  kind: string;
  content: string;
  createdAt: string;
  expiresAt: string;
  confidence: number;
  source: string;
  tags: string[];
}

interface MemoryCanvasProps {
  memories: MemoryEntry[];
  sendCommand: (cmd: WsCommand) => void;
}

const KIND_COLORS: Record<string, string> = {
  fact: 'var(--accent)',
  preference: 'var(--activity-pipeline)',
  pattern: 'var(--status-success)',
  context: 'var(--status-warning)',
  manual: 'var(--activity-refactor)',
};

const KIND_OPTIONS = ['manual', 'fact', 'preference', 'pattern', 'context'];

export function MemoryCanvas({ memories, sendCommand }: MemoryCanvasProps) {
  const [filter, setFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [newKind, setNewKind] = useState('manual');
  const [newTags, setNewTags] = useState('');
  const [filterKind, setFilterKind] = useState<string | null>(null);

  useEffect(() => {
    sendCommand({ action: 'get-memories' });
  }, [sendCommand]);

  const filtered = memories.filter((m) => {
    if (filterKind && m.kind !== filterKind) return false;
    if (filter) {
      const q = filter.toLowerCase();
      return m.content.toLowerCase().includes(q) ||
        m.kind.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q));
    }
    return true;
  });

  // Count by kind
  const kindCounts = memories.reduce<Record<string, number>>((acc, m) => {
    acc[m.kind] = (acc[m.kind] || 0) + 1;
    return acc;
  }, {});

  const handleAdd = () => {
    if (!newContent.trim()) return;
    const tags = newTags.split(',').map((t) => t.trim()).filter(Boolean);
    sendCommand({ action: 'add-memory', content: newContent.trim(), kind: newKind, tags });
    setNewContent('');
    setNewTags('');
    setShowAdd(false);
  };

  const handleRemove = (id: string) => {
    sendCommand({ action: 'remove-memory', id });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 shrink-0"
        style={{ backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-muted)' }}
      >
        <div className="flex items-center gap-2">
          <Brain size={14} style={{ color: 'var(--text-secondary)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Project Memory</span>
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{memories.length} entries</span>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors"
          style={{
            backgroundColor: showAdd ? 'var(--status-error-bg)' : 'var(--accent-muted)',
            color: showAdd ? 'var(--status-error)' : 'var(--accent)',
          }}
        >
          {showAdd ? <X size={11} /> : <Plus size={11} />}
          {showAdd ? 'Cancel' : 'Add Memory'}
        </button>
      </div>

      {/* Add memory form */}
      {showAdd && (
        <div
          className="px-4 py-3 space-y-3"
          style={{ backgroundColor: 'var(--bg-raised)', borderBottom: '1px solid var(--border-muted)' }}
        >
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="What should Hivemind remember? e.g. 'Always use TypeScript strict mode in this project'"
            rows={3}
            className="w-full px-3 py-2 rounded-md text-sm bg-transparent resize-none focus:outline-none"
            style={{ color: 'var(--text-primary)', border: '1px solid var(--border-default)', backgroundColor: 'var(--bg-overlay)' }}
            autoFocus
          />
          <div className="flex items-center gap-3">
            {/* Kind selector */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Kind:</span>
              {KIND_OPTIONS.map((kind) => (
                <button
                  key={kind}
                  onClick={() => setNewKind(kind)}
                  className="px-2 py-0.5 rounded text-[10px] font-medium capitalize transition-colors"
                  style={{
                    backgroundColor: newKind === kind ? 'var(--bg-emphasis)' : 'transparent',
                    color: newKind === kind ? (KIND_COLORS[kind] || 'var(--text-primary)') : 'var(--text-disabled)',
                    border: newKind === kind ? '1px solid var(--border-default)' : '1px solid transparent',
                  }}
                >
                  {kind}
                </button>
              ))}
            </div>
            {/* Tags input */}
            <div className="flex items-center gap-1 flex-1">
              <Tag size={10} style={{ color: 'var(--text-disabled)' }} />
              <input
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                placeholder="tags (comma-separated)"
                className="flex-1 bg-transparent text-xs focus:outline-none"
                style={{ color: 'var(--text-primary)' }}
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={!newContent.trim()}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-all disabled:opacity-30"
              style={{ backgroundColor: 'var(--accent-emphasis)', color: '#fff' }}
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* Search + filter */}
      <div
        className="flex items-center gap-2 px-4 py-2"
        style={{ borderBottom: '1px solid var(--border-muted)' }}
      >
        <Search size={12} style={{ color: 'var(--text-tertiary)' }} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter memories..."
          className="flex-1 bg-transparent text-xs focus:outline-none"
          style={{ color: 'var(--text-primary)' }}
        />
        {filter && (
          <button onClick={() => setFilter('')} style={{ color: 'var(--text-tertiary)' }}>
            <X size={11} />
          </button>
        )}
      </div>

      {/* Kind filter pills */}
      {Object.keys(kindCounts).length > 1 && (
        <div
          className="flex items-center gap-1 px-4 py-1.5 overflow-x-auto"
          style={{ borderBottom: '1px solid var(--border-muted)' }}
        >
          <button
            onClick={() => setFilterKind(null)}
            className="px-2 py-0.5 rounded text-[10px] font-medium transition-colors whitespace-nowrap"
            style={{
              backgroundColor: !filterKind ? 'var(--bg-emphasis)' : 'transparent',
              color: !filterKind ? 'var(--text-primary)' : 'var(--text-disabled)',
            }}
          >
            All ({memories.length})
          </button>
          {Object.entries(kindCounts).map(([kind, count]) => (
            <button
              key={kind}
              onClick={() => setFilterKind(filterKind === kind ? null : kind)}
              className="px-2 py-0.5 rounded text-[10px] font-medium capitalize transition-colors whitespace-nowrap"
              style={{
                backgroundColor: filterKind === kind ? 'var(--bg-emphasis)' : 'transparent',
                color: filterKind === kind ? (KIND_COLORS[kind] || 'var(--text-primary)') : 'var(--text-disabled)',
              }}
            >
              {kind} ({count})
            </button>
          ))}
        </div>
      )}

      {/* Memory list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full p-6">
            <div className="text-center space-y-4 max-w-sm">
              <Brain size={32} className="mx-auto opacity-15" style={{ color: 'var(--text-tertiary)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                {memories.length === 0 ? 'No memories yet' : 'No matching memories'}
              </p>
              {memories.length === 0 && (
                <>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                    Memories help Hivemind learn from past runs and follow your preferences. They're created automatically when you run <strong>Build Feature</strong> (full pipeline), or you can add them manually.
                  </p>
                  <div className="text-left space-y-1.5 px-4">
                    <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-disabled)' }}>What to add</div>
                    <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      "Always use TypeScript strict mode"
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      "Our API uses snake_case, not camelCase"
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      "Run pytest, not jest — this is a Python project"
                    </p>
                  </div>
                  <button
                    onClick={() => setShowAdd(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-colors"
                    style={{ backgroundColor: 'var(--accent-emphasis)', color: '#fff' }}
                  >
                    <Plus size={12} />
                    Add Your First Memory
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div>
            {filtered.map((mem) => (
              <div
                key={mem.id}
                className="group px-4 py-3 transition-colors"
                style={{ borderBottom: '1px solid var(--border-muted)' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-subtle)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider"
                        style={{
                          backgroundColor: 'var(--bg-subtle)',
                          color: KIND_COLORS[mem.kind] || 'var(--text-secondary)',
                        }}
                      >
                        {mem.kind}
                      </span>
                      {mem.tags.map((tag) => (
                        <span key={tag} className="text-[10px]" style={{ color: 'var(--text-disabled)' }}>
                          #{tag}
                        </span>
                      ))}
                      <span className="text-[10px] ml-auto" style={{ color: 'var(--text-disabled)' }}>
                        {mem.source}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                      {mem.content}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-[10px]" style={{ color: 'var(--text-disabled)' }}>
                        {new Date(mem.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--text-disabled)' }}>
                        confidence {Math.round(mem.confidence)}%
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemove(mem.id)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded transition-all"
                    style={{ color: 'var(--status-error)' }}
                    title="Remove memory"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
