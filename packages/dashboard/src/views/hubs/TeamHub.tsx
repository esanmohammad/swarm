import { Users, FileText, BookOpen, RefreshCw } from 'lucide-react';
import { HubLayout } from '../../layouts/HubLayout';

export function TeamHub() {
  return (
    <HubLayout
      title="Team"
      description="Async standups, decision journals, retrospectives, and pair programming."
      icon={<Users size={20} />}
      features={[
        { name: 'Standup', route: '/team/standup', icon: <FileText size={18} />, description: 'Async status reports', status: 'not-setup', actionLabel: 'Generate' },
        { name: 'Journal', route: '/team/journal', icon: <BookOpen size={18} />, description: 'Decision tracking', status: 'not-setup', actionLabel: 'Add entry' },
        { name: 'Retro', route: '/team/retro', icon: <RefreshCw size={18} />, description: 'Self-improvement retrospectives', status: 'not-setup', actionLabel: 'Generate' },
        { name: 'Pair', route: '/team/pair', icon: <Users size={18} />, description: 'AI pair programming', status: 'not-setup', actionLabel: 'Start session' },
      ]}
      quickStart="Run 'swarm standup' to generate an async standup report, or 'swarm pair' to start a pairing session."
    />
  );
}
