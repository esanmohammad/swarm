import { AlertTriangle, XOctagon } from 'lucide-react';
import type { GuardrailViolation } from '../types';

export function GuardrailAlerts({ violations }: { violations: GuardrailViolation[] }) {
  if (violations.length === 0) return null;

  const errors = violations.filter((v) => v.severity === 'error');
  const warnings = violations.filter((v) => v.severity === 'warning');

  return (
    <div className="p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
        <AlertTriangle size={14} className="text-amber-400" />
        Guardrails ({errors.length} errors, {warnings.length} warnings)
      </h3>

      <div className="space-y-2 max-h-48 overflow-y-auto">
        {violations.map((v, i) => (
          <div
            key={i}
            className={`p-2 rounded text-xs ${
              v.severity === 'error'
                ? 'bg-red-950/50 border border-red-800'
                : 'bg-yellow-950/50 border border-yellow-800'
            }`}
          >
            <div className="flex items-center gap-1.5 mb-1">
              {v.severity === 'error' ? (
                <XOctagon size={12} className="text-red-400" />
              ) : (
                <AlertTriangle size={12} className="text-yellow-400" />
              )}
              <span className={v.severity === 'error' ? 'text-red-300' : 'text-yellow-300'}>
                {v.message}
              </span>
            </div>
            <div className="text-gray-600 pl-4">
              {v.file.split('/').pop()} &middot; {v.rule}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
