'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings, Workflow } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/providers/auth-provider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { WORKSPACES } from '@/lib/workspaces/registry';

export function WorkspaceSidebar({ workspaceKey }: { workspaceKey: keyof typeof WORKSPACES }) {
  const workspace = WORKSPACES[workspaceKey];
  const pathname = usePathname();
  const { user } = useAuth();
  const settingsHref = `${workspace.homeHref}/settings`;
  const navItems = workspace.navItems.filter((item) => item.href !== settingsHref);
  const settingsActive = pathname === settingsHref || pathname.startsWith(`${settingsHref}/`);

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-card/40 backdrop-blur">
      <div className="flex h-16 items-center gap-2 px-5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground glow">
          <workspace.icon className="h-4 w-4" />
        </div>
        <span className="truncate font-display text-base font-semibold tracking-tight">{workspace.label}</span>
      </div>

      <ScrollArea className="flex-1 px-3">
        <nav className="space-y-0.5 py-2">
          {navItems.map((item) => {
            const active = pathname === item.href || (item.href !== workspace.homeHref && pathname.startsWith(`${item.href}/`));
            return (
              <Link
                key={item.href + item.label}
                href={item.href}
                className={cn(
                  'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                  active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      <div className="border-t border-border p-3">
        {user?.permissions.includes('workspace:enterprise') && (
          <Link
            href="/dashboard"
            className="mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-xs text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <Workflow className="h-4 w-4" />
            Enterprise Dashboard
          </Link>
        )}
        <Link
          href={settingsHref}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
            settingsActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
          )}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>
    </aside>
  );
}
