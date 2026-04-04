import { useState } from 'react';
import { AlertTriangle, DollarSign, Plus, X } from 'lucide-react';
import type { WsCommand } from '../types';

interface BudgetDialogProps {
  spent: number;
  budget: number;
  message: string;
  sendCommand: (cmd: WsCommand) => void;
  onDismiss: () => void;
}

const INCREASE_OPTIONS = [5, 10, 25, 50];

export function BudgetDialog({ spent, budget, sendCommand, onDismiss }: BudgetDialogProps) {
  const [customAmount, setCustomAmount] = useState('');

  const handleIncrease = (amount: number) => {
    sendCommand({ action: 'increase-budget', amount });
    onDismiss();
  };

  const handleDecline = () => {
    sendCommand({ action: 'decline-budget' });
    onDismiss();
  };

  return (
    <>
      <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-md rounded-xl shadow-2xl overflow-hidden"
          style={{ backgroundColor: 'var(--bg-raised)', border: '1px solid var(--border-default)' }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-3 px-5 py-4"
            style={{ backgroundColor: 'var(--status-warning-bg)', borderBottom: '1px solid var(--border-muted)' }}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: 'var(--bg-overlay)' }}
            >
              <AlertTriangle size={16} style={{ color: 'var(--status-warning)' }} />
            </div>
            <div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Budget Limit Reached
              </h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                Agents are paused. Increase the budget to continue.
              </p>
            </div>
          </div>

          {/* Cost summary */}
          <div className="px-5 py-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign size={14} style={{ color: 'var(--text-tertiary)' }} />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Spent</span>
              </div>
              <span className="text-sm font-semibold font-code tabular-nums" style={{ color: 'var(--status-error)' }}>
                ${spent.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Budget limit</span>
              <span className="text-sm font-code tabular-nums" style={{ color: 'var(--text-primary)' }}>
                ${budget.toFixed(2)}
              </span>
            </div>

            {/* Progress bar */}
            <div className="h-2 rounded-full" style={{ backgroundColor: 'var(--bg-inset)' }}>
              <div
                className="h-full rounded-full"
                style={{ width: '100%', backgroundColor: 'var(--status-error)' }}
              />
            </div>

            {/* Quick increase buttons */}
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--text-tertiary)' }}>
                Add to budget
              </div>
              <div className="grid grid-cols-4 gap-2">
                {INCREASE_OPTIONS.map((amount) => (
                  <button
                    key={amount}
                    onClick={() => handleIncrease(amount)}
                    className="flex items-center justify-center gap-1 py-2 rounded-md text-xs font-medium transition-colors"
                    style={{ backgroundColor: 'var(--bg-overlay)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-muted)'; e.currentTarget.style.color = 'var(--accent)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-overlay)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                  >
                    <Plus size={10} />
                    ${amount}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom amount */}
            <div className="flex items-center gap-2">
              <span className="text-xs shrink-0" style={{ color: 'var(--text-tertiary)' }}>Custom:</span>
              <div className="flex items-center gap-1 flex-1">
                <span className="text-xs" style={{ color: 'var(--text-disabled)' }}>$</span>
                <input
                  type="number"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customAmount) {
                      handleIncrease(parseFloat(customAmount));
                    }
                  }}
                  placeholder="0.00"
                  min="0.01"
                  step="0.01"
                  className="flex-1 bg-transparent text-xs font-code focus:outline-none"
                  style={{ color: 'var(--text-primary)' }}
                />
              </div>
              <button
                onClick={() => customAmount && handleIncrease(parseFloat(customAmount))}
                disabled={!customAmount || parseFloat(customAmount) <= 0}
                className="px-3 py-1 rounded text-xs font-medium transition-colors disabled:opacity-30"
                style={{ backgroundColor: 'var(--accent-emphasis)', color: '#fff' }}
              >
                Add
              </button>
            </div>
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-between px-5 py-3"
            style={{ borderTop: '1px solid var(--border-muted)' }}
          >
            <button
              onClick={handleDecline}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={{ backgroundColor: 'var(--status-error-bg)', color: 'var(--status-error)', border: '1px solid var(--border-muted)' }}
            >
              <X size={10} />
              Stop All Agents
            </button>
            <span className="text-[10px]" style={{ color: 'var(--text-disabled)' }}>
              Agents are paused, not stopped
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
