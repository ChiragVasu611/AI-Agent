'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, CalendarClock, CheckCircle2, Loader2, MessageSquare, Paperclip, RotateCcw, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  ISSUE_COLUMNS, MODULE_TYPE_LABEL, PRIORITY_BADGE, SEVERITY_BADGE, type IssueStatus,
} from '@/lib/issue-boards/constants';
import { cn } from '@/lib/utils';

/**
 * A left-edge accent bar keyed by severity — the same at-a-glance triage cue
 * Jira/Linear-style Kanban cards use, so the most severe issues in a column
 * are visually distinct before reading any badge text. Written as complete,
 * literal class strings (not built by concatenating a colour name) so
 * Tailwind's static scanner can actually find them. Mirrors the same lookup
 * in the App Factory board so both views read identically.
 */
const SEVERITY_ACCENT: Record<string, string> = {
  critical: 'border-l-4 border-l-destructive',
  high: 'border-l-4 border-l-orange-500',
  medium: 'border-l-4 border-l-amber-500',
  low: 'border-l-4 border-l-border',
};

interface KanbanCard {
  id: string;
  issueKey: string;
  title: string;
  status: IssueStatus;
  severity: string;
  priority: string;
  labels: string[];
  order: number;
  assignedToName: string;
  dueDate: string | null;
  commentCount: number;
  attachmentCount: number;
  reopenCount: number;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function dueLabel(iso: string | null): { text: string; overdue: boolean } | null {
  if (!iso) return null;
  const date = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return {
    text: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    overdue: date < today,
  };
}

/**
 * QA's read-only view of one board's Kanban — same live data as the App
 * Factory board, but without drag-and-drop editing (that stays a developer
 * action) so QA can watch progress without needing App Factory access.
 */
export default function QaIssueBoardPage({ params }: { params: { boardId: string } }) {
  const { boardId } = params;
  const [board, setBoard] = useState<any>(null);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await fetch(`/api/app-factory/issue-boards/${boardId}`, { cache: 'no-store' });
      if (res.status === 404) { setNotFound(true); return; }
      const data = await res.json();
      if (data.error) return;
      setBoard(data.board);
      setCards(data.cards ?? []);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [boardId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const interval = setInterval(() => load(true), 15000);
    return () => clearInterval(interval);
  }, [load]);

  const byColumn = useMemo(() => {
    const map = new Map<IssueStatus, KanbanCard[]>();
    for (const col of ISSUE_COLUMNS) map.set(col.key, []);
    for (const card of cards) {
      const list = map.get(card.status);
      if (list) list.push(card);
    }
    for (const col of ISSUE_COLUMNS) {
      map.get(col.key)?.sort((a, b) => a.order - b.order || a.issueKey.localeCompare(b.issueKey));
    }
    return map;
  }, [cards]);

