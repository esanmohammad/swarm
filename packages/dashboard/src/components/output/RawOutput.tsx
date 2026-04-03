import type { Agent } from '../../types';
import { MarkdownRenderer } from './MarkdownRenderer';

interface RawOutputProps {
  agent: Agent;
  liveOutput: string;
  localMessages: string[];
  isRunning: boolean;
}

function looksLikeMarkdown(text: string): boolean {
  if (!text) return false;
  return /^#{1,6}\s/m.test(text) ||
    /\*\*.+\*\*/m.test(text) ||
    /^[-*+]\s/m.test(text) ||
    /^\d+[.)]\s/m.test(text) ||
    /^```/m.test(text) ||
    /^>/m.test(text);
}

export function RawOutput({ agent, liveOutput, localMessages, isRunning }: RawOutputProps) {
  const baseOutput = agent.output || '';
  const streamedExtra = liveOutput && liveOutput !== baseOutput
    ? liveOutput.startsWith(baseOutput)
      ? liveOutput.slice(baseOutput.length)
      : liveOutput
    : '';

  const fullText = baseOutput + streamedExtra;
  const isMd = looksLikeMarkdown(fullText);

  return (
    <div className="p-4 text-xs leading-relaxed">
      {fullText || localMessages.length > 0 ? (
        <>
          {fullText && (
            isMd ? (
              <MarkdownRenderer content={fullText} />
            ) : (
              <pre className="whitespace-pre-wrap break-words font-ui" style={{ color: 'var(--text-primary)' }}>{fullText}</pre>
            )
          )}
          {localMessages.map((msg, i) => (
            <div key={i} className="my-1.5 flex items-start gap-2">
              <span className="font-bold shrink-0" style={{ color: 'var(--status-success)' }}>{'>'}</span>
              <pre className="whitespace-pre-wrap break-words" style={{ color: 'var(--status-success)', opacity: 0.8 }}>{msg}</pre>
            </div>
          ))}
          {isRunning && localMessages.length > 0 && (
            <span className="terminal-cursor" style={{ color: 'var(--status-running)' }}>_</span>
          )}
        </>
      ) : (
        <span className="italic" style={{ color: 'var(--text-tertiary)' }}>
          {isRunning ? 'awaiting output...' : 'no output'}
        </span>
      )}
    </div>
  );
}
