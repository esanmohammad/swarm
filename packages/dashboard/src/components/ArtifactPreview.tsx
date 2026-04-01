import { useState } from 'react';
import { FileText, ChevronDown, ChevronUp, X } from 'lucide-react';
import type { StageName } from '../types';

const ARTIFACT_NAMES: Record<string, string> = {
  analyze: 'REQUIREMENTS.md',
  architect: 'SPEC.md',
  plan: 'TASKS.md',
  test: 'TESTPLAN.md',
};

interface ArtifactPreviewProps {
  stage: StageName;
  content: string;
  onClose: () => void;
}

export function ArtifactPreview({ stage, content, onClose }: ArtifactPreviewProps) {
  const [expanded, setExpanded] = useState(true);
  const artifactName = ARTIFACT_NAMES[stage] || stage;
  const lines = content.split('\n');
  const previewLines = expanded ? lines : lines.slice(0, 20);

  return (
    <div className="border border-stone-700/50 rounded-lg bg-[#0b0908] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-stone-800/30 border-b border-stone-700/40">
        <div className="flex items-center gap-2">
          <FileText size={12} className="text-stone-400" />
          <span className="text-xs font-medium text-stone-300">{artifactName}</span>
          <span className="text-[10px] text-stone-500">{lines.length} lines</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 text-stone-400 hover:text-stone-300 transition-colors"
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          <button
            onClick={onClose}
            className="p-1 text-stone-400 hover:text-stone-300 transition-colors"
            title="Close preview"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className={`overflow-auto font-mono text-xs leading-relaxed ${expanded ? 'max-h-96' : 'max-h-40'}`}>
        <pre className="p-3 text-stone-300 whitespace-pre-wrap break-words">
          {previewLines.join('\n')}
          {!expanded && lines.length > 20 && (
            <span className="text-stone-500 italic block mt-1">
              ... {lines.length - 20} more lines
            </span>
          )}
        </pre>
      </div>
    </div>
  );
}

interface ArtifactButtonProps {
  stage: StageName;
  onClick: () => void;
}

export function ArtifactButton({ stage, onClick }: ArtifactButtonProps) {
  const artifactName = ARTIFACT_NAMES[stage];
  if (!artifactName) return null;

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-stone-400 hover:text-stone-300 hover:bg-stone-800/40 transition-colors"
      title={`View ${artifactName}`}
    >
      <FileText size={9} />
      {artifactName}
    </button>
  );
}
