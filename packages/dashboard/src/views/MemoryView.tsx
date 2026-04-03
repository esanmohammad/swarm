import { useState, useEffect } from 'react';
import { Brain, Plus, Trash2, X } from 'lucide-react';
import type { WsCommand } from '../types';
import { FeatureGuide } from '../components/FeatureGuide';
import { StateView } from '../components/StateView';

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

interface MemoryViewProps {
  sendCommand: (cmd: WsCommand) => void;
  memories: MemoryEntry[];
}

const KIND_COLORS: Record<string, string> = {
  'fix-pattern': 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  'flaky-test': 'bg-red-500/15 text-red-300 border-red-500/30',
  'approach': 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  'performance': 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  'manual': 'bg-green-500/15 text-green-300 border-green-500/30',
  'success': 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
};

export function MemoryView({ sendCommand, memories }: MemoryViewProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [filterKind, setFilterKind] = useState<string | null>(null);

  useEffect(() => {
    sendCommand({ action: 'get-memories' } as WsCommand);
  }, []);

  const handleAdd = () => {
    if (!newNote.trim()) return;
    sendCommand({ action: 'add-memory', content: newNote.trim() } as WsCommand);
    setNewNote('');
    setShowAdd(false);
  };

  const handleRemove = (id: string) => {
    sendCommand({ action: 'remove-memory', id } as WsCommand);
  };

  const handleClear = () => {
    if (!confirm('Clear all memories? This cannot be undone.')) return;
    sendCommand({ action: 'clear-memories' } as WsCommand);
  };

  const filtered = filterKind ? memories.filter(m => m.kind === filterKind) : memories;
  const kinds = [...new Set(memories.map(m => m.kind))];

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="max-w-4xl w-full mx-auto flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Brain size={18} className="text-purple-400" />
            <h2 className="text-lg font-semibold text-stone-200">Cross-Run Memory</h2>
            <span className="text-xs text-stone-500">({memories.length} entries)</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-stone-300 bg-stone-800/60 hover:bg-stone-700/60 border border-stone-700/40 transition-colors"
            >
              <Plus size={12} />
              Add Note
            </button>
            {memories.length > 0 && (
              <button
                onClick={handleClear}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-red-400 hover:text-red-300 border border-stone-700/40 hover:border-red-500/30 transition-colors"
              >
                <Trash2 size={12} />
                Clear All
              </button>
            )}
          </div>
        </div>

        <FeatureGuide
          featureId="memory"
          title="Memory"
          description="Cross-run memory allows Swarm to remember context between pipeline runs — decisions, patterns, lessons learned, and project-specific knowledge."
          hasData={memories.length > 0}
          cliCommands={[
            { command: 'swarm memory', description: 'List all stored memories' },
            { command: 'swarm memory add "Always use UTC"', description: 'Add a manual memory note' },
          ]}
        />

        <p className="text-xs text-stone-500 mb-4">
          Memories are recorded automatically after pipeline runs and injected into all agents as context.
          Add manual notes for project-specific knowledge.
        </p>

        {/* Filter pills */}
        {kinds.length > 1 && (
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-[10px] text-stone-500 uppercase tracking-wider">Filter:</span>
            <button
              onClick={() => setFilterKind(null)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                !filterKind ? 'bg-stone-700/50 text-stone-200 border-stone-600/50' : 'text-stone-400 border-stone-800/40 hover:border-stone-700/40'
              }`}
            >
              All
            </button>
            {kinds.map(kind => (
              <button
                key={kind}
                onClick={() => setFilterKind(filterKind === kind ? null : kind)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                  filterKind === kind ? 'bg-stone-700/50 text-stone-200 border-stone-600/50' : 'text-stone-400 border-stone-800/40 hover:border-stone-700/40'
                }`}
              >
                {kind}
              </button>
            ))}
          </div>
        )}

        {/* Add note form */}
        {showAdd && (
          <div className="mb-4 p-3 rounded-lg bg-stone-900/60 border border-stone-700/40 space-y-2">
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="e.g., Tests in auth/ require REDIS_URL env var to pass..."
              rows={2}
              className="w-full px-3 py-2 bg-transparent border border-stone-700/40 rounded text-xs text-stone-300 placeholder-stone-500 focus:border-blue-600 focus:outline-none resize-none"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleAdd}
                disabled={!newNote.trim()}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
              >
                Add Memory
              </button>
              <button
                onClick={() => { setShowAdd(false); setNewNote(''); }}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-stone-400 hover:text-stone-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Memory list */}
        <div className="flex-1 min-h-0 overflow-auto space-y-2">
          {filtered.length === 0 ? (
            <StateView
              status="empty"
              title="No memories stored"
              message="No memories stored yet. Memories are created during pipeline runs or manually via CLI."
              actions={[
                { label: 'Add Note', onClick: () => setShowAdd(true), variant: 'primary' },
              ]}
            />
          ) : (
            filtered.map(entry => (
              <div
                key={entry.id}
                className="p-3 rounded-lg bg-stone-900/40 border border-stone-800/40 hover:border-stone-700/40 transition-colors group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${KIND_COLORS[entry.kind] || 'bg-stone-700/30 text-stone-300 border-stone-600/30'}`}>
                        {entry.kind}
                      </span>
                      <span className={`text-[10px] font-medium ${
                        entry.confidence >= 80 ? 'text-green-400' : entry.confidence >= 50 ? 'text-yellow-400' : 'text-red-400'
                      }`}>
                        {entry.confidence}% conf
                      </span>
                      <span className="text-[10px] text-stone-500">
                        {entry.source}
                      </span>
                    </div>
                    <p className="text-xs text-stone-300 leading-relaxed">{entry.content}</p>
                    {entry.tags.length > 0 && (
                      <div className="flex items-center gap-1 mt-1.5">
                        {entry.tags.slice(0, 5).map(tag => (
                          <span key={tag} className="px-1.5 py-0.5 rounded bg-stone-800/60 text-[9px] text-stone-400">
                            {tag}
                          </span>
                        ))}
                        {entry.tags.length > 5 && (
                          <span className="text-[9px] text-stone-500">+{entry.tags.length - 5}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemove(entry.id)}
                    className="p-1 rounded text-stone-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                    title="Remove memory"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="mt-1.5 text-[9px] text-stone-600">
                  Created: {entry.createdAt.split('T')[0]} | Expires: {entry.expiresAt.split('T')[0]}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
