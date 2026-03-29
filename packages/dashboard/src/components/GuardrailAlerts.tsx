import { AlertTriangle, XOctagon } from 'lucide-react';
import type { GuardrailViolation } from '../types';

export function GuardrailAlerts({ violations }: { violations: GuardrailViolation[] }) {
  if (violations.length === 0) return null;

  const errors = violations.filter((v) => v.severity === 'error');
  const warnings = violations.filter((v) => v.severity === 'warning');

  return (
    <div className="px-4 py-3 font-mono">
      <div className="text-[10px] text-stone-500 mb-2 tracking-wider uppercase">
        guardrails <span className="text-stone-600">({errors.length} err, {warnings.length} warn)</span>
      </div>

      <div className="space-y-1 max-h-40 overflow-y-auto">
        {violations.map((v, i) => (
          <div
            key={i}
            className={`flex items-start gap-2 px-2.5 py-1.5 rounded text-xs ${
              v.severity === 'error'
                ? 'bg-red-950/20 border border-red-900/20'
                : 'bg-amber-950/15 border border-amber-900/20'
            }`}
          >
            {v.severity === 'error' ? (
              <XOctagon size={10} className="text-red-500 mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle size={10} className="text-amber-500 mt-0.5 shrink-0" />
            )}
            <div className="min-w-0">
              <span className={v.severity === 'error' ? 'text-red-400' : 'text-amber-400'}>
                {v.message}
              </span>
              <span className="text-stone-600 ml-2 text-[10px]">
                {v.file.split('/').pop()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
