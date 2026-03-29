import { AlertTriangle, XOctagon } from 'lucide-react';
import type { GuardrailViolation } from '../types';

export function GuardrailAlerts({ violations }: { violations: GuardrailViolation[] }) {
  if (violations.length === 0) return null;

  const errors = violations.filter((v) => v.severity === 'error');
  const warnings = violations.filter((v) => v.severity === 'warning');

  return (
    <div className="p-4 space-y-3">
      <h3 className="text-[11px] font-semibold text-stone-600 uppercase tracking-widest flex items-center gap-2">
        <AlertTriangle size={13} className="text-amber-700" />
        Guardrails ({errors.length} errors, {warnings.length} warnings)
      </h3>

      <div className="space-y-2 max-h-48 overflow-y-auto">
        {violations.map((v, i) => (
          <div
            key={i}
            className={`p-2.5 rounded text-xs ${
              v.severity === 'error'
                ? 'bg-red-950/20 border border-red-900/30'
                : 'bg-amber-950/15 border border-amber-900/25'
            }`}
          >
            <div className="flex items-center gap-1.5 mb-1">
              {v.severity === 'error' ? (
                <XOctagon size={11} className="text-red-600" />
              ) : (
                <AlertTriangle size={11} className="text-amber-600" />
              )}
              <span className={v.severity === 'error' ? 'text-red-400' : 'text-amber-500'}>
                {v.message}
              </span>
            </div>
            <div className="text-stone-400 pl-4 text-[10px]">
              {v.file.split('/').pop()} &middot; {v.rule}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
