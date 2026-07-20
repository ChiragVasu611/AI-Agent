import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { BarChart3, Bot, Boxes, Layers, ShieldCheck, Sparkles } from 'lucide-react';

const STATS = [
  { label: 'Total Builds', value: 0, icon: Bot },
  { label: 'Avg QA Score', value: '—', icon: ShieldCheck },
  { label: 'Agent Runs', value: 0, icon: BarChart3 },
  { label: 'Active Modules', value: 1, icon: Boxes },
];

export default function AnalyticsPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">Platform-wide metrics across all agents and modules.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((s) => (
          <Card key={s.label} className="border-border bg-card/60 p-5 backdrop-blur">
            <s.icon className="h-5 w-5 text-primary" />
            <div className="mt-3 font-display text-3xl font-semibold">{s.value}</div>
            <div className="text-sm text-muted-foreground">{s.label}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border bg-card/60 p-6 backdrop-blur">
          <h2 className="font-display text-lg font-semibold">Module Usage</h2>
          <div className="mt-4 space-y-3">
            {[
              { name: 'App Factory', pct: 100, icon: Bot, live: true },
              { name: 'QA Automation', pct: 0, icon: ShieldCheck, live: false },
              { name: 'HR Assistant', pct: 0, icon: Boxes, live: false },
              { name: 'Marketing', pct: 0, icon: Sparkles, live: false },
              { name: 'UI/UX Designer', pct: 0, icon: Layers, live: false },
            ].map((m) => (
              <div key={m.name} className="flex items-center gap-3">
                <m.icon className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-sm">{m.name}</span>
                <div className="w-32"><Progress value={m.pct} className="h-1.5" /></div>
                {m.live ? <Badge className="bg-success/15 text-success hover:bg-success/15 text-[10px]">Live</Badge> : <Badge variant="secondary" className="text-[10px]">Soon</Badge>}
              </div>
            ))}
          </div>
        </Card>

        <Card className="border-border bg-card/60 p-6 backdrop-blur">
          <h2 className="font-display text-lg font-semibold">Agent Performance</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Per-agent completion rates will populate as you run builds through the App Factory pipeline.
          </p>
        </Card>
      </div>
    </div>
  );
}
