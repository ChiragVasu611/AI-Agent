'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'bg-destructive/15 text-destructive',
  high: 'bg-amber-500/15 text-amber-600',
  medium: 'bg-yellow-500/15 text-yellow-600',
  low: 'bg-secondary text-muted-foreground',
};

export function BugCard({ bug }: { bug: any }) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="border-border bg-card/60 p-4 backdrop-blur">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start justify-between gap-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className={cn('text-[10px] capitalize', SEVERITY_COLOR[bug.severity])}>{bug.severity}</Badge>
            <Badge variant="outline" className="text-[10px] uppercase">{bug.priority}</Badge>
            <Badge variant="secondary" className="text-[10px] capitalize">{bug.type}</Badge>
            <span className="text-[10px] text-muted-foreground">{bug.module}</span>
          </div>
          <div className="mt-1.5 truncate text-sm font-medium">{bug.title}</div>
          <div className="truncate text-xs text-muted-foreground">Screen: {bug.screenName}</div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>

      {open && (
        <div className="mt-4 space-y-3 border-t border-border pt-4 text-xs">
          {bug.screenshotDataUrl && (
            <img src={bug.screenshotDataUrl} alt={bug.screenName} className="h-40 w-auto rounded-lg border border-border" />
          )}
          <div>
            <div className="mb-1 font-semibold text-muted-foreground">Description</div>
            <p>{bug.description}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 font-semibold text-muted-foreground">Expected Result</div>
              <p>{bug.expectedResult}</p>
            </div>
            <div>
              <div className="mb-1 font-semibold text-muted-foreground">Actual Result</div>
              <p>{bug.actualResult}</p>
            </div>
          </div>
          <div>
            <div className="mb-1 font-semibold text-muted-foreground">Steps to Reproduce</div>
            <ol className="list-inside list-decimal space-y-0.5">
              {bug.stepsToReproduce.map((s: string, i: number) => <li key={i}>{s}</li>)}
            </ol>
          </div>
          <div>
            <div className="mb-1 font-semibold text-muted-foreground">AI Root Cause Analysis</div>
            <p>{bug.aiRootCause}</p>
          </div>
          <div>
            <div className="mb-1 font-semibold text-muted-foreground">Suggested Fix</div>
            <p>{bug.suggestedFix}</p>
          </div>
          {bug.stackTrace && (
            <div>
              <div className="mb-1 font-semibold text-muted-foreground">Stack Trace</div>
              <pre className="overflow-x-auto rounded-lg bg-secondary/40 p-2 text-[10px]">{bug.stackTrace}</pre>
            </div>
          )}
          <div>
            <div className="mb-1 font-semibold text-muted-foreground">Logs</div>
            <pre className="overflow-x-auto rounded-lg bg-secondary/40 p-2 text-[10px]">{bug.logs}</pre>
          </div>
        </div>
      )}
    </Card>
  );
}
