import { useState } from 'react';
import { Database, Play, Loader2 } from 'lucide-react';
import { FeatureGuide } from '../components/FeatureGuide';
import { StateView } from '../components/StateView';
import type { WsCommand, Agent } from '../types';

interface MigrateViewProps {
  sendCommand: (cmd: WsCommand) => void;
  agents: Agent[];
  agentOutputs: Map<string, string>;
}

export function MigrateView({ sendCommand, agents, agentOutputs }: MigrateViewProps) {
  const [description, setDescription] = useState('');
  const [dryRun, setDryRun] = useState(true);

  const migrateAgent = agents.find(a => a.name.startsWith('migrate-'));
  const isRunning = migrateAgent?.status === 'running';
  const output = migrateAgent ? agentOutputs.get(migrateAgent.id) || '' : '';

  const handleMigrate = () => {
    if (!description.trim()) return;
    sendCommand({
      action: 'run-migrate',
      description: description.trim(),
      dryRun,
    } as WsCommand);
  };

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="max-w-4xl w-full mx-auto flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-2 mb-4">
          <Database size={18} className="text-orange-400" />
          <h2 className="text-lg font-semibold text-stone-200">Database Migration</h2>
          <FeatureGuide
            featureId="migrate"
            title="Migrations"
            description="AI-driven database migration generation. Describe what you need and Swarm generates the migration SQL."
            cliCommands={[
              { command: 'swarm migrate', description: 'Generate a database migration interactively' },
            ]}
            hasData={!!output}
          />
        </div>

        <p className="text-xs text-stone-500 mb-4">
          AI-assisted database migrations. Detects your ORM (Prisma, TypeORM, Knex, Django, etc.)
          and generates migration + rollback files with safety checks.
        </p>

        <div className="space-y-3 mb-4">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.metaKey && description.trim()) handleMigrate(); }}
            placeholder='Describe the migration, e.g., "add user preferences table with theme and locale columns"'
            rows={2}
            className="w-full px-3 py-2 bg-stone-900/60 border border-stone-700/50 rounded-lg text-xs text-stone-200 placeholder-stone-500 focus:border-blue-600 focus:outline-none resize-none"
          />

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-stone-400 cursor-pointer">
              <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} className="rounded" />
              Dry run (plan only, no file changes)
            </label>

            <button
              onClick={handleMigrate}
              disabled={isRunning || !description.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors ml-auto"
            >
              {isRunning ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              {isRunning ? 'Generating...' : dryRun ? 'Plan Migration' : 'Generate Migration'}
            </button>
          </div>
        </div>

        {/* Output */}
        {output ? (
          <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-stone-800/50 bg-stone-900/40 p-4">
            {isRunning && (
              <div className="flex items-center gap-2 mb-3 text-xs text-stone-400">
                <Loader2 size={12} className="animate-spin" />
                Analyzing schema and generating migration...
              </div>
            )}
            <pre className="whitespace-pre-wrap text-xs text-stone-300 font-mono leading-relaxed">{output}</pre>
            {migrateAgent?.status === 'done' && (
              <div className="mt-4 pt-3 border-t border-stone-800/40 text-[10px] text-stone-500">
                Cost: ${migrateAgent.cost.totalUsd.toFixed(2)} | Model: {migrateAgent.model}
              </div>
            )}
          </div>
        ) : (
          <StateView
            status="empty"
            title="No migrations generated yet"
            message="Describe your migration above and click Generate. Supports Prisma, TypeORM, Knex, Drizzle, Django, SQLAlchemy, and goose."
          />
        )}
      </div>
    </div>
  );
}
