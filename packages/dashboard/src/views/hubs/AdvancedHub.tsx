import { Settings, Puzzle, Target } from 'lucide-react';
import { HubLayout } from '../../layouts/HubLayout';

export function AdvancedHub() {
  return (
    <HubLayout
      title="Advanced"
      description="Plugins, surface ownership, and platform extensibility."
      icon={<Settings size={20} />}
      features={[
        { name: 'Plugins', route: '/advanced/plugins', icon: <Puzzle size={18} />, description: 'Extend Swarm with custom plugins', status: 'not-setup', actionLabel: 'Browse' },
        { name: 'Surfaces', route: '/advanced/surfaces', icon: <Target size={18} />, description: 'Code surface ownership', status: 'not-setup', actionLabel: 'Configure' },
      ]}
      quickStart="Run 'swarm plugin list' to see available plugins."
    />
  );
}
