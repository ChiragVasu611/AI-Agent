'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Bell, Menu, Search, User } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Sidebar } from '@/components/dashboard/sidebar';
import { ThemeToggle } from '@/components/dashboard/theme-toggle';

/**
 * Top bar.
 *
 * Notification and profile behaviour is UNCHANGED — same dropdown state, same
 * items, same `/profile` link, same auth-derived values. Added around it:
 * a mobile navigation drawer trigger, a theme switcher, an optional breadcrumb
 * slot and an optional contextual action slot. Both new slots are optional, so
 * every existing `<Topbar title subtitle />` call site keeps working untouched.
 */
export function Topbar({
  title,
  subtitle,
  breadcrumbs,
  actions,
  mobileNav,
  titleAs = 'h1',
}: {
  title: string;
  subtitle?: string;
  /** Rendered above the title on deeper pages. */
  breadcrumbs?: ReactNode;
  /** Contextual primary action for the current page. */
  actions?: ReactNode;
  /**
   * Navigation shown in the mobile drawer. Each shell passes ITS OWN sidebar so
   * a workspace never shows enterprise navigation (and vice versa). Defaults to
   * the enterprise Sidebar, which is what the enterprise shell needs.
   */
  mobileNav?: ReactNode;
  /**
   * Heading level for the top-bar title. Defaults to `h1`, which is what every
   * existing page relies on. Pages that render their own `DashboardPageHeader`
   * (and therefore own the page `h1`) pass `'p'` so the document has exactly one
   * h1 instead of two competing ones.
   */
  titleAs?: 'h1' | 'p';
}) {
  const { user } = useAuth();
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const email = user?.email ?? 'guest@enterprise.ai';
  const initials = email.slice(0, 2).toUpperCase();
  const TitleTag = titleAs;

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/60 sm:px-6">
      {/* Mobile: the sidebar becomes a drawer. Hidden from lg upward. */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
          {/* Delegated click-close: works for whatever nav a shell injects,
              without each sidebar needing to know about the drawer. */}
          <div
            className="h-full"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a')) setNavOpen(false);
            }}
          >
            {mobileNav ?? <Sidebar forceExpanded onNavigate={() => setNavOpen(false)} />}
          </div>
        </SheetContent>
      </Sheet>

      <div className="min-w-0 flex-1">
        {breadcrumbs && <div className="mb-0.5 hidden sm:block">{breadcrumbs}</div>}
        <TitleTag className="type-card-title truncate text-foreground sm:text-lg">{title}</TitleTag>
        {subtitle && <p className="type-caption truncate text-muted-foreground">{subtitle}</p>}
      </div>

      {actions && <div className="hidden shrink-0 items-center gap-2 md:flex">{actions}</div>}

      <div className="relative hidden lg:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <label htmlFor="topbar-search" className="sr-only">Search projects and agents</label>
        <Input
          id="topbar-search"
          placeholder="Search projects, agents…"
          className="w-56 rounded-control bg-surface pl-9 xl:w-64"
        />
      </div>

      <ThemeToggle />

      <DropdownMenu open={notifOpen} onOpenChange={setNotifOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
            <Bell className="h-[18px] w-[18px]" />
            <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Notifications
          </div>
          <DropdownMenuItem className="flex flex-col items-start gap-1">
            <div className="flex w-full items-center justify-between">
              <span className="text-sm font-medium">Pipeline completed</span>
              <Badge variant="secondary" className="text-[10px]">2m</Badge>
            </div>
            <span className="text-xs text-muted-foreground">Your App Factory build passed QA.</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="flex flex-col items-start gap-1">
            <span className="text-sm font-medium">Credits topped up</span>
            <span className="text-xs text-muted-foreground">100 credits added to your account.</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu open={profileOpen} onOpenChange={setProfileOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className="rounded-full outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label="Account details"
          >
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary/15 text-xs text-primary">{initials}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-primary/15 text-xs text-primary">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{user?.fullName || 'User'}</div>
              <div className="truncate text-xs text-muted-foreground">{email}</div>
              <Badge variant="secondary" className="mt-1 text-[10px] capitalize">{user?.role.replace('_', ' ') ?? 'employee'}</Badge>
            </div>
          </div>
          <div className="border-t border-border">
            <Link href="/profile" onClick={() => setProfileOpen(false)}>
              <DropdownMenuItem className="cursor-pointer gap-2">
                <User className="h-4 w-4" /> View full profile
              </DropdownMenuItem>
            </Link>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
