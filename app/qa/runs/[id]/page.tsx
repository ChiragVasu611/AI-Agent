'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Battery, Clock, Cpu, MemoryStick, Signal, Smartphone,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { LiveConsole } from '@/components/modules/qa/live-console';
import { BugCard } from '@/components/modules/qa/bug-card';

function elapsedLabel(startedAt: string | null): string {
  if (!startedAt) return '—';
  const secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

const STATUS_COLOR: Record<string, string> = {
  queued: 'bg-secondary text-muted-foreground',
  running: 'bg-primary/15 text-primary',
  passed: 'bg-success/15 text-success',
  failed: 'bg-destructive/15 text-destructive',
  cancelled: 'bg-secondary text-muted-foreground',
};

export default function QaRunPage() {
  const params = useParams();
  const runId = params.id as string;
  const [run, setRun] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [screenshots, setScreenshots] = useState<any[]>([]);
  const [bugs, setBugs] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [runRes, logsRes, shotsRes, bugsRes] = await Promise.all([
        fetch(`/api/qa/runs/${runId}`).then((r) => r.json()),
        fetch(`/api/qa/logs?runId=${runId}`).then((r) => r.json()),
        fetch(`/api/qa/screenshots?runId=${runId}`).then((r) => r.json()),
        fetch(`/api/qa/bugs?runId=${runId}`).then((r) => r.json()),
      ]);
      if (cancelled) return;
      setRun(runRes.run);
      setLogs(logsRes.logs ?? []);
      setScreenshots(shotsRes.screenshots ?? []);
      setBugs(bugsRes.bugs ?? []);
    }
    load();
    const interval = setInterval(load, 1500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [runId]);

  if (!run) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading run…</div>;
  }

  const isLive = run.status === 'running' || run.status === 'queued';

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <div className="flex items-center gap-3">
        <Link href="/qa" className="text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="font-display text-xl font-semibold tracking-tight">{run.project?.name ?? 'Test Run'}</h1>
          <p className="text-xs text-muted-foreground">{run.modules?.length ?? 0} module(s) · {run.project?.sourceType}</p>
        </div>
        <Badge className={STATUS_COLOR[run.status]}>{run.status}</Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Live Execution Monitoring */}
        <Card className="border-border bg-card/60 p-5 backdrop-blur lg:col-span-2">
          <h2 className="mb-3 font-display text-sm font-semibold">Live Execution Monitoring</h2>
          <div className="mb-3">
            <Progress value={run.progress} className="h-2" />
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span>{run.currentStep ?? 'Waiting to start'}</span>
              <span>{run.progress}%</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
            <div><div className="text-muted-foreground">Project</div><div className="font-medium">{run.project?.name ?? '—'}</div></div>
            <div><div className="text-muted-foreground">Suite</div><div className="font-medium">{run.currentSuite ?? '—'}</div></div>
            <div><div className="text-muted-foreground">Test Case</div><div className="font-medium">{run.currentCase ?? '—'}</div></div>
            <div><div className="text-muted-foreground">Screen</div><div className="font-medium">{run.currentScreen ?? '—'}</div></div>
            <div><div className="text-muted-foreground">Feature</div><div className="font-medium">{run.currentFeature ?? '—'}</div></div>
            <div><div className="text-muted-foreground">Device</div><div className="font-medium">{run.currentDevice ?? '—'}</div></div>
            <div><div className="text-muted-foreground">Elapsed</div><div className="font-medium">{elapsedLabel(run.startedAt)}</div></div>
            <div><div className="text-muted-foreground">Start Time</div><div className="font-medium">{run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : '—'}</div></div>
            <div><div className="text-muted-foreground">Status</div><div className="font-medium capitalize">{run.status}</div></div>
          </div>
        </Card>

        {/* Live Device Preview (stub) */}
        <Card className="border-border bg-card/60 p-5 backdrop-blur">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold">Live Device Preview</h2>
            <Badge variant="secondary" className="text-[10px]">Simulated</Badge>
          </div>
          <div className="grid aspect-[9/16] max-h-64 place-items-center rounded-xl border border-dashed border-border bg-secondary/20">
            <Smartphone className="h-10 w-10 text-muted-foreground" />
          </div>
          <div className="mt-3 space-y-1.5 text-xs">
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Device</span><span>{run.currentDevice ?? '—'}</span></div>
            <div className="flex items-center justify-between"><span className="flex items-center gap-1 text-muted-foreground"><Battery className="h-3 w-3" /> Battery</span><span>{isLive ? '78%' : '—'}</span></div>
            <div className="flex items-center justify-between"><span className="flex items-center gap-1 text-muted-foreground"><Cpu className="h-3 w-3" /> CPU</span><span>{isLive ? '34%' : '—'}</span></div>
            <div className="flex items-center justify-between"><span className="flex items-center gap-1 text-muted-foreground"><MemoryStick className="h-3 w-3" /> Memory</span><span>{isLive ? '512 MB' : '—'}</span></div>
            <div className="flex items-center justify-between"><span className="flex items-center gap-1 text-muted-foreground"><Signal className="h-3 w-3" /> Network</span><span>{isLive ? 'Wi-Fi' : '—'}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Resolution</span><span>1080x2400</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Orientation</span><span>Portrait</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Status</span><span>{isLive ? 'Online' : 'Offline'}</span></div>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            No device farm is connected. This panel reflects the simulated run state, not a real device stream.
          </p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border bg-card/60 p-5 backdrop-blur">
          <h2 className="mb-3 flex items-center gap-1.5 font-display text-sm font-semibold"><Clock className="h-4 w-4" /> Live Console</h2>
          <div className="h-80">
            <LiveConsole logs={logs} />
          </div>
        </Card>

        <Card className="border-border bg-card/60 p-5 backdrop-blur">
          <h2 className="mb-3 font-display text-sm font-semibold">Screenshot Timeline</h2>
          <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto">
            {screenshots.length === 0 && <p className="col-span-3 py-8 text-center text-xs text-muted-foreground">No screenshots yet.</p>}
            {screenshots.map((s) => (
              <div key={s.id} className="overflow-hidden rounded-lg border border-border">
                <img src={s.imageDataUrl} alt={s.screenName} className="h-24 w-full object-cover" />
                <div className="p-1.5">
                  <div className="truncate text-[10px] font-medium">{s.screenName}</div>
                  <div className="truncate text-[9px] text-muted-foreground">{new Date(s.createdAt).toLocaleTimeString()}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 font-display text-lg font-semibold">Bugs Found ({bugs.length})</h2>
        {bugs.length === 0 ? (
          <Card className="border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
            No bugs detected yet.
          </Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {bugs.map((b) => <BugCard key={b.id} bug={b} />)}
          </div>
        )}
      </div>
    </div>
  );
}
