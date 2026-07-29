'use client';

import { KanbanSquare } from 'lucide-react';
import { IssueSummaryWidgets } from '@/components/modules/app-factory/issue-boards/issue-summary-widgets';
import { BoardsBrowser } from '@/components/modules/app-factory/issue-boards/boards-browser';

/**
 * QA's own view of AI Issue Boards — read-only, no App Factory access
 * required. Same browsing experience (tabs, search, filter, sort, favourites)
 * as the App Factory module, just linking into the /qa board detail route.
 */
export default function QaIssueBoardsPage() {
  return (
    <div className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-6">
        <div className="pointer-events-none absolute -right-20 -top-20 h-52 w-52 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
            <KanbanSquare className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">AI Issue Boards</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Every board created automatically from your test executions — open one to review or retest its issues.
            </p>
          </div>
        </div>
      </header>

      <IssueSummaryWidgets linkToModule={false} />

      <BoardsBrowser basePath="/qa/issue-boards" />
    </div>
  );
}
