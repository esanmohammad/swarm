import { useState, useEffect } from 'react';
import {
  Trash2,
  Play,
  Wrench,
  BarChart3,
  ChevronDown,
  ChevronUp,
  CheckCircle,
} from 'lucide-react';
import type { WsCommand } from '../types';

interface DebtItem {
  id: string;
  type: 'code-quality' | 'architecture' | 'dependency' | 'test' | 'documentation';
  severity: number;
  file: string;
  description: string;
  estimatedEffort: string;
  autoFixable: boolean;
  age: number;
}

interface DebtData {
  score: number;
  trend: 'improving' | 'degrading' | 'stable';
  items: DebtItem[];
  burndown: Array<{
    date: string;
    score: number;
  }>;
  byType: Array<{ type: string; count: number; totalSeverity: number }>;
}

interface DebtViewProps {
  sendCommand: (cmd: WsCommand) => void;
  debtData: DebtData | null;
}

function SeverityBadge({ severity }: { severity: number }) {
  const label = severity >= 8 ? 'critical' : severity >= 5 ? 'high' : severity >= 3 ? 'medium' : 'low';
  const styles: Record<string, string> = {
    critical: 'bg-red-500/20 text-red-300 border-red-500/30',
    high: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
    medium: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    low: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium border ${styles[label]}`}>
      {label.toUpperCase()} ({severity})
    </span>
  );
}

function ScoreGauge({ score }: { score: number }) {
  const color = score < 30 ? 'text-red-400' : score < 60 ? 'text-amber-400' : 'text-emerald-400';
  const barColor = score < 30 ? 'bg-red-500' : score < 60 ? 'bg-amber-500' : 'bg-emerald-500';
  const label = score < 30 ? 'Poor' : score < 60 ? 'Fair' : 'Good';
  return (
    <div className="p-4 rounded-lg bg-stone-800/40 border border-stone-700/40 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-stone-500 uppercase tracking-wider">Debt Score</span>
        <span className={`text-sm font-bold ${color}`}>{score}/100 — {label}</span>
      </div>
      <div className="w-full h-3 bg-stone-700 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

export function DebtView({ sendCommand, debtData }: DebtViewProps) {
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    sendCommand({ action: 'get-debt' } as WsCommand);
  }, []);

  const handleFix = (itemId: string) => {
    sendCommand({ action: 'run-debt-fix', itemId } as WsCommand);
  };

  if (!debtData) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Trash2 size={36} className="text-stone-600 mx-auto mb-3" />
          <p className="text-sm text-stone-400">Loading tech debt data...</p>
        </div>
      </div>
    );
  }

  const { score, items, burndown } = debtData;

  const sorted = [...items].sort((a, b) => {
    const diff = b.severity - a.severity;
    return sortAsc ? -diff : diff;
  });

  const maxBurndown = Math.max(...burndown.map(b => b.score), 1);

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trash2 size={18} className="text-rose-400" />
            <h2 className="text-lg font-semibold text-stone-200">Tech Debt</h2>
            <span className="text-xs text-stone-500 ml-2">{items.length} items</span>
          </div>
          <button
            onClick={() => sendCommand({ action: 'run-debt-scan' } as WsCommand)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-rose-600/20 text-rose-300 border border-rose-500/30 hover:bg-rose-600/30 transition-colors"
          >
            <Play size={12} />
            Scan
          </button>
        </div>

        {/* Score gauge */}
        <ScoreGauge score={score} />

        {/* Burndown chart (simple bars) */}
        {burndown.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <BarChart3 size={14} className="text-amber-400" />
              <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Burndown</h3>
            </div>
            <div className="p-4 rounded-lg bg-stone-800/40 border border-stone-700/40">
              <div className="flex items-end gap-1 h-24">
                {burndown.map((b, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full bg-rose-500/60 rounded-t transition-all"
                      style={{ height: `${(b.score / maxBurndown) * 100}%` }}
                    />
                    <span className="text-[8px] text-stone-600 truncate w-full text-center">{b.date}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Items table */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Debt Items</h3>
            <button
              onClick={() => setSortAsc(!sortAsc)}
              className="flex items-center gap-1 text-[10px] text-stone-500 hover:text-stone-400 transition-colors"
            >
              Severity {sortAsc ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </button>
          </div>

          {sorted.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle size={28} className="text-emerald-600 mx-auto mb-2" />
              <p className="text-xs text-stone-500">No debt items found. Clean codebase!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sorted.map(item => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-3 bg-stone-800/40 rounded-lg border border-stone-700/40"
                >
                  <SeverityBadge severity={item.severity} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-stone-300 truncate">{item.description}</p>
                    <p className="text-[10px] text-stone-500 truncate">{item.file}</p>
                  </div>
                  <span className="text-[10px] text-stone-500 shrink-0">{item.estimatedEffort}</span>
                  {item.autoFixable && (
                    <button
                      onClick={() => handleFix(item.id)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 transition-colors shrink-0"
                    >
                      <Wrench size={10} />
                      Fix Now
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
