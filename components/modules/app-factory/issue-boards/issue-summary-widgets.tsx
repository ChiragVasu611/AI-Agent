'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertOctagon, CheckCircle2, ClipboardList, Flame, Hammer, KanbanSquare,
  RotateCcw, ShieldAlert, TestTube2, UserCheck,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface Stats {
  totalBoards: number;
  totalIssues: number;
  openIssues: number;
  assigned: number;
  inProgress: number;
  readyForQa: number;
  closed: number;
  reopened: number;
  criticalIssues: number;
  highPriorityIssues: number;
  fixedToday: number;
}

const TILES: Array<{ key: keyof Stats; label: string; icon: typeof KanbanSquare; tone: string }> = [
  { key: 'totalBoards', label: 'Total Boards', icon: KanbanSquare, tone: 'text-primary bg-primary/10' },
  { key: 'openIssues', label: 'Open Issues', icon: ClipboardList, tone: 'text-primary bg-primary/10' },
  { key: 'assigned', label: 'Assigned', icon: UserCheck, tone: 'text-violet-500 bg-violet-500/10' },
  { key: 'inProgress', label: 'In Progress', icon: Hammer, tone: 'text-amber-500 bg-amber-500/10' },
  { key: 'readyForQa', label: 'Ready for QA', icon: TestTube2, tone: 'text-cyan-500 bg-cyan-500/10' },
  { key: 'closed', label: 'Closed', icon: CheckCircle2, tone: 'text-emerald-500 bg-emerald-500/10' },
  { key: 'reopened', label: 'Reopened', icon: RotateCcw, tone: 'text-rose-500 bg-rose-500/10' },
  { key: 'criticalIssues', label: 'Critical Issues', icon: ShieldAlert, tone: 'text-destructive bg-destructive/10' },
  { key: 'highPriorityIssues', label: 'High Priority', icon: AlertOctagon, tone: 'text-orange-500 bg-orange-500/10' },
  { key: 'fixedToday', label: 'Issues Fixed Today', icon: Flame, tone: 'text-emerald-500 bg-emerald-500/10' },
];

/**
 * AI Issue Boards summary widgets. Rendered inside the existing AI App Factory
 * dashboard and at the top of the module itself — it adds a row, it does not
 * replace or alter anything already on the dashboard.
 */
export function IssueSummaryWidgets({ compact = false, linkToModule = true }: { compact?: boolean; linkToModule?: boolean }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/app-factory/issue-boards/stats', { cache: 'no-store' });
        const data = await res.json();
        if (!cancelled && !data.error) setStats(data as Stats);
      } catch {
        /* widgets are non-critical */
      }
    }
    load();
    const interval = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const body = (
    <div className={cn('grid gap-3', compact ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-5')}>
      {TILES.map((tile) => {
        const value = stats?.[tile.key] ?? 0;
        return (
          <Card key={tile.key} className="border-border bg-card/60 p-3 backdrop-blur">
            <div className="flex items-center gap-2.5">
              <div className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', tile.tone)}>
                <tile.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="font-display text-lg font-semibold leading-none tabular-nums">
                  {stats === null ? '—' : value}
                </div>
                <div className="mt-1 truncate text-[11px] text-muted-foreground">{tile.label}</div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );

  if (!linkToModule) return body;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <KanbanSquare className="h-4 w-4 text-primary" />
          <h2 className="font-display text-lg font-semibold">AI Issue Boards</h2>
        </div>
        <Link href="/app-factory/issue-boards" className="text-xs text-primary hover:underline">
          Open module →
        </Link>
      </div>
      {body}
    </section>
  );
}
