import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { Agent } from '../types';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface KillConfirmDialogProps {
  agent: Agent;
  onConfirm: () => void;
  onCancel: () => void;
}

export function KillConfirmDialog({ agent, onConfirm, onCancel }: KillConfirmDialogProps) {
  const trapRef = useFocusTrap<HTMLDivElement>();

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
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={onCancel} role="dialog" aria-modal="true" aria-label="Stop Agent">
      <div
        ref={trapRef}
        className="bg-[#0e0c0b] rounded border border-stone-800/60 w-full max-w-sm font-mono mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800/50">
          <span className="text-xs text-red-400 font-medium">
            Stop Agent
          </span>
          <button onClick={onCancel} className="text-stone-600 hover:text-stone-400 transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="p-4">
          <p className="text-xs text-stone-400 mb-1">
            Stop <span className="text-stone-200 font-medium">{agent.name}</span>?
          </p>
          <p className="text-[10px] text-stone-500 mb-5">
            Any in-progress work from this agent will be cancelled.
          </p>

          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 py-1.5 bg-stone-900/40 hover:bg-stone-800/40 border border-stone-800/50 rounded text-xs text-stone-400 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 py-1.5 bg-red-950/40 hover:bg-red-900/40 border border-red-900/40 rounded text-xs text-red-400 font-medium transition-colors"
            >
              Stop Agent
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
