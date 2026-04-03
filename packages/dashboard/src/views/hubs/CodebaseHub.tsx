import { Layers, HelpCircle, BookOpen, Brain, Network } from 'lucide-react';
import { HubLayout } from '../../layouts/HubLayout';

export function CodebaseHub() {
  return (
    <HubLayout
      title="Codebase"
      description="Understand, index, and query your codebase with AI-powered tools."
      icon={<Layers size={20} />}
      features={[
        { name: 'Context', route: '/codebase/context', icon: <Layers size={18} />, description: 'Codebase index & module map', status: 'not-setup', actionLabel: 'Build index' },
        { name: 'Explain', route: '/codebase/explain', icon: <HelpCircle size={18} />, description: 'Ask questions about your code', status: 'has-data' },
        { name: 'Conventions', route: '/codebase/conventions', icon: <BookOpen size={18} />, description: 'Learned patterns & style rules', status: 'not-setup', actionLabel: 'Learn' },
        { name: 'Memory', route: '/codebase/memory', icon: <Brain size={18} />, description: 'Cross-run knowledge store', status: 'not-setup', actionLabel: 'Setup' },
        { name: 'System Map', route: '/codebase/system', icon: <Network size={18} />, description: 'Architecture visualization', status: 'not-setup', actionLabel: 'Build map' },
      ]}
      quickStart="Run swarm explain to ask questions about your code, or swarm learn to discover conventions."
    />
  );
}
