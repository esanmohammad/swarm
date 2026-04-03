import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';

interface FeatureCard {
  name: string;
  route: string;
  description: string;
  icon: ReactNode;
  status?: 'active' | 'not-setup' | 'has-data' | 'warning' | 'error';
  summary?: string;
  actionLabel?: string;
}

interface HubLayoutProps {
  title: string;
  description: string;
  icon: ReactNode;
  features: FeatureCard[];
  quickStart?: string;
}

function statusBadge(status?: string) {
  switch (status) {
    case 'active': return <span className="text-[10px] text-green-400 bg-green-950/40 px-1.5 py-0.5 rounded-full">Active</span>;
    case 'warning': return <span className="text-[10px] text-amber-400 bg-amber-950/40 px-1.5 py-0.5 rounded-full">Warning</span>;
    case 'error': return <span className="text-[10px] text-red-400 bg-red-950/40 px-1.5 py-0.5 rounded-full">Error</span>;
    case 'has-data': return <span className="text-[10px] text-blue-400 bg-blue-950/40 px-1.5 py-0.5 rounded-full">Ready</span>;
    case 'not-setup': return <span className="text-[10px] text-stone-500 bg-stone-800/40 px-1.5 py-0.5 rounded-full">Not set up</span>;
    default: return null;
  }
}

export function HubLayout({ title, description, icon, features, quickStart }: HubLayoutProps) {
  const navigate = useNavigate();

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="text-stone-400">{icon}</div>
          <h1 className="text-lg font-semibold text-stone-200">{title}</h1>
        </div>
        <p className="text-sm text-stone-500 mb-6">{description}</p>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          {features.map((f) => (
            <button
              key={f.route}
              onClick={() => navigate(f.route)}
              className="text-left p-4 rounded-lg border border-stone-800/50 bg-stone-900/30 hover:bg-stone-800/40 hover:border-stone-700/50 transition-colors group"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="text-stone-500 group-hover:text-stone-400 transition-colors">{f.icon}</div>
                {statusBadge(f.status)}
              </div>
              <h3 className="text-sm font-medium text-stone-300 mb-1">{f.name}</h3>
              <p className="text-xs text-stone-500 mb-2">{f.description}</p>
              {f.summary && <p className="text-xs text-stone-400">{f.summary}</p>}
              {f.actionLabel && f.status === 'not-setup' && (
                <span className="text-xs text-blue-400 group-hover:text-blue-300 mt-2 inline-block">{f.actionLabel} &rarr;</span>
              )}
              {f.status !== 'not-setup' && (
                <span className="text-xs text-stone-600 group-hover:text-stone-500 mt-2 inline-block">View &rarr;</span>
              )}
            </button>
          ))}
        </div>

        {/* Quick start */}
        {quickStart && (
          <div className="rounded-lg border border-stone-800/40 bg-stone-900/20 p-4">
            <h3 className="text-xs font-medium text-stone-400 mb-2">Quick Start</h3>
            <p className="text-xs text-stone-500">{quickStart}</p>
          </div>
        )}
      </div>
    </div>
  );
}
