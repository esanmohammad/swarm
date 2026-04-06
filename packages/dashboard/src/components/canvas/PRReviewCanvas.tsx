import { useState, useEffect } from 'react';
import {
  GitPullRequest, Play, RefreshCw, CheckCircle2, XCircle,
  AlertTriangle, Send, Link, ExternalLink,
} from 'lucide-react';
import type { WsCommand } from '../../types';

interface PRReview {
  number: number;
  sha: string;
  reviewedAt: string;
  verdict: string;
  cost: number;
}

interface PRReviewCanvasProps {
  prReviews: PRReview[];
  sendCommand: (cmd: WsCommand) => void;
}

const VERDICT_STYLE: Record<string, { color: string; bg: string; icon: typeof CheckCircle2 }> = {
  APPROVE: { color: 'var(--status-success)', bg: 'var(--status-success-bg)', icon: CheckCircle2 },
  REQUEST_CHANGES: { color: 'var(--status-error)', bg: 'var(--status-error-bg)', icon: XCircle },
  COMMENT: { color: 'var(--status-warning)', bg: 'var(--status-warning-bg)', icon: AlertTriangle },
};

export function PRReviewCanvas({ prReviews, sendCommand }: PRReviewCanvasProps) {
  const [label, setLabel] = useState('');
  const [prLink, setPrLink] = useState('');
  const [scanning, setScanning] = useState(false);
  const [postToGitHub, setPostToGitHub] = useState(false);

  useEffect(() => {
    sendCommand({ action: 'get-pr-reviews' } as WsCommand);
  }, [sendCommand]);

  const handleScanAll = () => {
    setScanning(true);
    sendCommand({
      action: 'run-babysit-prs',
      label: label.trim() || undefined,
    });
    setTimeout(() => setScanning(false), 5000);
  };

  const handleReviewSingle = () => {
    const target = prLink.trim();
    if (!target) return;
    sendCommand({ action: 'run-review', target, post: postToGitHub } as WsCommand);
    setPrLink('');
  };

  const totalCost = prReviews.reduce((sum, r) => sum + (r.cost || 0), 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 shrink-0"
        style={{ backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-muted)' }}
      >
        <div className="flex items-center gap-2">
          <GitPullRequest size={14} style={{ color: 'var(--activity-review)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            PR Reviews
          </span>
          {prReviews.length > 0 && (
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {prReviews.length} reviewed
            </span>
          )}
        </div>
        {totalCost > 0 && (
          <span className="text-xs font-code tabular-nums" style={{ color: 'var(--text-secondary)' }}>
            ${totalCost.toFixed(2)} total
          </span>
        )}
      </div>

      {/* Review a specific PR */}
      <div
        className="px-4 py-3 space-y-3"
        style={{ borderBottom: '1px solid var(--border-muted)' }}
      >
        {/* Single PR input */}
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
            Review a PR
          </div>
          <div
            className="flex items-center gap-2 rounded-md px-3 py-2"
            style={{ backgroundColor: 'var(--bg-raised)', border: '1px solid var(--border-default)' }}
          >
            <Link size={12} style={{ color: 'var(--text-disabled)' }} />
            <input
              value={prLink}
              onChange={(e) => setPrLink(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleReviewSingle(); }}
              placeholder="Paste PR link, number, or #123"
              className="flex-1 bg-transparent text-xs focus:outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
            <button
              onClick={handleReviewSingle}
              disabled={!prLink.trim()}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-all disabled:opacity-30"
              style={{ backgroundColor: 'var(--accent-emphasis)', color: '#fff' }}
            >
              <Send size={10} />
              Review
            </button>
          </div>
          <p className="text-[10px] mt-1" style={{ color: 'var(--text-disabled)' }}>
            Accepts: https://github.com/.../pull/123, PR number, or #123
          </p>
        </div>

        {/* Post to GitHub toggle */}
        <label
          className="flex items-center gap-2 cursor-pointer select-none group"
          title="When enabled, the review will be posted as a comment on the GitHub PR thread"
        >
          <button
            role="switch"
            aria-checked={postToGitHub}
            onClick={() => setPostToGitHub(!postToGitHub)}
            className="relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors duration-200"
            style={{
              backgroundColor: postToGitHub ? 'var(--accent-emphasis)' : 'var(--bg-overlay)',
              border: '1px solid var(--border-default)',
            }}
          >
            <span
              className="inline-block h-3 w-3 rounded-full transition-transform duration-200"
              style={{
                backgroundColor: '#fff',
                transform: postToGitHub ? 'translateX(12px)' : 'translateX(1px)',
                marginTop: '0.5px',
              }}
            />
          </button>
          <ExternalLink size={11} style={{ color: postToGitHub ? 'var(--accent)' : 'var(--text-disabled)' }} />
          <span
            className="text-xs transition-colors"
            style={{ color: postToGitHub ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          >
            Post review to GitHub
          </span>
          {postToGitHub && (
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent)' }}>
              Will post as PR comment
            </span>
          )}
        </label>

        {/* Scan all PRs */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border-muted)' }} />
          <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-disabled)' }}>or</span>
          <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border-muted)' }} />
        </div>

        <div className="flex items-center gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Filter by label (optional)"
            className="flex-1 bg-transparent text-xs focus:outline-none rounded-md px-3 py-1.5"
            style={{ color: 'var(--text-primary)', border: '1px solid var(--border-muted)' }}
          />
          <button
            onClick={handleScanAll}
            disabled={scanning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40 whitespace-nowrap"
            style={{ backgroundColor: 'var(--bg-emphasis)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
          >
            {scanning ? (
              <RefreshCw size={11} className="animate-spin" />
            ) : (
              <Play size={11} />
            )}
            {scanning ? 'Scanning...' : 'Review All Open PRs'}
          </button>
        </div>
      </div>

      {/* Reviews list */}
      <div className="flex-1 overflow-y-auto">
        {prReviews.length === 0 ? (
          <div className="flex items-center justify-center h-full p-6">
            <div className="text-center space-y-2 max-w-xs">
              <GitPullRequest size={28} className="mx-auto opacity-15" style={{ color: 'var(--text-tertiary)' }} />
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Previous reviews will appear here
              </p>
            </div>
          </div>
        ) : (
          <div>
            <div
              className="px-4 py-1.5 text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: 'var(--text-disabled)', borderBottom: '1px solid var(--border-muted)' }}
            >
              Review History
            </div>
            {prReviews.map((review, i) => {
              const verdictStyle = VERDICT_STYLE[review.verdict] || VERDICT_STYLE.COMMENT;
              const VerdictIcon = verdictStyle.icon;
              return (
                <div
                  key={`${review.number}-${review.sha}-${i}`}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors"
                  style={{ borderBottom: '1px solid var(--border-muted)' }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-subtle)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <span
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0"
                    style={{ backgroundColor: verdictStyle.bg, color: verdictStyle.color }}
                  >
                    <VerdictIcon size={10} />
                    {review.verdict}
                  </span>
                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                    PR #{review.number}
                  </span>
                  <span className="text-[10px] font-code" style={{ color: 'var(--text-disabled)' }}>
                    {review.sha.slice(0, 7)}
                  </span>
                  <div className="flex-1" />
                  {review.cost > 0 && (
                    <span className="text-[10px] font-code tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                      ${review.cost.toFixed(2)}
                    </span>
                  )}
                  <span className="text-[10px] font-code" style={{ color: 'var(--text-disabled)' }}>
                    {new Date(review.reviewedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
