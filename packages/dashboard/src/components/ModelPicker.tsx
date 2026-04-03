import { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronDown, Search, AlertTriangle } from 'lucide-react';
import type { ModelInfo } from '../types';

interface ModelPickerProps {
  value: string;
  onChange: (model: string) => void;
  models: ModelInfo[];
  minTier?: 1 | 2 | 3;
  className?: string;
}

const TIER_LABELS: Record<number, string> = { 1: 'T1', 2: 'T2', 3: 'T3' };
const TIER_COLORS: Record<number, string> = {
  1: 'bg-stone-700 text-stone-400',
  2: 'bg-amber-900/50 text-amber-400',
  3: 'bg-blue-900/50 text-blue-400',
};

export function ModelPicker({ value, onChange, models, minTier, className = '' }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const grouped = useMemo(() => {
    const groups: Record<string, ModelInfo[]> = {};
    const lowerFilter = filter.toLowerCase();
    for (const m of models) {
      if (lowerFilter && !m.name.toLowerCase().includes(lowerFilter) && !m.provider.toLowerCase().includes(lowerFilter)) continue;
      (groups[m.provider] ??= []).push(m);
    }
    return groups;
  }, [models, filter]);

  const selected = models.find(m => m.id === value || m.fullId === value);
  const formatCtx = (n: number) => n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-xs bg-stone-800/60 border border-stone-700/50 hover:border-stone-600/50 text-stone-300 transition-colors text-left"
      >
        <span className="flex-1 truncate">
          {selected ? selected.name : value || 'Select model...'}
        </span>
        {selected && (
          <span className={`shrink-0 px-1 py-0.5 rounded text-[10px] font-medium ${TIER_COLORS[selected.tier]}`}>
            {TIER_LABELS[selected.tier]}
          </span>
        )}
        <ChevronDown size={12} className={`shrink-0 text-stone-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-lg bg-stone-900 border border-stone-700/60 shadow-xl max-h-72 flex flex-col overflow-hidden">
          {/* Search */}
          <div className="px-2 py-1.5 border-b border-stone-800/60">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-stone-800/60">
              <Search size={11} className="text-stone-500" />
              <input
                autoFocus
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="Filter models..."
                className="flex-1 bg-transparent text-xs text-stone-300 placeholder:text-stone-600 outline-none"
              />
            </div>
          </div>

          {/* Options */}
          <div className="overflow-y-auto flex-1 py-1">
            {Object.keys(grouped).length === 0 && (
              <div className="px-3 py-2 text-xs text-stone-600">No models found</div>
            )}
            {Object.entries(grouped).map(([provider, providerModels]) => (
              <div key={provider}>
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-stone-600">
                  {provider}
                </div>
                {providerModels.map(m => {
                  const disabled = minTier != null && m.tier < minTier;
                  const isSelected = m.id === value || m.fullId === value;
                  return (
                    <button
                      key={m.fullId}
                      onClick={() => {
                        if (!disabled) {
                          onChange(m.id);
                          setOpen(false);
                          setFilter('');
                        }
                      }}
                      disabled={disabled}
                      className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left transition-colors ${
                        isSelected
                          ? 'bg-blue-600/20 text-blue-300'
                          : disabled
                          ? 'text-stone-600 cursor-not-allowed'
                          : 'text-stone-400 hover:bg-stone-800/60 hover:text-stone-300'
                      }`}
                      title={disabled ? `Requires at least Tier ${minTier} model` : undefined}
                    >
                      <span className="flex-1 truncate">{m.name}</span>
                      <span className="text-[10px] text-stone-600 shrink-0">{formatCtx(m.contextWindow)}</span>
                      <span className={`shrink-0 px-1 py-0.5 rounded text-[10px] font-medium ${TIER_COLORS[m.tier]}`}>
                        {TIER_LABELS[m.tier]}
                      </span>
                      {disabled && <AlertTriangle size={10} className="text-stone-600" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
