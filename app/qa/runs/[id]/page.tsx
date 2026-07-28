'use client';

import { useEffect, useState, useTransition } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowLeft, Battery, Bug as BugIcon, Clock, Cpu,
  CheckCircle2, XCircle, ShieldAlert, SkipForward, Hourglass, Globe, Gauge, MemoryStick, Signal, Smartphone, Loader2, Trash2, Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { deleteQaTestRun, cancelQaTestRun } from '@/app/qa/runs/actions';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LiveConsole } from '@/components/modules/qa/live-console';
import { BugCard } from '@/components/modules/qa/bug-card';

const BUG_CATEGORIES = [
  'functional', 'ui', 'api', 'performance', 'security', 'crash', 'anr', 'accessibility', 'compatibility',
];

const STATUS_BADGE: Record<string, string> = {
  pass: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  fail: 'bg-red-500/15 text-red-500 border-red-500/30',
  blocked: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  skipped: 'bg-secondary text-muted-foreground',
  pending: 'bg-sky-500/15 text-sky-500 border-sky-500/30',
};

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
  partial: 'bg-amber-500/15 text-amber-500',
  cancelled: 'bg-secondary text-muted-foreground',
};

export default function QaRunPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.id as string;
  const [deleting, startDelete] = useTransition();
  const [, startCancel] = useTransition();
  /** Set as soon as the user asks to stop, so the button can't be pressed twice
   *  while the engine finishes its current step and reports back. */
  const [stopping, setStopping] = useState(false);
  const [run, setRun] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [screenshots, setScreenshots] = useState<any[]>([]);
  const [bugs, setBugs] = useState<any[]>([]);
  const [testCases, setTestCases] = useState<any[]>([]);
  const [detailTab, setDetailTab] = useState('results');

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Self-scheduling poll: the next cycle is queued only AFTER the current one
    // resolves, so batches never overlap and pile up (which was exhausting the
    // browser's connection/memory pool → ERR_INSUFFICIENT_RESOURCES). Polling
    // stops once the run reaches a terminal state and backs off on error.
    async function load() {
      let live = false;
      try {
        const [runRes, logsRes, shotsRes, bugsRes, tcRes] = await Promise.all([
          fetch(`/api/qa/runs/${runId}`).then((r) => r.json()),
          fetch(`/api/qa/logs?runId=${runId}`).then((r) => r.json()),
          fetch(`/api/qa/screenshots?runId=${runId}`).then((r) => r.json()),
          fetch(`/api/qa/bugs?runId=${runId}`).then((r) => r.json()),
          fetch(`/api/qa/test-cases?runId=${runId}`).then((r) => r.json()),
        ]);
        if (cancelled) return;
        setRun(runRes.run);
        setLogs(logsRes.logs ?? []);
        setScreenshots(shotsRes.screenshots ?? []);
        setBugs(bugsRes.bugs ?? []);
        setTestCases(tcRes.testCases ?? []);
        const status = runRes.run?.status;
        live = status === 'running' || status === 'queued';
        // Nothing to keep polling for once the run is finished (or gone).
        if (!runRes.run || !live) return;
        timer = setTimeout(load, 1500);
      } catch {
        // A poll can fail because the run was just deleted, the page is
        // navigating away, or a transient network hiccup. Don't surface it as
        // an unhandled error; back off and retry (unless we're unmounting).
        if (!cancelled) timer = setTimeout(load, 3000);
      }
    }
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [runId]);

  if (!run) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading run…</div>;
  }

  const isLive = run.status === 'running' || run.status === 'queued';
  // The Stop control only makes sense once execution has actually started.
  const isRunning = run.status === 'running';
  // Disabled once a stop is requested here, or already recorded server-side.
  const stopRequested = stopping || run.status === 'cancelled' || run.currentStep === 'Cancelling…';

  function onDelete() {
    if (!confirm(`Delete Run #${run.runNumber}? This removes its bugs, logs, screenshots, and test case results. This cannot be undone.`)) return;
    startDelete(async () => {
      const res = await deleteQaTestRun(runId);
      if (res?.error) toast.error(res.error);
      else { toast.success('Test run deleted'); router.push('/qa/runs'); }
    });
  }

  function onStop() {
    if (!confirm(`Stop Run #${run.runNumber}? The run will end now and any partial results collected so far are saved.`)) return;
    setStopping(true);
    startCancel(async () => {
      const res = await cancelQaTestRun(runId);
      if (res?.error) setStopping(false); // let the user retry if it didn't take
      if (res?.error) toast.error(res.error);
      else toast.success('Stopping run…');
    });
  }

  const bugsByCategory = new Map<string, any[]>();
  BUG_CATEGORIES.forEach((c) => bugsByCategory.set(c, []));
  bugs.forEach((b) => { if (bugsByCategory.has(b.type)) bugsByCategory.get(b.type)!.push(b); });

  const executionTimeline = screenshots
    .map((s) => ({ ...s, testCase: testCases.find((t) => (t.scenario ?? t.name) === s.testStep) }))
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((s, i, arr) => ({
      ...s,
      stepNumber: i + 1,
      durationSeconds: i > 0 ? Math.max(0, Math.round((new Date(s.createdAt).getTime() - new Date(arr[i - 1].createdAt).getTime()) / 1000)) : null,
    }));

  const evaluatedCases = testCases.filter((t) => (t.result ?? '') !== 'pending');
  const avgExecutionSeconds = (() => {
    const times = evaluatedCases.map((t) => new Date(t.createdAt).getTime()).sort((a, b) => a - b);
    if (times.length < 2) return null;
    const diffs: number[] = [];
    for (let i = 1; i < times.length; i++) diffs.push((times[i] - times[i - 1]) / 1000);
    return diffs.reduce((a, b) => a + b, 0) / diffs.length;
  })();

  // The simulation view adapts to the type of testing being executed:
  // web/browser tests show a landscape browser frame (full page, no crop),
  // mobile tests show a portrait phone frame.
  const testTarget = String(run.project?.sourceType ?? run.project?.platform ?? '').toLowerCase();
  const isBrowser = run.engineMode === 'real_browser'
    || ['web_app', 'web_url', 'web'].includes(testTarget)
    || run.project?.platform === 'web';
  const isIOS = ['ipa', 'app_store_url'].includes(testTarget);
  const isRealDevice = run.engineMode === 'real_device';
  const isRealEngine = run.engineMode === 'real_browser' || run.engineMode === 'real_device';
  const latestShot = screenshots.length > 0 ? screenshots[screenshots.length - 1] : null;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <div className="flex items-center gap-3">
        <Link href="/qa/runs" className="text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="font-display text-xl font-semibold tracking-tight">{run.project?.name ?? 'Test Run'}</h1>
          <p className="text-xs text-muted-foreground">RUN-{run.runNumber} · {run.modules?.length ?? 0} module(s) · {run.project?.sourceType}</p>
        </div>
        {run.engineMode === 'real_browser' && <Badge variant="outline" className="text-[10px]">Real Browser Execution</Badge>}
        {isRealDevice && <Badge variant="outline" className="text-[10px]">Real Device Execution</Badge>}
        <Badge className={STATUS_COLOR[run.status]}>{run.status}</Badge>
        {/* Only shown once execution has actually started, and disabled as soon
            as a stop has been requested so it can't be pressed twice. */}
        {isRunning && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={stopRequested}
            onClick={onStop}
          >
            {stopRequested ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
            {stopRequested ? 'Stopping…' : 'Stop'}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-destructive hover:text-destructive"
          disabled={deleting}
          onClick={onDelete}
        >
          {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Delete
        </Button>
      </div>

      {/* Execution Summary + Device Information — unchanged from the original run monitor. */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="border-border bg-card/60 p-5 backdrop-blur lg:col-span-2">
          <h2 className="mb-3 font-display text-sm font-semibold">Execution Summary</h2>
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
            <div><div className="text-muted-foreground">Test Case</div><div className="truncate font-medium" title={run.currentCase ?? undefined}>{run.currentCase ?? '—'}</div></div>
            <div><div className="text-muted-foreground">Current Step</div><div className="truncate font-medium" title={run.currentStep ?? undefined}>{run.currentStep ?? '—'}</div></div>
            <div><div className="text-muted-foreground">Screen</div><div className="font-medium">{run.currentScreen ?? '—'}</div></div>
            <div><div className="text-muted-foreground">Feature</div><div className="font-medium">{run.currentFeature ?? '—'}</div></div>
            <div><div className="text-muted-foreground">Device</div><div className="font-medium">{run.currentDevice ?? '—'}</div></div>
            <div><div className="text-muted-foreground">Elapsed</div><div className="font-medium">{elapsedLabel(run.startedAt)}</div></div>
            <div><div className="text-muted-foreground">Status</div><div className="font-medium capitalize">{run.status}</div></div>
          </div>

          {run.sourceMode === 'uploaded' && (
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 text-xs sm:grid-cols-5">
              <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /><div><div className="text-muted-foreground">Passed</div><div className="font-medium">{run.passedCases}</div></div></div>
              <div className="flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5 text-red-500" /><div><div className="text-muted-foreground">Failed</div><div className="font-medium">{run.failedCases}</div></div></div>
              <div className="flex items-center gap-1.5"><ShieldAlert className="h-3.5 w-3.5 text-amber-500" /><div><div className="text-muted-foreground">Blocked</div><div className="font-medium">{run.blockedCases}</div></div></div>
              <div className="flex items-center gap-1.5"><SkipForward className="h-3.5 w-3.5 text-muted-foreground" /><div><div className="text-muted-foreground">Skipped</div><div className="font-medium">{run.skippedCases}</div></div></div>
              <div className="flex items-center gap-1.5"><Hourglass className="h-3.5 w-3.5 text-sky-500" /><div><div className="text-muted-foreground">ETA</div><div className="font-medium">{run.etaSeconds != null ? `${run.etaSeconds}s` : '—'}</div></div></div>
            </div>
          )}
        </Card>

        {/* Live Device/Browser Preview — adapts to the type of testing */}
        <Card className="border-border bg-card/60 p-5 backdrop-blur">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold">{isBrowser ? 'Live Browser Preview' : 'Live Device Preview'}</h2>
            <Badge variant="secondary" className="text-[10px]">{isRealEngine ? 'Real' : 'Simulated'}</Badge>
          </div>

          {isBrowser ? (
            <>
              {/* Landscape browser frame — full page shown with object-contain (no cropping) */}
              <div className="overflow-hidden rounded-xl border border-border bg-secondary/20">
                <div className="flex items-center gap-1.5 border-b border-border bg-secondary/40 px-3 py-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
                  <span className="ml-2 flex-1 truncate rounded-md bg-background/60 px-2 py-0.5 text-[10px] text-muted-foreground" title={run.currentScreen ?? undefined}>
                    {run.currentScreen ?? 'about:blank'}
                  </span>
                </div>
                <div className="grid aspect-[16/10] max-h-72 place-items-center overflow-hidden bg-white dark:bg-neutral-900">
                  {latestShot ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={latestShot.imageDataUrl} alt="Latest captured page" className="h-full w-full object-contain object-top" />
                  ) : (
                    <Globe className="h-10 w-10 text-muted-foreground" />
                  )}
                </div>
              </div>
              <div className="mt-3 space-y-1.5 text-xs">
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Engine</span><span className="truncate">{run.currentDevice ?? 'Headless Chromium'}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Current URL</span><span className="max-w-[65%] truncate" title={run.currentScreen ?? undefined}>{run.currentScreen ?? '—'}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Viewport</span><span>1366×900</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Pages Visited</span><span>{screenshots.length}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Status</span><span>{isLive ? 'Running' : 'Finished'}</span></div>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                {run.engineMode === 'real_browser'
                  ? 'Full page from the real headless Chromium session — shown complete, not cropped.'
                  : 'Simulated web run — the browser frame reflects the run state.'}
              </p>
            </>
          ) : (
            <>
              {/* Portrait phone frame — screenshot shown with object-contain (no cropping) */}
              <div className="mx-auto w-fit rounded-[1.75rem] border-[6px] border-neutral-800 bg-black p-1 shadow-lg">
                <div className="relative grid aspect-[9/16] max-h-72 w-40 place-items-center overflow-hidden rounded-[1.25rem] bg-secondary/20">
                  {latestShot ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={latestShot.imageDataUrl} alt="Latest device screenshot" className="h-full w-full object-contain" />
                  ) : (
                    <Smartphone className="h-10 w-10 text-muted-foreground" />
                  )}
                </div>
              </div>
              <div className="mt-3 space-y-1.5 text-xs">
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Platform</span><span>{isIOS ? 'iOS' : 'Android'}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Device</span><span>{run.currentDevice ?? '—'}</span></div>
                <div className="flex items-center justify-between"><span className="flex items-center gap-1 text-muted-foreground"><Battery className="h-3 w-3" /> Battery</span><span>{isLive ? '78%' : '—'}</span></div>
                <div className="flex items-center justify-between"><span className="flex items-center gap-1 text-muted-foreground"><Cpu className="h-3 w-3" /> CPU</span><span>{isLive ? '34%' : '—'}</span></div>
                <div className="flex items-center justify-between"><span className="flex items-center gap-1 text-muted-foreground"><MemoryStick className="h-3 w-3" /> Memory</span><span>{isLive ? '512 MB' : '—'}</span></div>
                <div className="flex items-center justify-between"><span className="flex items-center gap-1 text-muted-foreground"><Signal className="h-3 w-3" /> Network</span><span>{isLive ? 'Wi-Fi' : '—'}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Resolution</span><span>{isIOS ? '1170x2532' : '1080x2400'}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Orientation</span><span>Portrait</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Status</span><span>{isLive ? 'Online' : 'Offline'}</span></div>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                {isRealDevice
                  ? (latestShot
                    ? 'Live screenshot captured from the real connected device via ADB.'
                    : 'Installing and launching the app on the connected device…')
                  : (latestShot
                    ? 'Latest captured device screenshot — shown complete, not cropped.'
                    : 'No device farm connected — this panel reflects the simulated run state.')}
              </p>
            </>
          )}
        </Card>
      </div>

      {run.project?.appPackageName && (
        <Card className="border-border bg-card/60 p-5 backdrop-blur">
          <h2 className="mb-3 font-display text-sm font-semibold">App Info</h2>
          <div className="flex items-start gap-4">
            {run.project.appIconDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={run.project.appIconDataUrl} alt="App icon" className="h-14 w-14 flex-shrink-0 rounded-xl border border-border object-cover" />
            )}
            <div className="grid flex-1 grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div><div className="text-muted-foreground">Display Name</div><div className="font-medium">{run.project.appDisplayName ?? '—'}</div></div>
              <div><div className="text-muted-foreground">Package / Bundle ID</div><div className="truncate font-medium" title={run.project.appPackageName ?? undefined}>{run.project.appPackageName ?? '—'}</div></div>
              <div><div className="text-muted-foreground">Version</div><div className="font-medium">{run.project.appVersionName ?? '—'}</div></div>
              <div><div className="text-muted-foreground">Version Code</div><div className="font-medium">{run.project.appVersionCode ?? '—'}</div></div>
              {run.project.sourceFileName && (
                <div className="col-span-2"><div className="text-muted-foreground">File</div><div className="font-medium">{run.project.sourceFileName} {run.project.fileSizeBytes ? `(${(run.project.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB)` : ''}</div></div>
              )}
            </div>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Extracted directly from the uploaded binary — not fabricated.
          </p>
        </Card>
      )}

      {/* Detailed run report — Test Case Results / AI Bug Report / Screenshots / Execution Timeline / Performance Metrics / Live Logs */}
      <Card className="border-border bg-card/60 backdrop-blur">
        <Tabs value={detailTab} onValueChange={setDetailTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="results">Test Case Results</TabsTrigger>
            <TabsTrigger value="bugs">AI Bug Report ({bugs.length})</TabsTrigger>
            <TabsTrigger value="screenshots">Screenshots</TabsTrigger>
            <TabsTrigger value="timeline">Execution Timeline</TabsTrigger>
            <TabsTrigger value="performance">Performance Metrics</TabsTrigger>
            <TabsTrigger value="logs">Live Logs</TabsTrigger>
          </TabsList>

          <TabsContent value="results" className="max-h-[500px] overflow-y-auto p-5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test Case ID</TableHead><TableHead>Scenario</TableHead><TableHead>Module</TableHead>
                  <TableHead>Status</TableHead><TableHead>Expected</TableHead><TableHead>Actual</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {testCases.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">No test case results recorded for this run.</TableCell></TableRow>
                ) : testCases.map((t: any) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.testCaseId}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs">{t.scenario ?? t.name}</TableCell>
                    <TableCell className="text-xs">{t.module}</TableCell>
                    <TableCell><Badge className={`${STATUS_BADGE[t.result] ?? ''} text-[10px]`}>{t.result}</Badge></TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">{t.expectedResult ?? '—'}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">{t.actualResult ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>

          <TabsContent value="bugs" className="max-h-[500px] overflow-y-auto p-5">
            {bugs.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No bugs detected in this run.</p>
            ) : (
              <div className="space-y-5">
                {BUG_CATEGORIES.filter((c) => (bugsByCategory.get(c)?.length ?? 0) > 0).map((c) => (
                  <div key={c}>
                    <div className="mb-2 flex items-center gap-2">
                      <h3 className="text-sm font-semibold capitalize">{c}</h3>
                      <Badge variant="secondary" className="text-[10px]">{bugsByCategory.get(c)!.length}</Badge>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {bugsByCategory.get(c)!.map((b) => <BugCard key={b.id} bug={b} />)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="screenshots" className="max-h-[500px] overflow-y-auto p-5">
            {screenshots.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No screenshots captured for this run.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {screenshots.map((s: any) => (
                  <div key={s.id} className="overflow-hidden rounded-lg border border-border">
                    <img src={s.imageDataUrl} alt={s.screenName} className="h-28 w-full object-cover" />
                    <div className="p-1.5">
                      <div className="truncate text-[10px] font-medium">{s.screenName}</div>
                      <div className="truncate text-[9px] text-muted-foreground">{new Date(s.createdAt).toLocaleTimeString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="timeline" className="max-h-[500px] overflow-y-auto p-5">
            {executionTimeline.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No executed steps recorded for this run.</p>
            ) : (
              <div className="space-y-2">
                {executionTimeline.map((e: any) => (
                  <div key={e.id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                    <img src={e.imageDataUrl} alt={e.screenName} className="h-12 w-8 shrink-0 rounded object-cover" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">#{e.stepNumber}</span>
                        <span className="font-medium">{e.testCase?.testCaseId ?? '—'}</span>
                        {e.testCase && <Badge className={`${STATUS_BADGE[e.testCase.result] ?? ''} text-[9px]`}>{e.testCase.result}</Badge>}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">{e.screenName} · {new Date(e.createdAt).toLocaleTimeString()}</div>
                    </div>
                    <div className="shrink-0 text-[11px] text-muted-foreground">{e.durationSeconds != null ? `${e.durationSeconds}s` : '—'}</div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="performance" className="p-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="border-border bg-card/40 p-4">
                <Gauge className="h-4 w-4 text-muted-foreground" />
                <div className="mt-2 font-display text-xl font-semibold">{run.performanceScore != null ? run.performanceScore : '—'}</div>
                <div className="text-[11px] text-muted-foreground">Performance Score</div>
              </Card>
              <Card className="border-border bg-card/40 p-4">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <div className="mt-2 font-display text-xl font-semibold">{elapsedLabel(run.startedAt)}</div>
                <div className="text-[11px] text-muted-foreground">Total Execution Time</div>
              </Card>
              <Card className="border-border bg-card/40 p-4">
                <Hourglass className="h-4 w-4 text-muted-foreground" />
                <div className="mt-2 font-display text-xl font-semibold">{avgExecutionSeconds != null ? `${avgExecutionSeconds.toFixed(1)}s` : '—'}</div>
                <div className="text-[11px] text-muted-foreground">Avg. Time per Test Case</div>
              </Card>
              <Card className="border-border bg-card/40 p-4">
                <BugIcon className="h-4 w-4 text-muted-foreground" />
                <div className="mt-2 font-display text-xl font-semibold">{bugs.length}</div>
                <div className="text-[11px] text-muted-foreground">Bugs Found</div>
              </Card>
            </div>
            {run.performanceScore == null && (
              <p className="mt-4 text-xs text-muted-foreground">
                A performance score is only computed for catalog Test Execution runs with performance-related modules selected.
              </p>
            )}
          </TabsContent>

          <TabsContent value="logs" className="p-5">
            <div className="h-96">
              <LiveConsole logs={logs} />
            </div>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
