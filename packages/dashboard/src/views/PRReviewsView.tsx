import { useState, useEffect } from 'react';
import { GitPullRequest, Play, Square, CheckCircle, XCircle, MessageCircle, Eye, ChevronDown, ChevronUp, Clock, DollarSign, Settings } from 'lucide-react';
import type { WsCommand, Agent, AgentActivity } from '../types';
import { FeatureGuide } from '../components/FeatureGuide';
import { ActionProgress } from '../components/ActionProgress';
import { useAction } from '../hooks/useAction';

interface PRReview {
  number: number;
  sha: string;
  reviewedAt: string;
  verdict: string;
  cost: number;
}

interface PRReviewsViewProps {
  sendCommand: (cmd: WsCommand) => void;
  reviews: PRReview[];
  agents?: Agent[];
  agentOutputs?: Map<string, string>;
  agentActivities?: Map<string, AgentActivity[]>;
}

const VERDICT_STYLES: Record<string, { icon: typeof CheckCircle; color: string; bg: string; label: string }> = {
  APPROVE: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/15 border-green-500/30', label: 'Approved' },
  REQUEST_CHANGES: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/15 border-red-500/30', label: 'Changes Requested' },
  COMMENT: { icon: MessageCircle, color: 'text-yellow-400', bg: 'bg-yellow-500/15 border-yellow-500/30', label: 'Commented' },
};

