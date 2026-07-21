'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity, BarChart3, Boxes, ClipboardList, CreditCard, FileClock, KeyRound, LayoutDashboard,
  Settings, Shield, Sparkles, UserCog, Workflow,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/providers/auth-provider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { WORKSPACES } from '@/lib/workspaces/registry';

const LIVE_WORKSPACE_KEYS = new Set(['app_factory', 'hr', 'designer']);

const NAV = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3 },
  { name: 'Projects', href: '/dashboard/projects', icon: Activity },
  { name: 'Templates', href: '/dashboard/templates', icon: Boxes },
  { name: 'Campaigns', href: '/dashboard/campaigns', icon: Sparkles },
  { name: 'Integrations', href: '/dashboard/integrations', icon: Workflow },
  { name: 'Credits', href: '/dashboard/credits', icon: CreditCard },
];

const ADMIN_ITEMS = [
  { name: 'Reports', href: '/dashboard/reports', icon: ClipboardList },
  { name: 'Users', href: '/dashboard/users', icon: UserCog },
  { name: 'Roles', href: '/dashboard/roles', icon: Shield },
  { name: 'Permissions', href: '/dashboard/permissions', icon: KeyRound },
  { name: 'Audit Logs', href: '/dashboard/audit-logs', icon: FileClock },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const settingsActive = pathname === '/dashboard/settings' || pathname.startsWith('/dashboard/settings/');

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-card/40 backdrop-blur">
      <div className="flex h-16 items-center gap-2 px-5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground glow">
          <Workflow className="h-4 w-4" />
        </div>
        <span className="font-display text-base font-semibold tracking-tight">Enterprise AI</span>
      </div>

      <ScrollArea className="flex-1 px-3">
        <nav className="space-y-0.5">
          {NAV.map((item) => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                  active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="mt-6 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Workspaces
        </div>
        <nav className="mt-2 space-y-0.5">
          {Object.values(WORKSPACES).map((ws) => {
            const active = pathname.startsWith(ws.homeHref);
            const live = LIVE_WORKSPACE_KEYS.has(ws.key);
            return (
              <Link
                key={ws.key}
                href={ws.homeHref}
                className={cn(
                  'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                  active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                <ws.icon className="h-4 w-4" />
                <span className="flex-1 truncate">{ws.label}</span>
                {!live && (
                  <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">soon</span>
                )}
              </Link>
            );
          })}
        </nav>

        {isSuperAdmin && (
          <>
            <div className="mt-6 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Admin
            </div>
            <nav className="mt-2 space-y-0.5">
              {ADMIN_ITEMS.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                      active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="flex-1">{item.name}</span>
                    <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">soon</span>
                  </Link>
                );
              })}
            </nav>
          </>
        )}
      </ScrollArea>

      <div className="border-t border-border p-3">
        <Link
          href="/dashboard/settings"
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
