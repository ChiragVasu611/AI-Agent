'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bell, Search, User } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

export function Topbar({ title, subtitle }: { title: string; subtitle?: string }) {
  const { user } = useAuth();
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const email = user?.email ?? 'guest@enterprise.ai';
  const initials = email.slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-border bg-background/80 px-6 backdrop-blur">
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-display text-lg font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>

      <div className="relative hidden md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search projects, agents…" className="w-64 pl-9" />
      </div>

      <DropdownMenu open={notifOpen} onOpenChange={setNotifOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="h-5 w-5" />
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" />
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
          <button className="rounded-full transition hover:opacity-80" aria-label="Account details">
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
