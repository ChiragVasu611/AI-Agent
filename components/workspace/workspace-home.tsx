import Link from 'next/link';
import { Card } from '@/components/ui/card';
import type { WorkspaceConfig } from '@/lib/workspaces/registry';

export function WorkspaceHome({ workspace }: { workspace: WorkspaceConfig }) {
  const items = workspace.navItems.filter((item) => item.href !== workspace.homeHref);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
          <workspace.icon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{workspace.label}</h1>
          <p className="text-sm text-muted-foreground">{workspace.subtitle}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="group h-full border-border bg-card/60 p-5 backdrop-blur transition hover:border-primary/40">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <item.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-3 font-display text-base font-semibold">{item.label}</h3>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
