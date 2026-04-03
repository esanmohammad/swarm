import { useState, useEffect } from 'react';
import {
  Users,
  GitBranch,
  GitPullRequest,
  AlertTriangle,
  MessageCircle,
  Send,
  User,
  Activity,
  Shield,
} from 'lucide-react';
import type { WsCommand } from '../types';
import { FeatureGuide } from '../components/FeatureGuide';
import { StateView } from '../components/StateView';

interface TeamActivity {
  members: Array<{
    github: string;
    areas: string[];
    activeBranches: string[];
    recentPrs: Array<{ number: number; title: string; state: string }>;
  }>;
  swarmActivity: Array<{
    task: string;
    status: string;
    startedAt: number;
    cost: number;
  }>;
  conflicts: Array<{
    file: string;
    humanDeveloper: string;
    swarmTask: string;
  }>;
}

interface TeamViewProps {
  sendCommand: (cmd: WsCommand) => void;
  teamActivity: TeamActivity | null;
}

function getInitials(github: string): string {
  return github.slice(0, 2).toUpperCase();
}

function formatElapsed(startedAt: number): string {
  const ms = Date.now() - startedAt;
  if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
  return `${(ms / 3600000).toFixed(1)}h ago`;
}

export function TeamView({ sendCommand, teamActivity }: TeamViewProps) {
  const [notifyMessage, setNotifyMessage] = useState('');

  useEffect(() => {
    sendCommand({ action: 'get-team-activity' } as WsCommand);
  }, []);

  const handleNotify = () => {
    if (!notifyMessage.trim()) return;
    sendCommand({ action: 'team-notify', message: notifyMessage.trim() } as WsCommand);
    setNotifyMessage('');
  };

  if (!teamActivity) {
    return (
      <StateView
        status="empty"
        title="No team activity yet"
        message="No team activity yet. Team activity appears as multiple developers use Swarm on the same project."
        actions={[
          { label: 'Refresh', onClick: () => sendCommand({ action: 'get-team-activity' } as WsCommand), variant: 'primary' },
        ]}
      />
    );
  }

  const { members, swarmActivity, conflicts } = teamActivity;

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-blue-400" />
            <h2 className="text-lg font-semibold text-stone-200">Team Awareness</h2>
            <span className="text-xs text-stone-500 ml-2">
              {members.length} member{members.length !== 1 ? 's' : ''}
            </span>
            <FeatureGuide
              featureId="team"
              title="Team Coordination"
              description="Multi-user coordination — see what everyone is working on, shared context, and collaborative development activity."
              cliCommands={[{ command: 'swarm team', description: 'View team activity and coordination' }]}
              hasData={members.length > 0}
            />
          </div>
          <button
            onClick={() => sendCommand({ action: 'get-team-activity' } as WsCommand)}
            className="px-2.5 py-1 rounded text-[10px] font-medium border text-stone-400 border-stone-700/40 hover:border-stone-600/50 flex items-center gap-1 transition-colors"
          >
            <Activity size={10} />
            Refresh
          </button>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <User size={12} className="text-blue-400" />
              <span className="text-[10px] text-stone-500 uppercase tracking-wider">Members</span>
            </div>
            <p className="text-xl font-semibold text-stone-200">{members.length}</p>
          </div>
          <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <GitPullRequest size={12} className="text-green-400" />
              <span className="text-[10px] text-stone-500 uppercase tracking-wider">Open PRs</span>
            </div>
            <p className="text-xl font-semibold text-stone-200">
              {members.reduce((sum, m) => sum + m.recentPrs.length, 0)}
            </p>
          </div>
          <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Activity size={12} className="text-yellow-400" />
              <span className="text-[10px] text-stone-500 uppercase tracking-wider">Swarm Tasks</span>
            </div>
            <p className="text-xl font-semibold text-stone-200">
              {swarmActivity.filter(s => s.status === 'running').length}
              <span className="text-xs text-stone-500 ml-1">running</span>
            </p>
          </div>
          <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle size={12} className={conflicts.length > 0 ? 'text-red-400' : 'text-stone-500'} />
              <span className="text-[10px] text-stone-500 uppercase tracking-wider">Conflicts</span>
            </div>
            <p className={`text-xl font-semibold ${conflicts.length > 0 ? 'text-red-400' : 'text-stone-200'}`}>
              {conflicts.length}
            </p>
          </div>
        </div>

        {/* Conflicts Warning */}
        {conflicts.length > 0 && (
          <div className="bg-red-950/30 border border-red-800/40 rounded-lg p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <AlertTriangle size={14} className="text-red-400" />
              <h3 className="text-xs font-medium text-red-300 uppercase tracking-wider">Conflict Warnings</h3>
            </div>
            <div className="space-y-2">
              {conflicts.map((conflict, i) => (
                <div key={i} className="flex items-start gap-2 py-1.5 border-b border-red-800/20 last:border-0">
                  <AlertTriangle size={12} className="text-yellow-400 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-red-200 truncate">{conflict.file}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-stone-400">
                        Human: <span className="text-blue-300">@{conflict.humanDeveloper}</span>
                      </span>
                      <span className="text-[10px] text-stone-500">|</span>
                      <span className="text-[10px] text-stone-400">
                        Swarm: <span className="text-purple-300">{conflict.swarmTask}</span>
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-6">
          {/* Team Members */}
          <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <Users size={14} className="text-blue-400" />
              <h3 className="text-xs font-medium text-stone-300 uppercase tracking-wider">Team Members</h3>
            </div>
            {members.length === 0 ? (
              <p className="text-xs text-stone-500">No team members configured.</p>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {members.map((member, i) => (
                  <div key={i} className="bg-stone-900/40 border border-stone-700/30 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      {/* Avatar placeholder */}
                      <div className="w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-blue-300">{getInitials(member.github)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-stone-200 truncate">@{member.github}</p>
                        {member.areas.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {member.areas.map((area, j) => (
                              <span
                                key={j}
                                className="px-1.5 py-0.5 rounded text-[10px] bg-stone-700/40 text-stone-400 border border-stone-600/30"
                              >
                                {area}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Branches */}
                    {member.activeBranches.length > 0 && (
                      <div className="mt-1.5">
                        {member.activeBranches.slice(0, 3).map((branch, j) => (
                          <div key={j} className="flex items-center gap-1.5 py-0.5">
                            <GitBranch size={10} className="text-blue-400 shrink-0" />
                            <span className="text-[10px] text-stone-400 truncate">{branch}</span>
                          </div>
                        ))}
                        {member.activeBranches.length > 3 && (
                          <span className="text-[10px] text-stone-500 ml-4">
                            +{member.activeBranches.length - 3} more
                          </span>
                        )}
                      </div>
                    )}

                    {/* PRs */}
                    {member.recentPrs.length > 0 && (
                      <div className="mt-1.5">
                        {member.recentPrs.slice(0, 3).map((pr, j) => (
                          <div key={j} className="flex items-center gap-1.5 py-0.5">
                            <GitPullRequest size={10} className="text-green-400 shrink-0" />
                            <span className="text-[10px] text-stone-400 truncate">
                              #{pr.number} {pr.title}
                            </span>
                          </div>
                        ))}
                        {member.recentPrs.length > 3 && (
                          <span className="text-[10px] text-stone-500 ml-4">
                            +{member.recentPrs.length - 3} more
                          </span>
                        )}
                      </div>
                    )}

                    {member.activeBranches.length === 0 && member.recentPrs.length === 0 && (
                      <p className="text-[10px] text-stone-500 mt-1">No active work detected</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Swarm Activity & Timeline */}
          <div className="space-y-4">
            {/* Swarm Activity */}
            <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <Activity size={14} className="text-yellow-400" />
                <h3 className="text-xs font-medium text-stone-300 uppercase tracking-wider">Swarm Activity</h3>
              </div>
              {swarmActivity.length === 0 ? (
                <p className="text-xs text-stone-500">No active swarm tasks.</p>
              ) : (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {swarmActivity.map((task, i) => (
                    <div key={i} className="flex items-center gap-2 py-1.5 border-b border-stone-700/30 last:border-0">
                      <div
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          task.status === 'running' ? 'bg-yellow-400 animate-pulse' : 'bg-green-400'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-stone-300 truncate">{task.task}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-[10px] ${task.status === 'running' ? 'text-yellow-400' : 'text-green-400'}`}>
                            {task.status}
                          </span>
                          <span className="text-[10px] text-stone-500">{formatElapsed(task.startedAt)}</span>
                          <span className="text-[10px] text-yellow-500 font-mono">${task.cost.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Activity Timeline */}
            <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <Shield size={14} className="text-stone-400" />
                <h3 className="text-xs font-medium text-stone-300 uppercase tracking-wider">Team Config</h3>
              </div>
              <div className="space-y-1.5">
                {members.map((member, i) => (
                  <div key={i} className="flex items-center justify-between py-1 border-b border-stone-700/30 last:border-0">
                    <div className="flex items-center gap-1.5">
                      <User size={10} className="text-blue-400" />
                      <span className="text-[10px] text-stone-300">@{member.github}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-stone-500">
                        {member.recentPrs.length} PRs
                      </span>
                      <span className="text-[10px] text-stone-500">
                        {member.activeBranches.length} branches
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Notify Team */}
        <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <MessageCircle size={14} className="text-amber-400" />
            <h3 className="text-xs font-medium text-stone-300 uppercase tracking-wider">Notify Team</h3>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={notifyMessage}
              onChange={(e) => setNotifyMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleNotify(); }}
              placeholder="Type a message to notify the team..."
              className="flex-1 bg-stone-900/60 border border-stone-700/40 rounded px-3 py-2 text-xs text-stone-200 placeholder-stone-500 outline-none focus:border-stone-600/60"
            />
            <button
              onClick={handleNotify}
              disabled={!notifyMessage.trim()}
              className="px-3 py-2 rounded text-xs font-medium border bg-amber-600/20 text-amber-300 border-amber-500/40 hover:bg-amber-600/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
            >
              <Send size={12} />
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
