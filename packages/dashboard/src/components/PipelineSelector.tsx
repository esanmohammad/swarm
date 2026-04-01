import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus, Trash2, GitBranch } from 'lucide-react';
import type { PipelineInfo, WsCommand } from '../types';

interface PipelineSelectorProps {
  pipelines: PipelineInfo[];
  activePipeline: string;
  onSwitch: (namespace: string) => void;
  sendCommand: (cmd: WsCommand) => void;
}

const STATUS_COLOR: Record<PipelineInfo['status'], string> = {
  running: 'bg-green-500',
  complete: 'bg-green-500',
  error: 'bg-red-500',
  idle: 'bg-stone-500',
};

const STATUS_RING: Record<PipelineInfo['status'], string> = {
  running: 'ring-green-500/20',
  complete: 'ring-green-500/20',
  error: 'ring-red-500/20',
  idle: 'ring-stone-500/20',
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

  useEffect(() => {
    if (showCreate) inputRef.current?.focus();
  }, [showCreate]);

  const current = pipelines.find(p => p.namespace === activePipeline);
  const displayName = current
    ? (current.namespace === 'default' ? current.projectName : current.namespace)
    : activePipeline;
  const currentStatus = current?.status ?? 'idle';

  const handleCreate = () => {
    const name = newName.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
    if (!name) return;
    sendCommand({ action: 'create-pipeline', namespace: name });
    setNewName('');
    setShowCreate(false);
    setTimeout(() => sendCommand({ action: 'list-pipelines' }), 500);
  };

  const handleDelete = (namespace: string) => {
    sendCommand({ action: 'delete-pipeline', namespace });
    setConfirmDelete(null);
    setTimeout(() => sendCommand({ action: 'list-pipelines' }), 500);
  };

  return (
    <div className="relative" ref={ref}>
      {/* Trigger — styled as a distinct bordered pill */}
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
          open
            ? 'bg-stone-800/80 border-stone-600/60 text-stone-200'
            : 'bg-stone-800/40 border-stone-700/40 text-stone-400 hover:text-stone-200 hover:border-stone-600/50 hover:bg-stone-800/60'
        }`}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <GitBranch size={13} className="shrink-0 text-stone-500" />
        {/* Status dot */}
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ring-2 ${STATUS_COLOR[currentStatus]} ${STATUS_RING[currentStatus]}`} />
        <span className="max-w-[140px] truncate">{displayName}</span>
        {pipelines.length > 1 && (
          <span className="text-[10px] text-stone-600 tabular-nums">{pipelines.length}</span>
        )}
        <ChevronDown size={11} className={`shrink-0 text-stone-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-80 bg-stone-900 border border-stone-700/50 rounded-lg shadow-2xl z-50 overflow-hidden">
          {/* Header */}
          <div className="px-3 py-2 border-b border-stone-800/50">
            <span className="text-[10px] font-medium text-stone-500 uppercase tracking-wider">Pipelines</span>
          </div>

          {/* Pipeline list */}
          <div className="py-0.5 max-h-64 overflow-y-auto">
            {pipelines.map((p) => (
              <div
                key={p.namespace}
                className={`group flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                  p.namespace === activePipeline
                    ? 'bg-blue-950/20 border-l-2 border-l-blue-500'
                    : 'border-l-2 border-l-transparent hover:bg-stone-800/40'
                }`}
              >
                <button
                  onClick={() => {
                    onSwitch(p.namespace);
                    setOpen(false);
                  }}
                  className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                  role="option"
                  aria-selected={p.namespace === activePipeline}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLOR[p.status]}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium truncate ${p.namespace === activePipeline ? 'text-stone-200' : 'text-stone-400'}`}>
                      {p.namespace === 'default' ? p.projectName : p.namespace}
                      {p.namespace === 'default' && (
                        <span className="text-stone-600 ml-1.5 font-normal text-[10px]">default</span>
                      )}
                    </div>
                    <div className="text-[10px] text-stone-500 mt-0.5 flex items-center gap-1.5">
                      <span>{p.currentStage}</span>
                      <span className="text-stone-700">&middot;</span>
                      <span>{formatCost(p.totalCost)}</span>
                      <span className="text-stone-700">&middot;</span>
                      <span>{formatTime(p.updatedAt)}</span>
                    </div>
                  </div>
                </button>

                {p.namespace !== 'default' && (
                  confirmDelete === p.namespace ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleDelete(p.namespace)}
                        className="text-[10px] text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded bg-red-950/50 border border-red-800/30"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="text-[10px] text-stone-500 hover:text-stone-300 px-1"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete(p.namespace);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-stone-600 hover:text-red-400 transition-all shrink-0 p-1 rounded hover:bg-stone-800/50"
                      title={`Delete "${p.namespace}"`}
                    >
                      <Trash2 size={11} />
                    </button>
                  )
                )}
              </div>
            ))}
          </div>

          {/* Create */}
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
                  className="flex-1 bg-stone-800 border border-stone-700/50 rounded-md px-2 py-1 text-xs text-stone-200 placeholder-stone-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!newName.trim()}
                  className="text-xs text-blue-400 hover:text-blue-300 disabled:text-stone-600 disabled:cursor-not-allowed px-2.5 py-1 rounded-md bg-blue-500/10 hover:bg-blue-500/20 disabled:bg-transparent transition-colors"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setNewName(''); }}
                  className="text-xs text-stone-500 hover:text-stone-300 px-1.5 py-1"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button
                onClick={() => setShowCreate(true)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-stone-500 hover:text-stone-300 hover:bg-stone-800/30 transition-colors"
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
