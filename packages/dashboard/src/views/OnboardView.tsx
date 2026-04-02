import { useState, useEffect } from 'react';
import {
  GraduationCap,
  CheckCircle,
  Circle,
  MessageSquare,
  Send,
  Play,
  ChevronRight,
} from 'lucide-react';
import type { WsCommand } from '../types';

interface OnboardData {
  step: number;
  totalSteps: number;
  currentTopic: string;
  content: string;
  completed: string[];
  remaining: string[];
  mentorHistory: Array<{ question: string; answer: string; timestamp: number }>;
}

interface OnboardViewProps {
  sendCommand: (cmd: WsCommand) => void;
  onboardData: OnboardData | null;
}

export function OnboardView({ sendCommand, onboardData }: OnboardViewProps) {
  const [mentorInput, setMentorInput] = useState('');

  useEffect(() => {
    sendCommand({ action: 'get-onboard-data' } as WsCommand);
  }, []);

  const handleRunOnboard = () => {
    sendCommand({ action: 'run-onboard' } as WsCommand);
  };

  const handleMentorSend = () => {
    const text = mentorInput.trim();
    if (!text) return;
    sendCommand({ action: 'run-mentor', question: text } as WsCommand);
    setMentorInput('');
  };

  if (!onboardData) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <GraduationCap size={36} className="text-stone-600 mx-auto mb-3" />
          <p className="text-sm text-stone-400">Loading onboarding data...</p>
        </div>
      </div>
    );
  }

  const { step, totalSteps, currentTopic, content, completed, remaining, mentorHistory } = onboardData;

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GraduationCap size={18} className="text-green-400" />
            <h2 className="text-lg font-semibold text-stone-200">Onboarding</h2>
            <span className="text-xs text-stone-500 ml-2">
              Step {step} of {totalSteps}
            </span>
          </div>
          <button
            onClick={handleRunOnboard}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-green-600/20 text-green-300 border border-green-500/30 hover:bg-green-600/30 transition-colors"
          >
            <Play size={12} />
            Run Onboard
          </button>
        </div>

        {/* Current topic + content */}
        <div className="p-4 rounded-lg bg-stone-800/40 border border-stone-700/40 space-y-3">
          <h3 className="text-sm font-semibold text-stone-200">{currentTopic}</h3>
          <div className="border-t border-stone-700/30 pt-3">
            <pre className="text-xs text-stone-300 whitespace-pre-wrap font-mono leading-relaxed">
              {content}
            </pre>
          </div>
        </div>

        {/* Progress: completed + remaining */}
        <div className="flex gap-4">
          <div className="w-56 shrink-0 space-y-1">
            {completed.map((topic, i) => (
              <div key={i} className="flex items-center gap-2 p-2">
                <CheckCircle size={16} className="text-emerald-400 shrink-0" />
                <span className="text-xs text-stone-500 truncate">{topic}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 p-2">
              <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
                <span className="text-[9px] font-bold text-white">{step}</span>
              </div>
              <span className="text-xs text-stone-200 font-medium truncate">{currentTopic}</span>
              <ChevronRight size={12} className="text-stone-500 ml-auto shrink-0" />
            </div>
            {remaining.map((topic, i) => (
              <div key={i} className="flex items-center gap-2 p-2">
                <Circle size={16} className="text-stone-600 shrink-0" />
                <span className="text-xs text-stone-500 truncate">{topic}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Mentor Q&A chat */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5">
            <MessageSquare size={14} className="text-cyan-400" />
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Mentor Q&A</h3>
          </div>

          <div className="p-4 rounded-lg bg-stone-800/40 border border-stone-700/40 space-y-3 max-h-64 overflow-auto">
            {mentorHistory.length === 0 ? (
              <p className="text-[10px] text-stone-600 italic">
                Ask the AI mentor anything about this codebase.
              </p>
            ) : (
              mentorHistory.map((msg, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-end">
                    <div className="max-w-[80%] px-3 py-2 rounded-lg text-xs bg-blue-600/20 text-blue-200 border border-blue-500/30">
                      {msg.question}
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="max-w-[80%] px-3 py-2 rounded-lg text-xs bg-stone-700/50 text-stone-300 border border-stone-600/30">
                      {msg.answer}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={mentorInput}
              onChange={e => setMentorInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleMentorSend();
              }}
              placeholder="Ask the mentor a question..."
              className="flex-1 px-3 py-2 bg-stone-900/60 border border-stone-700/50 rounded-lg text-xs text-stone-200 placeholder-stone-500 focus:border-cyan-600 focus:outline-none focus:ring-1 focus:ring-cyan-600/30"
            />
            <button
              onClick={handleMentorSend}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-white bg-cyan-600 hover:bg-cyan-500 transition-colors shrink-0"
            >
              <Send size={12} />
              Ask
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
