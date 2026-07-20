import { Layers } from 'lucide-react';
import { ModulePlaceholder } from '@/components/modules/module-placeholder';

export default function UiuxPage() {
  return (
    <ModulePlaceholder
      title="UI/UX AI Designer"
      description="Wireframes, design systems, and interactive prototypes generated from a brief."
      icon={Layers}
      accent="from-cyan-500/30 to-teal-500/10"
      features={[
        'Wireframe generation',
        'Design system tokens',
        'Component libraries',
        'Interactive prototypes',
        'Responsive layouts',
        'Accessibility checks',
      ]}
    />
  );
}
