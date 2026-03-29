import { AlertTriangle, X } from 'lucide-react';
import type { Agent } from '../types';

interface KillConfirmDialogProps {
  agent: Agent;
  onConfirm: () => void;
  onCancel: () => void;
}

export function KillConfirmDialog({ agent, onConfirm, onCancel }: KillConfirmDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-gray-900 rounded-xl border border-gray-700 p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-red-400">
            <AlertTriangle size={18} />
            Kill Agent
          </h2>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-gray-300 mb-2">
          Are you sure you want to kill <span className="font-semibold text-white">{agent.name}</span>?
        </p>
        <p className="text-xs text-gray-500 mb-6">
          This will send SIGTERM to the Claude process. Any in-progress work will be lost.
        </p>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium transition-colors"
          >
            Kill Agent
          </button>
        </div>
      </div>
    </div>
  );
}
