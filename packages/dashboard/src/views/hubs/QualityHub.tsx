import { Target, Zap, Bug, Shield, ClipboardCheck, Building2 } from 'lucide-react';
import { HubLayout } from '../../layouts/HubLayout';

export function QualityHub() {
  return (
    <HubLayout
      title="Quality"
      description="Track SLOs, manage tech debt, run security scans, and ensure compliance."
      icon={<Target size={20} />}
      features={[
        { name: 'SLOs', route: '/quality/slo', icon: <Zap size={18} />, description: 'Service level objectives', status: 'not-setup', actionLabel: 'Add SLO' },
        { name: 'Tech Debt', route: '/quality/debt', icon: <Bug size={18} />, description: 'Debt tracking & prioritization', status: 'not-setup', actionLabel: 'Scan' },
        { name: 'Security', route: '/quality/security', icon: <Shield size={18} />, description: 'Vulnerability scanning', status: 'not-setup', actionLabel: 'Run scan' },
        { name: 'Compliance', route: '/quality/compliance', icon: <ClipboardCheck size={18} />, description: 'Regulatory checks', status: 'not-setup', actionLabel: 'Check' },
        { name: 'Architecture', route: '/quality/architecture', icon: <Building2 size={18} />, description: 'Design review & coupling analysis', status: 'not-setup', actionLabel: 'Review' },
      ]}
      quickStart="Run 'swarm secure' for a security scan, or 'swarm slo add' to define a reliability target."
    />
  );
}
