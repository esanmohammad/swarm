import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import type { PipelineInfo } from '../types';

interface PipelineSelectorProps {
  pipelines: PipelineInfo[];
  activePipeline: string;
  onSwitch: (namespace: string) => void;
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

export function PipelineSelector({ pipelines, activePipeline, onSwitch }: PipelineSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const current = pipelines.find(p => p.namespace === activePipeline);
  const displayName = current?.projectName || activePipeline;

  if (pipelines.length <= 1 && !open) {
    // Single pipeline — just show the name without dropdown
    return (
      <span className="text-blue-400 font-normal text-sm hidden sm:inline">
        / {displayName}
      </span>
    );
  }

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
        <div className="absolute top-full left-0 mt-1 w-72 bg-stone-900 border border-stone-700/50 rounded-lg shadow-xl z-50 py-1 overflow-hidden">
          {pipelines.map((p) => (
            <button
              key={p.namespace}
              onClick={() => {
                onSwitch(p.namespace);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors ${
                p.namespace === activePipeline
                  ? 'bg-stone-800/60 text-stone-200'
                  : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/30'
              }`}
              role="option"
              aria-selected={p.namespace === activePipeline}
            >
              {/* Status dot */}
              <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[p.status]}`} />

              {/* Name + details */}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">
                  {p.projectName}
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
          ))}
        </div>
      )}
    </div>
  );
}
