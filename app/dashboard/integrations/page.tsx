import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, Plug } from 'lucide-react';

const INTEGRATIONS = [
  { name: 'MongoDB', desc: 'Database, auth, and storage.', connected: true },
  { name: 'NVIDIA NIM', desc: 'AI models for all agents.', connected: true },
  { name: 'Socket.io', desc: 'Realtime pipeline updates.', connected: false },
  { name: 'AWS S3', desc: 'Build artifact storage.', connected: false },
  { name: 'GitHub', desc: 'Source code export & repos.', connected: false },
  { name: 'Figma', desc: 'Design JSON sync.', connected: false },
];

export default function IntegrationsPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground">Connect external services to extend the platform.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {INTEGRATIONS.map((i) => (
          <Card key={i.name} className="border-border bg-card/60 p-5 backdrop-blur">
            <div className="flex items-start justify-between">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-muted-foreground">
                <Plug className="h-5 w-5" />
              </div>
              {i.connected ? (
                <Badge className="gap-1 bg-success/15 text-success hover:bg-success/15"><Check className="h-3 w-3" /> Connected</Badge>
              ) : (
                <Badge variant="secondary">Not connected</Badge>
              )}
            </div>
            <h3 className="mt-4 font-display text-base font-semibold">{i.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{i.desc}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
