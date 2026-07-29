'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronsLeft, ChevronsRight, ClipboardList, FileClock, KeyRound, LayoutDashboard,
  Settings, Shield, UserCog, Workflow,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/providers/auth-provider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { WORKSPACES } from '@/lib/workspaces/registry';

/**
 * NAVIGATION DATA IS UNCHANGED.
 *
 * The same items, hrefs, icons, workspace registry and `super_admin` gate as
 * before — only the presentation is redesigned (collapsible rail, tooltips when
 * collapsed, refined active treatment, sidebar surface token). Role-based
 * visibility logic is byte-for-byte the same.
 */
const LIVE_WORKSPACE_KEYS = new Set(['app_factory', 'hr', 'designer', 'seo' , 'qa']);

const NAV = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
];

const ADMIN_ITEMS = [
  { name: 'Reports', href: '/dashboard/reports', icon: ClipboardList },
  { name: 'Users', href: '/dashboard/users', icon: UserCog },
  { name: 'Roles', href: '/dashboard/roles', icon: Shield },
  { name: 'Permissions', href: '/dashboard/permissions', icon: KeyRound },
  { name: 'Audit Logs', href: '/dashboard/audit-logs', icon: FileClock },
];

const COLLAPSE_KEY = 'eai:sidebar-collapsed';

/** Small uppercase group heading; hidden entirely on the collapsed rail. */
function GroupLabel({ children, collapsed }: { children: string; collapsed: boolean }) {
  if (collapsed) return <div className="mx-3 my-3 h-px bg-sidebar-border" role="presentation" />;
  return (
    <div className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

interface NavRowProps {
  href: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed: boolean;
  /** Trailing chip (e.g. "soon"); suppressed when collapsed. */
  badge?: string;
  onNavigate?: () => void;
}

function NavRow({ href, name, icon: Icon, active, collapsed, badge, onNavigate }: NavRowProps) {
  const row = (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      // 40px min height keeps every row a comfortable touch target.
      className={cn(
        'group relative flex min-h-10 items-center gap-3 rounded-control px-3 py-2 text-sm outline-none transition-colors duration-150',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar',
        collapsed && 'justify-center px-0',
        active
          ? 'nav-active font-medium text-primary'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active && 'text-primary')} />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{name}</span>}
      {!collapsed && badge && (
        <span className="type-badge shrink-0 rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground ring-1 ring-inset ring-border">
          {badge}
        </span>
      )}
      {/* Collapsed rail still needs the label for screen readers. */}
      {collapsed && <span className="sr-only">{name}{badge ? ` (${badge})` : ''}</span>}
    </Link>
  );

  if (!collapsed) return row;
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right" className="flex items-center gap-2">
        {name}
        {badge && <span className="text-muted-foreground">· {badge}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

export interface SidebarProps {
  /** Set by the mobile drawer so tapping a link closes it. */
  onNavigate?: () => void;
  /** Mobile drawer renders permanently expanded. */
  forceExpanded?: boolean;
}

export function Sidebar({ onNavigate, forceExpanded = false }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const settingsActive = pathname === '/dashboard/settings' || pathname.startsWith('/dashboard/settings/');

  // Desktop collapse state persists across navigations and reloads.
  const [collapsedPref, setCollapsedPref] = useState(false);
  useEffect(() => {
    try {
      setCollapsedPref(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch { /* storage unavailable — default to expanded */ }
  }, []);

  const collapsed = forceExpanded ? false : collapsedPref;

  function toggleCollapsed() {
    setCollapsedPref((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }

  return (
    <TooltipProvider>
      <aside
        aria-label="Workspace navigation"
        className={cn(
          'flex h-full flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200',
          collapsed ? 'w-[68px]' : 'w-64',
        )}
      >
        {/* Brand */}
        <div className={cn('flex h-16 shrink-0 items-center gap-2.5 px-4', collapsed && 'justify-center px-0')}>
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-gradient-to-br from-primary to-chart-2 text-primary-foreground">
            <Workflow className="h-4 w-4" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold tracking-tight text-foreground">Enterprise AI</div>
              <div className="type-caption truncate text-muted-foreground">Control centre</div>
            </div>
          )}
        </div>

        <ScrollArea className="flex-1 px-3">
          <nav className="space-y-0.5" aria-label="Primary">
            {NAV.map((item) => {
              const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
              return (
                <NavRow key={item.href} {...item} active={active} collapsed={collapsed} onNavigate={onNavigate} />
              );
            })}
          </nav>

          <GroupLabel collapsed={collapsed}>Workspaces</GroupLabel>
          <nav className="space-y-0.5" aria-label="Workspaces">
            {Object.values(WORKSPACES).map((ws) => {
              const active = pathname.startsWith(ws.homeHref);
              const live = LIVE_WORKSPACE_KEYS.has(ws.key);
              return (
                <NavRow
                  key={ws.key}
                  href={ws.homeHref}
                  name={ws.label}
                  icon={ws.icon}
                  active={active}
                  collapsed={collapsed}
                  badge={live ? undefined : 'soon'}
                  onNavigate={onNavigate}
                />
              );
            })}
          </nav>

          {isSuperAdmin && (
            <>
              <GroupLabel collapsed={collapsed}>Admin</GroupLabel>
              <nav className="space-y-0.5" aria-label="Administration">
                {ADMIN_ITEMS.map((item) => (
                  <NavRow
                    key={item.href}
                    {...item}
                    active={pathname === item.href}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                  />
                ))}
              </nav>
            </>
          )}
          <div className="h-3" />
        </ScrollArea>

        {/* Settings is separated from primary navigation by a real divider. */}
        <div className="shrink-0 border-t border-sidebar-border p-3">
          <NavRow
            href="/dashboard/settings"
            name="Settings"
            icon={Settings}
            active={settingsActive}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
          {!forceExpanded && (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={cn(
                'mt-1 hidden min-h-10 w-full items-center gap-3 rounded-control px-3 py-2 text-sm text-muted-foreground outline-none transition-colors',
                'hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring lg:flex',
                collapsed && 'justify-center px-0',
              )}
            >
              {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
              {!collapsed && <span className="flex-1 text-left">Collapse</span>}
            </button>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
