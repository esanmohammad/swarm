import { useState, useEffect } from 'react';
import {
  Layers,
  Plus,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  XCircle,
  User,
  LogOut,
} from 'lucide-react';
import type { WsCommand } from '../types';

interface SurfaceItem {
  name: string;
  description: string;
  paths: string[];
  slos: Array<{ name: string; target: string; current: string; status: 'ok' | 'warning' | 'breach' }>;
  healthScore: number;
  lastChecked: number;
  maintenanceHistory: Array<{ action: string; timestamp: number; cost: number }>;
  budgetUsed: number;
  budgetTotal: number;
}

interface SurfacesState {
  surfaces: SurfaceItem[];
  totalBudget: number;
  totalSpent: number;
}

interface SurfacesViewProps {
  sendCommand: (cmd: WsCommand) => void;
  surfacesState: SurfacesState | null;
}

function HealthIndicator({ score }: { score: number }) {
  if (score >= 80) return <CheckCircle size={14} className="text-emerald-400" />;
  if (score >= 50) return <AlertTriangle size={14} className="text-amber-400" />;
  return <XCircle size={14} className="text-red-400" />;
}

function BudgetBar({ pct }: { pct: number }) {
  const color = pct < 60 ? 'bg-emerald-500' : pct < 85 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-stone-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="text-[10px] text-stone-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

export function SurfacesView({ sendCommand, surfacesState }: SurfacesViewProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  useEffect(() => {
    sendCommand({ action: 'get-surfaces' } as WsCommand);
  }, []);

  const handleOwn = (name: string) => {
    sendCommand({ action: 'own-surface', name } as WsCommand);
  };

  const handleRelease = (name: string) => {
    sendCommand({ action: 'release-surface', name } as WsCommand);
  };

  const handleAdd = () => {
    const name = newName.trim();
    const description = newDesc.trim();
    if (!name) return;
    sendCommand({ action: 'own-surface', name, description } as WsCommand);
    setNewName('');
    setNewDesc('');
    setShowAddForm(false);
  };

  if (!surfacesState) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Layers size={36} className="text-stone-600 mx-auto mb-3" />
          <p className="text-sm text-stone-400">Loading surfaces...</p>
        </div>
      </div>
    );
  }

  const { surfaces, totalBudget, totalSpent } = surfacesState;
  const overallPct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-teal-400" />
            <h2 className="text-lg font-semibold text-stone-200">Surfaces</h2>
            <span className="text-xs text-stone-500 ml-2">{surfaces.length} surfaces</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => sendCommand({ action: 'get-surfaces' } as WsCommand)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-stone-800 text-stone-300 border border-stone-700 hover:bg-stone-700 transition-colors"
            >
              <RefreshCw size={12} />
              Check SLOs
            </button>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-teal-600/20 text-teal-300 border border-teal-500/30 hover:bg-teal-600/30 transition-colors"
            >
              <Plus size={12} />
              Add Surface
            </button>
          </div>
        </div>

        {/* Overall budget */}
        <div className="p-4 rounded-lg bg-stone-800/40 border border-stone-700/40">
          <p className="text-[10px] text-stone-500 uppercase tracking-wider mb-2">Overall Budget Consumption</p>
          <BudgetBar pct={overallPct} />
          <p className="text-[10px] text-stone-500 mt-1">{totalSpent} / {totalBudget} used</p>
        </div>

        {/* Add form */}
        {showAddForm && (
          <div className="p-4 rounded-lg bg-stone-800/40 border border-stone-700/40 space-y-3">
            <h3 className="text-xs font-medium text-stone-300">New Surface</h3>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Surface name..."
              className="w-full px-3 py-2 bg-stone-900/60 border border-stone-700/50 rounded-lg text-xs text-stone-200 placeholder-stone-500 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600/30"
            />
            <input
              type="text"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="Description..."
              className="w-full px-3 py-2 bg-stone-900/60 border border-stone-700/50 rounded-lg text-xs text-stone-200 placeholder-stone-500 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600/30"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowAddForm(false)}
                className="px-3 py-1.5 rounded text-xs text-stone-400 hover:text-stone-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                className="px-3 py-1.5 rounded text-xs font-medium bg-teal-600 text-white hover:bg-teal-500 transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        )}

        {/* Surface cards */}
        {surfaces.length === 0 ? (
          <div className="text-center py-12">
            <Layers size={28} className="text-stone-700 mx-auto mb-2" />
            <p className="text-xs text-stone-500">No surfaces defined yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {surfaces.map(s => {
              const budgetPct = s.budgetTotal > 0 ? Math.round((s.budgetUsed / s.budgetTotal) * 100) : 0;
              return (
                <div
                  key={s.name}
                  className="bg-stone-800/40 rounded-lg border border-stone-700/40 p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <HealthIndicator score={s.healthScore} />
                      <h4 className="text-sm font-semibold text-stone-200">{s.name}</h4>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRelease(s.name)}
                        className="flex items-center gap-1 text-[10px] text-stone-500 hover:text-stone-300 transition-colors"
                      >
                        <LogOut size={10} />
                        Release
                      </button>
                      <button
                        onClick={() => handleOwn(s.name)}
                        className="flex items-center gap-1 text-[10px] text-teal-400 hover:text-teal-300 transition-colors"
                      >
                        <User size={10} />
                        Own
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-stone-400">{s.description}</p>
                  <div>
                    <p className="text-[10px] text-stone-500 mb-1">Budget: {s.budgetUsed} / {s.budgetTotal}</p>
                    <BudgetBar pct={budgetPct} />
                  </div>
                  {s.paths.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {s.paths.map(p => (
                        <span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-stone-700/50 text-stone-500 font-mono">
                          {p}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