  if (notFound) {
    return (
      <div className="p-8">
        <Card className="border-border bg-card/60 p-10 text-center backdrop-blur">
          <p className="text-sm font-medium">This board no longer exists.</p>
          <Link href="/qa/issue-boards" className="mt-3 inline-block text-xs text-primary hover:underline">
            Back to AI Issue Boards
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 p-4 sm:p-6">
      <Card className="border-border bg-card/60 p-4 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Link href="/qa/issue-boards">
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Back to boards">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="font-display text-lg font-semibold tracking-tight sm:text-xl">
                {board?.boardName ?? (loading ? 'Loading…' : 'Board')}
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Live view — updates automatically as developers move issues through the workflow.
              </p>
            </div>
          </div>
        </div>

        {board && (
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 text-[11px] sm:grid-cols-4 xl:grid-cols-6">
            <div className="truncate"><span className="text-muted-foreground">Execution ID</span><div className="font-mono">#{board.executionId}</div></div>
            <div className="truncate"><span className="text-muted-foreground">Project</span><div className="truncate">{board.projectName || '—'}</div></div>
            <div className="truncate"><span className="text-muted-foreground">Application</span><div className="truncate">{board.applicationName || '—'}</div></div>
            <div className="truncate"><span className="text-muted-foreground">Module</span><div>{MODULE_TYPE_LABEL[board.moduleType] ?? board.moduleType}</div></div>
            <div><span className="text-muted-foreground">Passed</span>
              <div className="flex items-center gap-1 tabular-nums text-emerald-500"><CheckCircle2 className="h-3 w-3" />{board.passedCases}</div>
            </div>
            <div><span className="text-muted-foreground">Failed</span>
              <div className="flex items-center gap-1 tabular-nums text-destructive"><XCircle className="h-3 w-3" />{board.failedCases}</div>
            </div>
            <div><span className="text-muted-foreground">Total Issues</span><div className="tabular-nums text-primary">{board.totalIssues}</div></div>
          </div>
        )}
      </Card>

      {loading ? (
        <Card className="border-border bg-card/40 p-10 text-center text-sm text-muted-foreground backdrop-blur">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading board…
        </Card>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-3">
          {ISSUE_COLUMNS.map((col) => {
            const columnCards = byColumn.get(col.key) ?? [];
            return (
              <div key={col.key} className="flex w-[300px] shrink-0 flex-col rounded-xl border border-border bg-muted/30 shadow-sm backdrop-blur">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                  <span className={cn('h-2 w-2 rounded-full', col.accent)} />
                  <span className="text-sm">{col.emoji}</span>
                  <span className="font-display text-sm font-semibold">{col.label}</span>
                  <Badge variant="secondary" className="ml-auto text-[10px] tabular-nums">{columnCards.length}</Badge>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto p-2 scrollbar-thin">
                  {columnCards.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-[11px] text-muted-foreground">
                      No issues
                    </div>
                  ) : columnCards.map((card) => {
                    const due = dueLabel(card.dueDate);
                    return (
                      <div
                        key={card.id}
                        className={cn(
                          'rounded-lg border border-border bg-card p-2.5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
                          SEVERITY_ACCENT[card.severity],
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] text-muted-foreground">{card.issueKey}</span>
                          {card.reopenCount > 0 && (
                            <span className="flex items-center gap-0.5 text-[10px] text-rose-500" title={`Reopened ${card.reopenCount}×`}>
                              <RotateCcw className="h-3 w-3" />{card.reopenCount}
                            </span>
                          )}
                        </div>

                        <p className="mt-1 line-clamp-2 text-xs font-medium leading-snug">{card.title}</p>

                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          <Badge className={cn('text-[9px] uppercase', PRIORITY_BADGE[card.priority] ?? '')}>{card.priority}</Badge>
                          <Badge className={cn('text-[9px] capitalize', SEVERITY_BADGE[card.severity] ?? '')}>{card.severity}</Badge>
                          {card.labels.slice(0, 2).map((l) => (
                            <Badge key={l} variant="outline" className="text-[9px]">{l}</Badge>
                          ))}
                        </div>

                        <div className="mt-2.5 flex items-center gap-2 border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
                          {card.assignedToName ? (
                            <Avatar className="h-5 w-5" title={card.assignedToName}>
                              <AvatarFallback className="bg-primary/15 text-[8px] text-primary">
                                {initials(card.assignedToName)}
                              </AvatarFallback>
                            </Avatar>
                          ) : (
                            <span className="grid h-5 w-5 place-items-center rounded-full border border-dashed border-border text-[8px]" title="Unassigned">—</span>
                          )}
                          {due && (
                            <span className={cn('flex items-center gap-0.5', due.overdue && 'text-destructive')} title="Due date">
                              <CalendarClock className="h-3 w-3" />{due.text}
                            </span>
                          )}
                          <span className="ml-auto flex items-center gap-0.5" title="Comments">
                            <MessageSquare className="h-3 w-3" />{card.commentCount}
                          </span>
                          <span className="flex items-center gap-0.5" title="Attachments">
                            <Paperclip className="h-3 w-3" />{card.attachmentCount}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
