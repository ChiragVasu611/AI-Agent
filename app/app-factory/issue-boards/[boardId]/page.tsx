'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, CalendarClock, CheckCircle2, Loader2, MessageSquare, Paperclip,
  RotateCcw, Search, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { moveIssueCard } from '../actions';
import { IssueBoardsBell } from '@/components/modules/app-factory/issue-boards/issue-boards-bell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  ISSUE_COLUMNS, MODULE_TYPE_LABEL, PRIORITIES, PRIORITY_BADGE, SEVERITIES,
  SEVERITY_BADGE, type IssueStatus,
} from '@/lib/issue-boards/constants';
import { cn } from '@/lib/utils';

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

export default function IssueBoardPage({ params }: { params: { boardId: string } }) {
  const { boardId } = params;
  const [board, setBoard] = useState<any>(null);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('all');
  const [priority, setPriority] = useState('all');
  const [label, setLabel] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<IssueStatus | null>(null);
  const [saving, setSaving] = useState(false);
  // Suppresses the poll from overwriting an optimistic move that is in flight.
  const pendingMove = useRef(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (severity !== 'all') params.set('severity', severity);
    if (priority !== 'all') params.set('priority', priority);
    if (label !== 'all') params.set('label', label);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    try {
      const res = await fetch(`/api/app-factory/issue-boards/${boardId}?${params.toString()}`, { cache: 'no-store' });
      if (res.status === 404) { setNotFound(true); return; }
      const data = await res.json();
      if (data.error) return;
      if (pendingMove.current) return;
      setBoard(data.board);
      setCards(data.cards ?? []);
      setLabels(data.labels ?? []);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [boardId, search, severity, priority, label, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const interval = setInterval(() => { load(true); }, 20000);
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

  /** Applies the drop locally, then persists the column and the new ordering. */
  async function handleDrop(toStatus: IssueStatus, beforeCardId: string | null) {
    const cardId = draggingId;
    setDraggingId(null);
    setDragOverColumn(null);
    if (!cardId) return;

    const moving = cards.find((c) => c.id === cardId);
    if (!moving) return;
    if (moving.status === toStatus && beforeCardId === cardId) return;

    const target = (byColumn.get(toStatus) ?? []).filter((c) => c.id !== cardId);
    const insertAt = beforeCardId ? target.findIndex((c) => c.id === beforeCardId) : target.length;
    const ordered = [...target];
    ordered.splice(insertAt < 0 ? ordered.length : insertAt, 0, { ...moving, status: toStatus });
    const orderedIds = ordered.map((c) => c.id);

    pendingMove.current = true;
    setSaving(true);
    setCards((prev) => prev.map((c) => {
      const idx = orderedIds.indexOf(c.id);
      if (c.id === cardId) return { ...c, status: toStatus, order: idx + 1 };
      return idx >= 0 ? { ...c, order: idx + 1 } : c;
    }));

    const res = await moveIssueCard(cardId, toStatus, orderedIds);
    pendingMove.current = false;
    setSaving(false);

    if (res?.error) {
      toast.error(res.error);
      load(true);
      return;
    }
    const columnLabel = ISSUE_COLUMNS.find((c) => c.key === toStatus)?.label ?? toStatus;
    toast.success(`${moving.issueKey} moved to ${columnLabel}`);
    load(true);
  }

  if (notFound) {
    return (
      <div className="p-8">
        <Card className="border-border bg-card/60 p-10 text-center backdrop-blur">
          <p className="text-sm font-medium">This board no longer exists.</p>
          <Link href="/app-factory/issue-boards" className="mt-3 inline-block text-xs text-primary hover:underline">
            Back to AI Issue Boards
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 p-4 sm:p-6">
      {/* Execution summary */}
      <Card className="border-border bg-card/60 p-4 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Link href="/app-factory/issue-boards">
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Back to boards">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="font-display text-lg font-semibold tracking-tight sm:text-xl">
                {board?.boardName ?? (loading ? 'Loading…' : 'Board')}
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Drag a card between columns to move the issue through the workflow. Open a card for QA evidence and AI analysis.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {saving && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> saving</span>}
            <IssueBoardsBell />
          </div>
        </div>

        {board && (
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 text-[11px] sm:grid-cols-4 xl:grid-cols-6">
            <div className="truncate"><span className="text-muted-foreground">Execution ID</span><div className="font-mono">#{board.executionId}</div></div>
            <div className="truncate"><span className="text-muted-foreground">Project</span><div className="truncate">{board.projectName || '—'}</div></div>
            <div className="truncate"><span className="text-muted-foreground">Application</span><div className="truncate">{board.applicationName || '—'}</div></div>
            <div className="truncate"><span className="text-muted-foreground">Module</span><div>{MODULE_TYPE_LABEL[board.moduleType] ?? board.moduleType}</div></div>
            <div className="truncate"><span className="text-muted-foreground">Platform</span><div className="capitalize">{board.platform || '—'}</div></div>
            <div className="truncate"><span className="text-muted-foreground">Device</span><div className="truncate" title={board.deviceName}>{board.deviceName || '—'}</div></div>
            <div className="truncate"><span className="text-muted-foreground">Build Version</span><div>{board.buildVersion || '—'}</div></div>
            <div className="truncate"><span className="text-muted-foreground">Execution Date</span>
              <div className="truncate">{board.executedAt ? new Date(board.executedAt).toLocaleString('en-US') : '—'}</div>
            </div>
            <div><span className="text-muted-foreground">Total Test Cases</span><div className="tabular-nums">{board.totalCases}</div></div>
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

      {/* Board search & filters */}
      <Card className="border-border bg-card/60 p-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-md border border-input bg-background px-3">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search issue ID, title, test case or developer..."
              className="h-full w-full bg-transparent text-xs outline-none"
            />
          </div>
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger className="h-9 w-[130px] text-xs"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any Severity</SelectItem>
              {SEVERITIES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="h-9 w-[120px] text-xs"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any Priority</SelectItem>
              {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p.toUpperCase()}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={label} onValueChange={setLabel}>
            <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue placeholder="Label" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any Label</SelectItem>
              {labels.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-[145px] text-xs" title="Created from" />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-[145px] text-xs" title="Created to" />
        </div>
      </Card>

      {/* Kanban */}
      {loading ? (
        <Card className="border-border bg-card/40 p-10 text-center text-sm text-muted-foreground backdrop-blur">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading board…
        </Card>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-3">
          {ISSUE_COLUMNS.map((col) => {
            const columnCards = byColumn.get(col.key) ?? [];
            return (
              <div
                key={col.key}
                onDragOver={(e) => { e.preventDefault(); setDragOverColumn(col.key); }}
                onDragLeave={() => setDragOverColumn((c) => (c === col.key ? null : c))}
                onDrop={(e) => { e.preventDefault(); handleDrop(col.key, null); }}
                className={cn(
                  'flex w-[300px] shrink-0 flex-col rounded-xl border bg-card/40 backdrop-blur transition',
                  dragOverColumn === col.key ? 'border-primary/60 bg-primary/5' : 'border-border',
                )}
              >
                <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                  <span className={cn('h-2 w-2 rounded-full', col.accent)} />
                  <span className="text-sm">{col.emoji}</span>
                  <span className="font-display text-sm font-semibold">{col.label}</span>
                  <Badge variant="secondary" className="ml-auto text-[10px] tabular-nums">{columnCards.length}</Badge>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto p-2 scrollbar-thin">
                  {columnCards.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-[11px] text-muted-foreground">
                      Drop a card here
                    </div>
                  ) : columnCards.map((card) => {
                    const due = dueLabel(card.dueDate);
                    return (
                      <div
                        key={card.id}
                        draggable
                        onDragStart={() => setDraggingId(card.id)}
                        onDragEnd={() => setDraggingId(null)}
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverColumn(col.key); }}
                        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop(col.key, card.id); }}
                        className={cn(
                          'cursor-grab rounded-lg border border-border bg-card p-2.5 shadow-sm transition active:cursor-grabbing',
                          'hover:border-primary/50 hover:shadow-md',
                          draggingId === card.id && 'opacity-40',
                        )}
                      >
                        <Link href={`/app-factory/issue-boards/${boardId}/issues/${card.id}`} className="block">
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
                            <Badge className={cn('text-[9px] uppercase', PRIORITY_BADGE[card.priority] ?? '')}>
                              {card.priority}
                            </Badge>
                            <Badge className={cn('text-[9px] capitalize', SEVERITY_BADGE[card.severity] ?? '')}>
                              {card.severity}
                            </Badge>
                            {card.labels.slice(0, 2).map((l) => (
                              <Badge key={l} variant="outline" className="text-[9px]">{l}</Badge>
                            ))}
                            {card.labels.length > 2 && (
                              <Badge variant="outline" className="text-[9px]">+{card.labels.length - 2}</Badge>
                            )}
                          </div>

                          <div className="mt-2.5 flex items-center gap-2 border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
                            {card.assignedToName ? (
                              <Avatar className="h-5 w-5" title={card.assignedToName}>
                                <AvatarFallback className="bg-primary/15 text-[8px] text-primary">
                                  {initials(card.assignedToName)}
                                </AvatarFallback>
                              </Avatar>
                            ) : (
                              <span className="grid h-5 w-5 place-items-center rounded-full border border-dashed border-border text-[8px]" title="Unassigned">
                                —
                              </span>
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
                        </Link>
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
