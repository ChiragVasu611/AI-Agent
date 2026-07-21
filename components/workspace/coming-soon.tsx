import { Clock } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function ComingSoon({ feature, workspaceLabel }: { feature: string; workspaceLabel: string }) {
  return (
    <div className="mx-auto max-w-3xl p-6 lg:p-8">
      <Card className="flex flex-col items-center justify-center gap-3 border-dashed border-border bg-card/40 px-6 py-16 text-center backdrop-blur">
        <Badge variant="secondary" className="gap-1">
          <Clock className="h-3 w-3" /> Coming soon
        </Badge>
        <h1 className="font-display text-xl font-semibold tracking-tight">{feature}</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {feature} isn&apos;t built yet in the {workspaceLabel}. This route is already wired into the
          workspace&apos;s navigation and permission system, so the feature can be added later without
          touching the surrounding architecture.
        </p>
      </Card>
    </div>
  );
}
