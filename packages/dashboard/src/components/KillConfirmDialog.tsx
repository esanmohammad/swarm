import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { Agent } from '../types';

interface KillConfirmDialogProps {
  agent: Agent;
  onConfirm: () => void;
  onCancel: () => void;
}

export function KillConfirmDialog({ agent, onConfirm, onCancel }: KillConfirmDialogProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={onCancel}>
      <div
        className="bg-[#0e0c0b] rounded border border-stone-800/60 w-full max-w-sm font-mono"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800/50">
          <span className="text-xs text-red-500">
            <span className="text-red-600">$</span> kill --signal SIGTERM
          </span>
          <button onClick={onCancel} className="text-stone-600 hover:text-stone-400 transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="p-4">
          <p className="text-xs text-stone-400 mb-1">
            terminate process <span className="text-stone-200 font-medium">{agent.name}</span>?
          </p>
          <p className="text-[10px] text-stone-600 mb-5">
            in-progress work will be lost.
          </p>

          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 py-1.5 bg-stone-900/40 hover:bg-stone-800/40 border border-stone-800/50 rounded text-xs text-stone-400 transition-colors"
            >
              cancel
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 py-1.5 bg-red-950/40 hover:bg-red-900/40 border border-red-900/40 rounded text-xs text-red-400 font-medium transition-colors"
            >
              kill -9
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
