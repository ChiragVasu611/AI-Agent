import { Boxes } from 'lucide-react';
import { ModulePlaceholder } from '@/components/modules/module-placeholder';

export default function HrPage() {
  return (
    <ModulePlaceholder
      title="AI HR Assistant"
      description="Screening, onboarding, policy Q&A, and candidate ranking powered by autonomous agents."
      icon={Boxes}
      accent="from-amber-500/30 to-yellow-500/10"
      features={[
        'Resume screening',
        'Candidate ranking',
        'Onboarding flows',
        'Policy Q&A',
        'Interview scheduling',
        'Offer generation',
      ]}
    />
  );
}
