'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity, BarChart3, Boxes, Bot, CreditCard, LayoutDashboard, LogOut,
  Settings, ShieldCheck, Sparkles, User, Workflow,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { signOutAction } from '@/app/actions';
import { useAuth } from '@/components/providers/auth-provider';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';

const MODULES = [
  { name: 'App Factory', href: '/dashboard/app-factory', icon: Bot, status: 'live' },
  { name: 'QA Automation', href: '/dashboard/qa', icon: ShieldCheck, status: 'soon' },
  { name: 'AI HR Assistant', href: '/dashboard/hr', icon: Boxes, status: 'live' },
  { name: 'AI Marketing', href: '/dashboard/marketing', icon: Sparkles, status: 'soon' },
  { name: 'UI/UX AI Designer', href: '/dashboard/uiux', icon: Workflow, status: 'live' },
];

const NAV = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3 },
  { name: 'Projects', href: '/dashboard/projects', icon: Activity },
  { name: 'Templates', href: '/dashboard/templates', icon: Boxes },
  { name: 'Campaigns', href: '/dashboard/campaigns', icon: Sparkles },
  { name: 'Integrations', href: '/dashboard/integrations', icon: Workflow },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings },
  { name: 'Credits', href: '/dashboard/credits', icon: CreditCard },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const email = user?.email ?? 'guest@enterprise.ai';
  const initials = email.slice(0, 2).toUpperCase();

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
          AI Modules
        </div>
        <nav className="mt-2 space-y-0.5">
          {MODULES.map((m) => {
            const active = pathname.startsWith(m.href);
            return (
              <Link
                key={m.href}
                href={m.href}
                className={cn(
                  'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                  active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                <m.icon className="h-4 w-4" />
                <span className="flex-1">{m.name}</span>
                {m.status === 'soon' && (
                  <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">soon</span>
                )}
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      <div className="border-t border-border p-3">
        <Link
          href="/dashboard/profile"
          className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-secondary"
        >
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary/15 text-xs text-primary">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{user?.fullName || 'User'}</div>
            <div className="truncate text-[11px] text-muted-foreground">{email}</div>
          </div>
          <User className="h-4 w-4 text-muted-foreground" />
        </Link>
        <form action={signOutAction}>
          <button
            type="submit"
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
