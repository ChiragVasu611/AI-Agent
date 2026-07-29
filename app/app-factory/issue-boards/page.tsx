'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { BarChart3, KanbanSquare, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { syncIssueBoardsNow } from './actions';
import { IssueSummaryWidgets } from '@/components/modules/app-factory/issue-boards/issue-summary-widgets';
import { IssueBoardsBell } from '@/components/modules/app-factory/issue-boards/issue-boards-bell';
import { BoardsBrowser } from '@/components/modules/app-factory/issue-boards/boards-browser';
import { Button } from '@/components/ui/button';

export default function IssueBoardsPage() {
  const [syncing, startSync] = useTransition();
  const [refreshSignal, setRefreshSignal] = useState(0);

  function onSync() {
    startSync(async () => {
      const res = await syncIssueBoardsNow();
      if (res?.error) toast.error(res.error);
      else {
        toast.success(res?.created ? `${res.created} new board(s) created.` : 'Boards are up to date.');
        setRefreshSignal((n) => n + 1);
      }
    });
  }

  return (
    <div className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-6">
        <div className="pointer-events-none absolute -right-20 -top-20 h-52 w-52 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
              <KanbanSquare className="h-6 w-6" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">AI Issue Boards</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Every completed test execution becomes its own developer board automatically — issues are detected,
                cards are created, and nothing needs to be filed by hand.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <IssueBoardsBell />
            <Link href="/app-factory/issue-boards/reports">
              <Button variant="outline" size="sm" className="h-9 gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" /> Reports
              </Button>
            </Link>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={syncing} onClick={onSync}>
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <IssueSummaryWidgets linkToModule={false} />

      <BoardsBrowser basePath="/app-factory/issue-boards" refreshSignal={refreshSignal} />
    </div>
  );
}
