import { Sparkles } from 'lucide-react';
import { ModulePlaceholder } from '@/components/modules/module-placeholder';

export default function MarketingPage() {
  return (
    <ModulePlaceholder
      title="AI Marketing Agent"
      description="Campaign generation, copywriting, audience segmentation, and performance forecasting."
      icon={Sparkles}
      accent="from-pink-500/30 to-rose-500/10"
      features={[
        'Campaign generation',
        'Ad copywriting',
        'Audience segmentation',
        'Channel planning',
        'A/B test ideas',
        'Performance forecasting',
      ]}
    />
  );
}
