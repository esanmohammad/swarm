import { Layers, BookOpen, Brain } from 'lucide-react';
import { HubLayout } from '../../layouts/HubLayout';

export function CodebaseHub() {
  return (
    <HubLayout
      title="Codebase"
      description="Learn project conventions and manage cross-run memory."
      icon={<Layers size={20} />}
      features={[
        { name: 'Conventions', route: '/codebase/conventions', icon: <BookOpen size={18} />, description: 'Learned patterns & style rules', status: 'has-data', actionLabel: 'View' },
        { name: 'Memory', route: '/codebase/memory', icon: <Brain size={18} />, description: 'Cross-run knowledge store', status: 'has-data', actionLabel: 'View' },
      ]}
      quickStart="Run 'swarm learn' to discover conventions, or 'swarm memory' to manage learned patterns."
    />
  );
}
