'use client';

import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface HrNotification {
  id: string;
  type: string;
  title: string;
  message: string | null;
  read: boolean;
  createdAt: string;
}

export function HrNotificationsBell() {
  const [notifications, setNotifications] = useState<HrNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);

  async function load() {
    const res = await fetch('/api/hr/notifications?limit=15');
    const data = await res.json();
    setNotifications(data.notifications ?? []);
    setUnreadCount(data.unreadCount ?? 0);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  async function markAllRead() {
    await fetch('/api/hr/notifications', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markAllRead: true }),
    });
    load();
  }

  return (
    <DropdownMenu open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); }}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] text-primary-foreground">
              {unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recruitment Notifications</span>
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="text-[11px] text-primary hover:underline">Mark all read</button>
          )}
        </div>
        {notifications.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">No notifications yet.</div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {notifications.map((n) => (
              <DropdownMenuItem key={n.id} className="flex flex-col items-start gap-1">
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="text-sm font-medium">{n.title}</span>
                  {!n.read && <Badge variant="secondary" className="text-[9px]">new</Badge>}
                </div>
                {n.message && <span className="text-xs text-muted-foreground">{n.message}</span>}
                <span className="text-[10px] text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</span>
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
