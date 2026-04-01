interface OnboardingTooltipProps {
  title: string;
  description: string;
  onDismiss: () => void;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export function OnboardingTooltip({ title, description, onDismiss, position = 'bottom' }: OnboardingTooltipProps) {
  const positionClasses = {
    top: 'bottom-full mb-2',
    bottom: 'top-full mt-2',
    left: 'right-full mr-2',
    right: 'left-full ml-2',
  };

  return (
    <div className={`absolute ${positionClasses[position]} z-50 w-72 animate-fade-in`}>
      <div className="bg-blue-950/90 border border-blue-700/50 rounded-lg p-3 shadow-lg shadow-blue-900/20">
        <h4 className="text-xs font-semibold text-blue-200 mb-1">{title}</h4>
        <p className="text-[11px] text-blue-300/80 leading-relaxed mb-2.5">{description}</p>
        <button
          onClick={onDismiss}
          className="px-3 py-1 rounded text-[10px] font-medium text-blue-200 bg-blue-800/40 hover:bg-blue-800/60 border border-blue-600/30 transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
