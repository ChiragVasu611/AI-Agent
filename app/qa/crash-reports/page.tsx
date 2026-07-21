'use client';

import { useEffect, useState } from 'react';
import { BugCard } from '@/components/modules/qa/bug-card';
import { Card } from '@/components/ui/card';

export default function CrashReportsPage() {
  const [bugs, setBugs] = useState<any[] | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/qa/bugs?type=crash').then((r) => r.json()),
      fetch('/api/qa/bugs?type=anr').then((r) => r.json()),
    ]).then(([crash, anr]) => {
      const combined = [...(crash.bugs ?? []), ...(anr.bugs ?? [])]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setBugs(combined);
    });
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Crash Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every crash and ANR detected across all test runs.</p>
      </div>

      {bugs == null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : bugs.length === 0 ? (
        <Card className="border-dashed border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
          No crashes or ANRs detected yet.
        </Card>
      ) : (
        <div className="grid gap-3">
          {bugs.map((b) => <BugCard key={b.id} bug={b} />)}
        </div>
      )}
    </div>
  );
}
