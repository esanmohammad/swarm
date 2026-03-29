import { Skull, X } from 'lucide-react';
import type { Agent } from '../types';

interface KillConfirmDialogProps {
  agent: Agent;
  onConfirm: () => void;
  onCancel: () => void;
}

export function KillConfirmDialog({ agent, onConfirm, onCancel }: KillConfirmDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-[#0e0e0e] rounded-xl border border-stone-800/40 p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold flex items-center gap-2 text-red-500 tracking-wide">
            <Skull size={18} />
            Kill Agent
          </h2>
          <button onClick={onCancel} className="text-stone-400 hover:text-stone-400">
            <X size={16} />
          </button>
        </div>

        <p className="text-sm text-stone-400 mb-2">
          Terminate <span className="font-semibold text-stone-200">{agent.name}</span>?
        </p>
        <p className="text-[10px] text-stone-400 mb-6">
          SIGTERM will be sent. In-progress work will be lost.
        </p>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2 bg-[#111] hover:bg-stone-900 border border-stone-800/40 rounded-lg text-sm font-medium text-stone-400 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2 bg-red-900/40 hover:bg-red-800/50 border border-red-800/30 rounded-lg text-sm font-semibold text-red-400 transition-colors"
          >
            Kill
          </button>
        </div>
      </div>
    </div>
  );
}
