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
    <aside
      aria-label={`${workspace.label} navigation`}
      className="flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar"
    >
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-4">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-gradient-to-br from-primary to-chart-2 text-primary-foreground">
          <workspace.icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-tight text-foreground">{workspace.label}</div>
          <div className="type-caption truncate text-muted-foreground">Workspace</div>
        </div>
      </div>

      <ScrollArea className="flex-1 px-3">
        <nav className="space-y-0.5 py-2" aria-label="Workspace sections">
          {navItems.map((item) => {
            const active = pathname === item.href || (item.href !== workspace.homeHref && pathname.startsWith(`${item.href}/`));
            return (
              <Link
                key={item.href + item.label}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group flex min-h-10 items-center gap-3 rounded-control px-3 py-2 text-sm outline-none transition-colors duration-150',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar',
                  active
                    ? 'nav-active font-medium text-primary'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                <item.icon className={cn('h-4 w-4 shrink-0', active && 'text-primary')} />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      {/* Settings (and the enterprise escape hatch) are separated from the
          workspace's own sections by a real divider. Permission gate unchanged. */}
      <div className="shrink-0 border-t border-sidebar-border p-3">
        {user?.permissions.includes('workspace:enterprise') && (
          <Link
            href="/dashboard"
            className="mb-1 flex min-h-10 items-center gap-3 rounded-control px-3 py-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Workflow className="h-4 w-4 shrink-0" />
            Enterprise Dashboard
          </Link>
        )}
        <Link
          href={settingsHref}
          aria-current={settingsActive ? 'page' : undefined}
          className={cn(
            'flex min-h-10 items-center gap-3 rounded-control px-3 py-2 text-sm outline-none transition-colors',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar',
            settingsActive
              ? 'nav-active font-medium text-primary'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          Settings
        </Link>
      </div>
    </aside>
  );
}
