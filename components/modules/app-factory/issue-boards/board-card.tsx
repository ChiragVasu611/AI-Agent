'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, RotateCcw, Star, Tag } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  accentFor, DISPLAY_STATUS_META, formatRelativeShort, initials2, platformLabel, PLATFORM_TAG,
} from '@/lib/issue-boards/board-display';
import type { BoardStatus } from '@/lib/issue-boards/constants';
import { cn } from '@/lib/utils';

export interface BoardCardData {
  id: string;
  applicationName: string;
  applicationIconDataUrl: string | null;
  platform: string;
  buildVersion: string;
  status: BoardStatus;
  totalIssues: number;
  closedIssues: number;
  reopenedIssues: number;
  functionalIssues: number;
  uiIssues: number;
  lastActivityAt: string;
  isFavourited: boolean;
}

/** Uppercase, bold micro-label used under every issue-count stat and chip. */
function StatLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{children}</div>;
}

/**
 * Compact AI Issue Boards card, shared by the App Factory and QA workspace
 * listings. Leads with the application, not the raw execution identifier —
 * everything else lives one click away on the board itself.
 */
export function BoardCard({ board, href }: { board: BoardCardData; href: string }) {
  const [favourited, setFavourited] = useState(board.isFavourited);
  const [saving, setSaving] = useState(false);

  const meta = DISPLAY_STATUS_META[board.status] ?? DISPLAY_STATUS_META.open;
  const accent = accentFor(board.id);
  const remaining = Math.max(0, board.totalIssues - board.closedIssues);
  const progressPct = board.totalIssues === 0 ? 100 : Math.round((board.closedIssues / board.totalIssues) * 100);
  const version = board.buildVersion ? (board.buildVersion.startsWith('v') ? board.buildVersion : `v${board.buildVersion}`) : null;

  async function toggleFavourite(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (saving) return;
    const next = !favourited;
    setFavourited(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/app-factory/issue-boards/${board.id}`, { method: 'PATCH' });
      const data = await res.json();
      if (data.error) setFavourited(!next);
    } catch {
      setFavourited(!next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Link href={href} className="group block h-full">
      <Card className="flex h-full flex-col border-border bg-card/60 p-5 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-card hover:shadow-lg">
        {/* Header: avatar + title ... favourite + status badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            {board.applicationIconDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={board.applicationIconDataUrl}
                alt=""
                className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-border"
              />
            ) : (
              <div className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg text-sm font-semibold ring-1 ring-border', accent.avatarBg, accent.avatarText)}>
                {initials2(board.applicationName || '?')}
              </div>
            )}
            <h3 className="min-w-0 truncate font-display text-sm font-semibold leading-snug group-hover:text-primary">
              {board.applicationName || 'Application'}
            </h3>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={toggleFavourite}
              title={favourited ? 'Remove from favourites' : 'Mark as favourite'}
              className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition hover:bg-primary/10 hover:text-amber-400"
            >
              <Star className={cn('h-3.5 w-3.5', favourited && 'fill-amber-400 text-amber-400')} />
            </button>
            <Badge className={cn('gap-1 text-[10px]', meta.badge)}>
              <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
              {meta.label}
            </Badge>
          </div>
        </div>

        {/* Platform + version tags */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn('border-transparent text-[10px]', PLATFORM_TAG[board.platform] ?? 'bg-secondary text-muted-foreground')}>
            {platformLabel(board.platform)}
          </Badge>
          {version && (
            <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
              <Tag className="h-2.5 w-2.5" /> {version}
            </Badge>
          )}
        </div>

        {/* Execution progress */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium text-muted-foreground">Execution Progress</span>
            <span className="font-semibold">{progressPct}%</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div className={cn('h-full rounded-full transition-all', meta.bar)} style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        {/* Issue summary */}
        <div className="mt-4 border-t border-border/60 pt-3.5">
          <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Issue Summary</div>
          <div className="mt-2 grid grid-cols-4 gap-1 text-center">
            <div>
              <div className="font-display text-base font-bold tabular-nums">{board.functionalIssues}</div>
              <StatLabel>Fun</StatLabel>
            </div>
            <div>
              <div className="font-display text-base font-bold tabular-nums">{board.uiIssues}</div>
              <StatLabel>UI</StatLabel>
            </div>
            <div>
              <div className="font-display text-base font-bold tabular-nums text-primary">{board.totalIssues}</div>
              <StatLabel>Total</StatLabel>
            </div>
            <div>
              <div className="font-display text-base font-bold tabular-nums text-muted-foreground">{remaining}</div>
              <StatLabel>Remaining</StatLabel>
            </div>
          </div>
        </div>

        {/* Closed / Reopened chips */}
        <div className="mt-3.5 grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-emerald-600 dark:text-emerald-400">
            <span className="text-sm">✓</span>
            <div className="leading-tight">
              <div className="text-sm font-bold tabular-nums">{board.closedIssues}</div>
              <StatLabel>Closed</StatLabel>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-amber-600 dark:text-amber-400">
            <RotateCcw className="h-3.5 w-3.5" />
            <div className="leading-tight">
              <div className="text-sm font-bold tabular-nums">{board.reopenedIssues}</div>
              <StatLabel>Reopened</StatLabel>
            </div>
          </div>
        </div>

        {/* Footer: timestamp + View */}
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/60 pt-3.5">
          <span className="text-[11px] text-muted-foreground">{formatRelativeShort(board.lastActivityAt)}</span>
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[11px] font-semibold shadow-sm transition',
              'group-hover:shadow-md group-hover:brightness-110 active:scale-[0.97]',
              accent.button,
            )}
          >
            View <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </Card>
    </Link>
  );
}
