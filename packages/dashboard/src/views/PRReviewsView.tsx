import { useState, useEffect } from 'react';
import { GitPullRequest, Play, CheckCircle, XCircle, MessageCircle } from 'lucide-react';
import type { WsCommand } from '../types';

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
}

const VERDICT_STYLES: Record<string, { icon: typeof CheckCircle; color: string; bg: string }> = {
  APPROVE: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/15 border-green-500/30' },
  REQUEST_CHANGES: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/15 border-red-500/30' },
  COMMENT: { icon: MessageCircle, color: 'text-yellow-400', bg: 'bg-yellow-500/15 border-yellow-500/30' },
};

export function PRReviewsView({ sendCommand, reviews }: PRReviewsViewProps) {
  const [label, setLabel] = useState('');
  const [autoApprove, setAutoApprove] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    sendCommand({ action: 'get-pr-reviews' } as WsCommand);
  }, []);

  const handleRun = () => {
    setRunning(true);
    sendCommand({
      action: 'run-babysit-prs',
      label: label.trim() || undefined,
      autoApprove,
    } as WsCommand);
    // Reset running after a timeout (no reliable completion signal from daemon)
    setTimeout(() => setRunning(false), 30000);
  };

  const totalCost = reviews.reduce((sum, r) => sum + r.cost, 0);
  const approvals = reviews.filter(r => r.verdict === 'APPROVE').length;
  const changes = reviews.filter(r => r.verdict === 'REQUEST_CHANGES').length;
  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="max-w-4xl w-full mx-auto flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <GitPullRequest size={18} className="text-blue-400" />
            <h2 className="text-lg font-semibold text-stone-200">PR Reviews</h2>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-stone-900/40 border border-stone-800/40">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Filter by label (optional)"
            className="px-3 py-1.5 bg-transparent border border-stone-700/40 rounded text-xs text-stone-300 placeholder-stone-500 focus:border-blue-600 focus:outline-none flex-1"
          />
          <label className="flex items-center gap-1.5 text-xs text-stone-400 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={autoApprove}
              onChange={(e) => setAutoApprove(e.target.checked)}
              className="rounded border-stone-600 bg-stone-800 text-blue-500"
            />
            Auto-approve
          </label>
          <button
            onClick={handleRun}
            disabled={running}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors shrink-0"
          >
            <Play size={12} />
            {running ? 'Reviewing...' : 'Review PRs Now'}
          </button>
        </div>

        <p className="text-xs text-stone-500 mb-4">
          Reviews open PRs using AI with project conventions. Comments are posted directly on GitHub.
          CLI: <code className="text-stone-400 bg-stone-800/60 px-1 py-0.5 rounded">swarm babysit-prs start</code> for continuous monitoring.
        </p>

        {/* Stats */}
        {reviews.length > 0 && (
          <div className="grid grid-cols-4 gap-3 mb-4">
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

        {/* Review list */}
        <div className="flex-1 min-h-0 overflow-auto space-y-2">
          {reviews.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <GitPullRequest size={36} className="text-stone-600 mb-3" />
              <p className="text-sm text-stone-400 mb-1">No PR reviews yet</p>
              <p className="text-xs text-stone-500 max-w-md">
                Click "Review PRs Now" to scan open PRs, or run{' '}
                <code className="text-stone-400 bg-stone-800/60 px-1 py-0.5 rounded">swarm babysit-prs start</code>{' '}
                for continuous monitoring.
              </p>
            </div>
          ) : (
            [...reviews].reverse().map((review, idx) => {
              const style = VERDICT_STYLES[review.verdict] || VERDICT_STYLES.COMMENT;
              const Icon = style.icon;
              return (
                <div
                  key={`${review.number}-${review.sha}-${idx}`}
                  className="flex items-center gap-3 p-3 rounded-lg bg-stone-900/40 border border-stone-800/40 hover:border-stone-700/40 transition-colors"
                >
                  <div className={`p-1.5 rounded border ${style.bg}`}>
                    <Icon size={14} className={style.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-stone-200">PR #{review.number}</span>
                      <span className={`text-[10px] font-medium ${style.color}`}>{review.verdict}</span>
                    </div>
                    <div className="text-[10px] text-stone-500 mt-0.5">
                      {new Date(review.reviewedAt).toLocaleString()} | SHA: {review.sha.slice(0, 7)}
                    </div>
                  </div>
                  <span className="text-xs text-amber-400 font-mono">${review.cost.toFixed(2)}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
