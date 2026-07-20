'use client';

import { useState } from 'react';
import { Bell, Menu, Search } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';

export function Topbar({ title, subtitle }: { title: string; subtitle?: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

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

      <DropdownMenu open={open} onOpenChange={setOpen}>
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

      <div className="hidden text-right sm:block">
        <div className="text-sm font-medium">{user?.fullName || 'User'}</div>
        <div className="text-[11px] capitalize text-muted-foreground">
          {user?.role ?? 'user'}
        </div>
      </div>
    </header>
  );
}
