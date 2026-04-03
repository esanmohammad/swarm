import { Upload, Database, Package, AlertTriangle } from 'lucide-react';
import { HubLayout } from '../../layouts/HubLayout';

export function OperationsHub() {
  return (
    <HubLayout
      title="Operations"
      description="Deploy, migrate, manage dependencies, and respond to incidents."
      icon={<Upload size={20} />}
      features={[
        { name: 'Deploy', route: '/operations/deploy', icon: <Upload size={18} />, description: 'AI-assisted deployments', status: 'not-setup', actionLabel: 'Configure' },
        { name: 'Migrate', route: '/operations/migrate', icon: <Database size={18} />, description: 'Database migration generation', status: 'not-setup', actionLabel: 'Generate' },
        { name: 'Dependencies', route: '/operations/deps', icon: <Package size={18} />, description: 'Dependency audit & updates', status: 'not-setup', actionLabel: 'Audit' },
        { name: 'Incidents', route: '/operations/incident', icon: <AlertTriangle size={18} />, description: 'Incident response & RCA', status: 'not-setup', actionLabel: 'Respond' },
      ]}
      quickStart="Run 'swarm deploy staging' to deploy, or 'swarm deps' to audit your dependencies."
    />
  );
}
