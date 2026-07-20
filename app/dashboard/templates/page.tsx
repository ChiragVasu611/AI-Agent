import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bot, Boxes, Layers, ShieldCheck, Smartphone, Sparkles } from 'lucide-react';

const TEMPLATES = [
  { name: 'E-commerce App', desc: 'Catalog, cart, checkout, payments.', icon: Smartphone, module: 'App Factory' },
  { name: 'Social Network', desc: 'Feed, profiles, messaging, notifications.', icon: Smartphone, module: 'App Factory' },
  { name: 'Fitness Tracker', desc: 'Workouts, goals, charts, sync.', icon: Smartphone, module: 'App Factory' },
  { name: 'QA Suite', desc: '8-test automation bundle template.', icon: ShieldCheck, module: 'QA Automation' },
  { name: 'Recruitment Flow', desc: 'Screening to offer pipeline.', icon: Boxes, module: 'HR Assistant' },
  { name: 'Campaign Kit', desc: 'Multi-channel campaign blueprint.', icon: Sparkles, module: 'Marketing' },
  { name: 'Design System', desc: 'Tokens, components, docs.', icon: Layers, module: 'UI/UX Designer' },
  { name: 'Blank Canvas', desc: 'Start from scratch.', icon: Bot, module: 'App Factory' },
];

export default function TemplatesPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Templates</h1>
        <p className="text-sm text-muted-foreground">Pre-built starting points for every module.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATES.map((t) => (
          <Card key={t.name} className="group border-border bg-card/60 p-5 backdrop-blur transition hover:border-primary/40">
            <div className="flex items-start justify-between">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <t.icon className="h-5 w-5" />
              </div>
              <Badge variant="secondary" className="text-[10px]">{t.module}</Badge>
            </div>
            <h3 className="mt-4 font-display text-base font-semibold">{t.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t.desc}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