function timeAgo(ts: string | number): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function PRReviewsView({ sendCommand, reviews, agents, agentOutputs, agentActivities }: PRReviewsViewProps) {
  const [prTarget, setPrTarget] = useState('');
  const [expandedReview, setExpandedReview] = useState<number | null>(null);
  const [showContinuousConfig, setShowContinuousConfig] = useState(false);
  const [babysitLabel, setBabysitLabel] = useState('swarm');
  const [babysitInterval, setBabysitInterval] = useState('10');
  const [autoApprove, setAutoApprove] = useState(false);
  const [babysitRunning, setBabysitRunning] = useState(false);
  const [expandedAgentOutput, setExpandedAgentOutput] = useState(false);

  // Action tracking for single PR review
  const reviewAction = useAction(sendCommand);

  // Find review agent (if running)
  const reviewAgent = agents?.find(a => a.status === 'running' && a.persona === 'engineer' && a.name?.includes('review'));
  const reviewOutput = reviewAgent ? agentOutputs?.get(reviewAgent.id) || '' : '';
  const reviewActivities = reviewAgent ? agentActivities?.get(reviewAgent.id) || [] : [];
  const lastActivity = reviewActivities[reviewActivities.length - 1];

  useEffect(() => {
    sendCommand({ action: 'get-pr-reviews' } as WsCommand);
  }, []);

  // Update action state when review agent completes
  useEffect(() => {
    if (reviewAction.state.status === 'running' || reviewAction.state.status === 'pending') {
      if (reviewAgent) {
        // Still running - could update progress here
      }
    }
  }, [reviewAgent, reviewAction.state.status]);

  const handleReviewPr = () => {
    const target = prTarget.trim();
    if (!target) return;
    const match = target.match(/\/pull\/(\d+)/);
    const prNum = match ? match[1] : target.replace(/\D/g, '');
    if (!prNum) return;

    reviewAction.execute(
      { action: 'run-review', target: prNum } as WsCommand,
      `Reviewing PR #${prNum}...`
    );
  };

  const handleReviewHead = () => {
    reviewAction.execute(
      { action: 'run-review' } as WsCommand,
      'Reviewing current branch changes...'
    );
  };

  const handleStartBabysit = () => {
    setBabysitRunning(true);
    sendCommand({
      action: 'run-babysit-prs',
      label: babysitLabel.trim() || undefined,
      autoApprove,
      interval: parseInt(babysitInterval) || 10,
    } as WsCommand);
  };

  const handleStopBabysit = () => {
    setBabysitRunning(false);
    // Stop is handled by toggling the local state — the daemon runs in CLI
    setBabysitRunning(false);
  };

  const totalCost = reviews.reduce((sum, r) => sum + r.cost, 0);
  const approvals = reviews.filter(r => r.verdict === 'APPROVE').length;
  const changes = reviews.filter(r => r.verdict === 'REQUEST_CHANGES').length;

  const hasReviews = reviews.length > 0;
  const isReviewing = reviewAction.state.status === 'pending' || reviewAction.state.status === 'running';

  return (
    <div className="flex-1 flex flex-col p-6 overflow-y-auto">
      <div className="max-w-4xl w-full mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitPullRequest size={18} className="text-blue-400" />
            <h2 className="text-lg font-semibold text-stone-200">Code Review</h2>
          </div>
          <FeatureGuide
            featureId="reviews"
            title="PR Reviews"
            description="Automated code reviews powered by AI. Reviews PRs, posts comments to GitHub, and optionally auto-approves."
            hasData={hasReviews}
            setupSteps={[
              { label: 'Ensure GitHub CLI is authenticated', command: 'gh auth status' },
              { label: 'Review a specific PR', command: 'swarm review 42' },
              { label: 'Or review current changes', command: 'swarm review' },
            ]}
            cliCommands={[
              { command: 'swarm review', description: 'Review current branch' },
              { command: 'swarm review 42', description: 'Review PR #42' },
              { command: 'swarm babysit-prs start --label swarm', description: 'Continuous monitoring' },
            ]}
            prerequisites={[
              { label: '.swarm/ directory initialized', met: true },
              { label: 'GitHub CLI installed (gh)', met: true },
            ]}
          />
        </div>

        {/* Review a PR */}
        <section className="rounded-lg border border-stone-800/50 bg-stone-900/30 overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-800/30">
            <h3 className="text-xs font-medium text-stone-400">Review a PR</h3>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={prTarget}
                onChange={(e) => setPrTarget(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isReviewing && handleReviewPr()}
                placeholder="PR number or URL (e.g. 42 or https://github.com/.../pull/42)"
                className="flex-1 bg-stone-900/50 border border-stone-700/50 rounded-md px-3 py-2 text-sm text-stone-300 placeholder-stone-600 focus:outline-none focus:ring-1 focus:ring-stone-600"
                disabled={isReviewing}
              />
              <button
                onClick={handleReviewPr}
                disabled={isReviewing || !prTarget.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium text-white bg-violet-600 hover:bg-violet-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors shrink-0"
              >
                <Play size={12} />
                Review
              </button>
            </div>
            <button
              onClick={handleReviewHead}
              disabled={isReviewing}
              className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 disabled:text-stone-600"
            >
              <Eye size={12} />
              Or review current branch changes
            </button>

            {/* Inline operation — agent output streams HERE */}
            {(isReviewing || reviewAction.state.status === 'success' || reviewAction.state.status === 'error') && (
              <div className="mt-3">
                <ActionProgress
                  state={reviewAction.state}
                  onCancel={reviewAction.cancel}
                  onRetry={() => prTarget.trim() ? handleReviewPr() : handleReviewHead()}
                  onDismiss={reviewAction.reset}
                />
              </div>
            )}

            {/* Live agent output while reviewing */}
            {isReviewing && reviewAgent && (
              <div className="mt-2 rounded-md border border-stone-800/40 bg-stone-950/50 overflow-hidden">
                <div className="px-3 py-2 border-b border-stone-800/30 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-[10px] text-stone-500">
                      {lastActivity?.tool ? `${lastActivity.tool}: ${lastActivity.summary?.substring(0, 80)}` : 'Agent working...'}
                    </span>
                  </div>
                  <button
                    onClick={() => setExpandedAgentOutput(!expandedAgentOutput)}
                    className="text-[10px] text-stone-600 hover:text-stone-400 flex items-center gap-1"
                  >
                    {expandedAgentOutput ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                    {expandedAgentOutput ? 'Collapse' : 'Show full output'}
                  </button>
                </div>
                <pre className={`px-3 py-2 text-[10px] text-stone-600 font-mono whitespace-pre-wrap overflow-x-auto ${expandedAgentOutput ? 'max-h-60' : 'max-h-16'} overflow-y-auto`}>
                  {expandedAgentOutput ? reviewOutput.slice(-5000) : reviewOutput.split('\n').slice(-3).join('\n')}
                </pre>
              </div>
            )}
          </div>
        </section>

        {/* Continuous Review */}
        <section className="rounded-lg border border-stone-800/50 bg-stone-900/30 overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-800/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-medium text-stone-400">Continuous Review</h3>
              {babysitRunning && (
                <span className="flex items-center gap-1 text-[10px] text-green-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  Active
                </span>
              )}
            </div>
            <button
              onClick={() => setShowContinuousConfig(!showContinuousConfig)}
              className="text-stone-600 hover:text-stone-400 p-1"
            >
              <Settings size={13} />
            </button>
          </div>
          <div className="p-4 space-y-3">
            {babysitRunning ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-stone-400">
                    Watching PRs with label <code className="text-stone-300 bg-stone-800/60 px-1 py-0.5 rounded">{babysitLabel || 'all'}</code>
                  </span>
                  <button
                    onClick={handleStopBabysit}
                    className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium text-red-400 hover:text-red-300 bg-red-950/30 hover:bg-red-950/50 border border-red-800/30 transition-colors"
                  >
                    <Square size={10} /> Stop
                  </button>
                </div>
                <div className="text-[10px] text-stone-600">
                  Auto-approve: {autoApprove ? <span className="text-amber-400">ON</span> : <span className="text-stone-500">OFF</span>}
                  {' | '}Checking every {babysitInterval} minutes
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-stone-500">
                  Watches GitHub PRs with a specified label. Reviews each one and posts comments.
                </p>
                <button
                  onClick={handleStartBabysit}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors"
                >
                  <Play size={12} /> Start Continuous Review
                </button>
              </div>
            )}

            {/* Configuration panel */}
            {showContinuousConfig && (
              <div className="mt-2 p-3 rounded-md bg-stone-900/50 border border-stone-800/30 space-y-3">
                <div>
                  <label className="text-[10px] text-stone-500 block mb-1">GitHub label to watch</label>
                  <input
                    type="text"
                    value={babysitLabel}
                    onChange={(e) => setBabysitLabel(e.target.value)}
                    placeholder="swarm"
                    className="w-full bg-stone-900/50 border border-stone-700/50 rounded px-2.5 py-1.5 text-xs text-stone-300 placeholder-stone-600 focus:outline-none focus:ring-1 focus:ring-stone-600"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-stone-500 block mb-1">Check interval (minutes)</label>
                  <input
                    type="number"
                    value={babysitInterval}
                    onChange={(e) => setBabysitInterval(e.target.value)}
                    min="1"
                    max="60"
                    className="w-24 bg-stone-900/50 border border-stone-700/50 rounded px-2.5 py-1.5 text-xs text-stone-300 focus:outline-none focus:ring-1 focus:ring-stone-600"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-stone-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoApprove}
                    onChange={(e) => setAutoApprove(e.target.checked)}
                    className="rounded border-stone-600 bg-stone-800 text-blue-500"
                  />
                  Auto-approve
                  <span className="text-[10px] text-stone-600 ml-1">
                    (submits an APPROVE review on GitHub — does NOT merge)
                  </span>
                </label>
              </div>
            )}
          </div>
        </section>

        {/* Stats */}
        {hasReviews && (
          <div className="grid grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-stone-900/40 border border-stone-800/40 text-center">
              <div className="text-lg font-semibold text-stone-200">{reviews.length}</div>
              <div className="text-[10px] text-stone-500 uppercase">Total</div>
            </div>
            <div className="p-3 rounded-lg bg-green-950/30 border border-green-800/20 text-center">
              <div className="text-lg font-semibold text-green-400">{approvals}</div>
              <div className="text-[10px] text-stone-500 uppercase">Approved</div>
            </div>
            <div className="p-3 rounded-lg bg-red-950/30 border border-red-800/20 text-center">
              <div className="text-lg font-semibold text-red-400">{changes}</div>
              <div className="text-[10px] text-stone-500 uppercase">Changes</div>
            </div>
            <div className="p-3 rounded-lg bg-stone-900/40 border border-stone-800/40 text-center">
              <div className="text-lg font-semibold text-amber-400">${totalCost.toFixed(2)}</div>
              <div className="text-[10px] text-stone-500 uppercase">Cost</div>
            </div>
          </div>
        )}

        {/* Recent Reviews */}
        <section>
          <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Recent Reviews</h3>
          {!hasReviews ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <GitPullRequest size={32} className="text-stone-600 mb-3" />
              <p className="text-sm text-stone-400 mb-1">No PR reviews yet</p>
              <p className="text-xs text-stone-500 max-w-sm">
                Enter a PR number above to review it, or start continuous review to watch for new PRs automatically.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {[...reviews].reverse().map((review, idx) => {
                const style = VERDICT_STYLES[review.verdict] || VERDICT_STYLES.COMMENT;
                const Icon = style.icon;
                const isExpanded = expandedReview === review.number;

                return (
                  <div
                    key={`${review.number}-${review.sha}-${idx}`}
                    className="rounded-lg bg-stone-900/40 border border-stone-800/40 hover:border-stone-700/40 transition-colors overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedReview(isExpanded ? null : review.number)}
                      className="flex items-center gap-3 w-full p-3 text-left"
                    >
                      <div className={`p-1.5 rounded border ${style.bg} shrink-0`}>
                        <Icon size={14} className={style.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-stone-200">PR #{review.number}</span>
                          <span className={`text-[10px] font-medium ${style.color}`}>{style.label}</span>
                        </div>
                        <div className="text-[10px] text-stone-500 mt-0.5">
                          {timeAgo(review.reviewedAt)} | SHA: {review.sha.slice(0, 7)}
                        </div>
                      </div>
                      <span className="text-xs text-amber-400 font-mono shrink-0">${review.cost.toFixed(2)}</span>
                      {isExpanded ? <ChevronUp size={12} className="text-stone-600 shrink-0" /> : <ChevronDown size={12} className="text-stone-600 shrink-0" />}
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="px-3 pb-3 border-t border-stone-800/30 pt-2 space-y-2">
                        <div className="flex items-center gap-2 text-xs text-stone-500">
                          <Clock size={11} />
                          <span>Reviewed at {new Date(review.reviewedAt).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-stone-500">
                          <DollarSign size={11} />
                          <span>Cost: ${review.cost.toFixed(3)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-stone-500">
                          <GitPullRequest size={11} />
                          <span>Commit: {review.sha}</span>
                        </div>
                        {/* Action links - these would need the repo URL to be fully functional */}
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            onClick={() => {
                              // Re-review this PR
                              setPrTarget(String(review.number));
                              reviewAction.execute(
                                { action: 'run-review', target: String(review.number) } as WsCommand,
                                `Re-reviewing PR #${review.number}...`
                              );
                            }}
                            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded hover:bg-stone-800/50"
                          >
                            <Play size={10} /> Re-review
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
