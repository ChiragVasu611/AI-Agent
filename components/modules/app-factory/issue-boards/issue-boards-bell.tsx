'use client';

import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

interface BoardNotification {
  id: string;
  type: string;
  title: string;
  message: string | null;
  read: boolean;
  createdAt: string;
}

function relative(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Issue-board notifications only — QA retests, assignments, reopens, new boards. */
export function IssueBoardsBell() {
  const [items, setItems] = useState<BoardNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  async function load() {
    try {
      const res = await fetch('/api/app-factory/issue-boards/notifications?limit=20', { cache: 'no-store' });
      const data = await res.json();
      if (!data.error) {
        setItems(data.notifications ?? []);
        setUnread(data.unreadCount ?? 0);
      }
    } catch {
      /* non-critical */
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  async function markAllRead() {
    await fetch('/api/app-factory/issue-boards/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markAllRead: true }),
    });
    load();
  }

  return (
    <DropdownMenu open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); }}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="relative h-9 w-9">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] text-primary-foreground">
              {unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[420px] w-96 overflow-y-auto">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Issue Board Notifications
          </span>
          {unread > 0 && (
            <button onClick={markAllRead} className="text-[11px] text-primary hover:underline">
              Mark all read
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">Nothing yet.</div>
        ) : items.map((n) => (
          <DropdownMenuItem key={n.id} className="flex flex-col items-start gap-1">
            <div className="flex w-full items-baseline justify-between gap-2">
              <span className={`text-sm ${n.read ? 'font-normal' : 'font-medium'}`}>{n.title}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{relative(n.createdAt)}</span>
            </div>
            {n.message && <span className="text-xs leading-snug text-muted-foreground">{n.message}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
