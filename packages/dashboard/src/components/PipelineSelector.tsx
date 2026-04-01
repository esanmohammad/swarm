import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import type { PipelineInfo, WsCommand } from '../types';

interface PipelineSelectorProps {
  pipelines: PipelineInfo[];
  activePipeline: string;
  onSwitch: (namespace: string) => void;
  sendCommand: (cmd: WsCommand) => void;
}

const STATUS_DOT: Record<PipelineInfo['status'], string> = {
  running: 'bg-green-500',
  complete: 'bg-green-500',
  error: 'bg-red-500',
  idle: 'bg-stone-500',
};

function formatCost(cost: { totalUsd: number }): string {
  return `$${cost.totalUsd.toFixed(2)}`;
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function PipelineSelector({ pipelines, activePipeline, onSwitch, sendCommand }: PipelineSelectorProps) {
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowCreate(false);
        setConfirmDelete(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setShowCreate(false);
        setConfirmDelete(null);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Focus input when create form shows
  useEffect(() => {
    if (showCreate) inputRef.current?.focus();
  }, [showCreate]);

  const current = pipelines.find(p => p.namespace === activePipeline);
  const displayName = current?.projectName || activePipeline;

  const handleCreate = () => {
    const name = newName.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
    if (!name) return;
    sendCommand({ action: 'create-pipeline', namespace: name });
    setNewName('');
    setShowCreate(false);
    // Refresh pipeline list after short delay
    setTimeout(() => sendCommand({ action: 'list-pipelines' }), 500);
  };

  const handleDelete = (namespace: string) => {
    sendCommand({ action: 'delete-pipeline', namespace });
    setConfirmDelete(null);
    setTimeout(() => sendCommand({ action: 'list-pipelines' }), 500);
  };

  return (
    <div className="relative hidden sm:block" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="font-normal">/ {displayName}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-80 bg-stone-900 border border-stone-700/50 rounded-lg shadow-xl z-50 overflow-hidden">
          {/* Pipeline list */}
          <div className="py-1">
            {pipelines.map((p) => (
              <div
                key={p.namespace}
                className={`flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
                  p.namespace === activePipeline
                    ? 'bg-stone-800/60 text-stone-200'
                    : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/30'
                }`}
              >
                {/* Clickable area for switching */}
                <button
                  onClick={() => {
                    onSwitch(p.namespace);
                    setOpen(false);
                  }}
                  className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                  role="option"
                  aria-selected={p.namespace === activePipeline}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[p.status]}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {p.projectName}
                      {p.namespace !== 'default' && (
                        <span className="text-stone-600 ml-1 font-normal">{p.namespace}</span>
                      )}
                      {p.namespace === 'default' && (
                        <span className="text-stone-600 ml-1 font-normal">(default)</span>
                      )}
                    </div>
                    <div className="text-[10px] text-stone-500 mt-0.5">
                      {p.currentStage} &middot; {formatCost(p.totalCost)} &middot; {formatTime(p.updatedAt)}
                    </div>
                    {p.worktreePath && (
                      <div className="text-[9px] text-stone-600 truncate mt-0.5" title={p.worktreePath}>
                        {p.worktreePath}
                      </div>
                    )}
                  </div>
                </button>

                {/* Delete button (non-default pipelines only) */}
                {p.namespace !== 'default' && (
                  confirmDelete === p.namespace ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleDelete(p.namespace)}
                        className="text-[10px] text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded bg-red-950/50 border border-red-800/30"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="text-[10px] text-stone-500 hover:text-stone-300 px-1 py-0.5"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete(p.namespace);
                      }}
                      className="text-stone-600 hover:text-red-400 transition-colors shrink-0 p-1"
                      title={`Delete pipeline "${p.namespace}"`}
                    >
                      <Trash2 size={11} />
                    </button>
                  )
                )}
              </div>
            ))}
          </div>

          {/* Divider + Create new pipeline */}
          <div className="border-t border-stone-700/50">
            {showCreate ? (
              <form
                onSubmit={(e) => { e.preventDefault(); handleCreate(); }}
                className="flex items-center gap-2 px-3 py-2"
              >
                <input
                  ref={inputRef}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="pipeline-name"
                  className="flex-1 bg-stone-800 border border-stone-700/50 rounded px-2 py-1 text-xs text-stone-200 placeholder-stone-600 focus:outline-none focus:border-blue-500/50"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!newName.trim()}
                  className="text-xs text-blue-400 hover:text-blue-300 disabled:text-stone-600 px-2 py-1 rounded hover:bg-stone-800/50 transition-colors"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setNewName(''); }}
                  className="text-xs text-stone-500 hover:text-stone-300 px-1 py-1"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button
                onClick={() => setShowCreate(true)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-stone-500 hover:text-stone-300 hover:bg-stone-800/30 transition-colors"
              >
                <Plus size={12} />
                New pipeline
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
