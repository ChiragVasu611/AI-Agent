'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  Bug as BugIcon, CheckCircle2, Clock, Copy,
  Download, ExternalLink, FileSpreadsheet, Globe, Loader2,
  Play, RefreshCw, ScrollText, Search, ShieldAlert, Square,
  SkipForward, Smartphone, Terminal, Timer, UploadCloud, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { startUploadedTestExecution } from '@/app/qa/actions';
import { cancelQaTestRun } from '@/app/qa/runs/actions';
import { submitBinaryRun, type SubmitProgress } from '@/lib/qa/submit-binary-run';
import { attachSelectedDevice } from '@/lib/qa/selected-device';
import { SelectedDeviceBanner } from '@/components/modules/qa/selected-device-banner';
import { exportCsv, exportExcel } from '@/lib/qa/export';
import { TestCaseSheetModal } from '@/components/modules/qa/test-case-sheet-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { BugCard } from '@/components/modules/qa/bug-card';

/**
 * Only three source types are shown. Flutter/React Native/Hybrid apps produce
 * an ordinary .apk/.aab (or .ipa on iOS) at build time, so they need no
 * separate nav item — they're just uploaded through the same Android/iOS
 * Application workflow as any native app.
 */
const PLATFORM_TABS = [
  { value: 'android', label: '📱 Android Application' },
  { value: 'ios', label: '🍎 iOS Application' },
  { value: 'web', label: '🌐 Web Application' },
] as const;

type Platform = typeof PLATFORM_TABS[number]['value'];

const SOURCE_REF_CONFIG: Record<string, { label: string; placeholder: string; isUrl: boolean }> = {
  web_url: { label: 'Website URL', placeholder: 'https://example.com', isUrl: true },
  play_store_url: { label: 'Play Store URL', placeholder: 'https://play.google.com/store/apps/details?id=...', isUrl: true },
  app_store_url: { label: 'App Store URL', placeholder: 'https://apps.apple.com/app/...', isUrl: true },
};

const ANDROID_ACCEPT = '.apk,.aab';
const IOS_ACCEPT = '.ipa';
const MOBILE_TYPE_LABEL: Record<string, string> = { apk: 'Android APK', aab: 'Android App Bundle', ipa: 'iOS IPA' };

/** Detect the real binary type from the uploaded file's extension — the
 * backend (QaProject.sourceType, PLATFORM_BY_SOURCE, app-file-parser) still
 * requires the exact 'apk' | 'aab' | 'ipa' value, so we derive it client-side
 * rather than changing any backend contract. */
function detectMobileType(filename: string): 'apk' | 'aab' | 'ipa' | null {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'apk' || ext === 'aab' || ext === 'ipa') return ext;
  return null;
}

const REQUIRED_COLUMNS = [
  'Test Case ID', 'Module', 'Feature', 'Test Scenario', 'Preconditions',
  'Test Steps', 'Test Data', 'Expected Result', 'Priority', 'Severity',
];

const STATUS_BADGE: Record<string, string> = {
  pass: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  fail: 'bg-red-500/15 text-red-500 border-red-500/30',
  blocked: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  skipped: 'bg-secondary text-muted-foreground',
  pending: 'bg-primary/10 text-primary border-primary/25',
};

const STATUS_DOT: Record<string, string> = {
  pass: 'bg-emerald-500',
  fail: 'bg-red-500',
  blocked: 'bg-amber-500',
  skipped: 'bg-muted-foreground',
  pending: 'bg-amber-400 animate-pulse',
};

const RUN_STATUS_DOT: Record<string, string> = {
  queued: 'bg-amber-400 animate-pulse',
  running: 'bg-amber-400 animate-pulse',
  passed: 'bg-emerald-500',
  failed: 'bg-red-500',
  partial: 'bg-amber-500',
  cancelled: 'bg-muted-foreground',
};

const RUN_STATUS_COLOR: Record<string, string> = {
  queued: 'bg-secondary text-muted-foreground',
  running: 'bg-primary/15 text-primary',
  passed: 'bg-success/15 text-success',
  failed: 'bg-destructive/15 text-destructive',
  partial: 'bg-amber-500/15 text-amber-500',
  cancelled: 'bg-secondary text-muted-foreground',
};

const BUG_CATEGORIES = [
  'functional', 'ui', 'api', 'performance', 'security', 'crash', 'anr', 'accessibility', 'compatibility',
];

/** Log sources map 1:1 onto the real QaLogEntry.source enum
 * ['automation','logcat','api','error','crash'] — labels are reworded to
 * match the requested tab names without inventing categories the backend
 * doesn't actually record. "API Logs" and "Network Logs" share one real
 * source (api) since this engine doesn't separately track network calls;
 * "AI Logs" surfaces the 'error' source, which is where AI-detected
 * failures/root-cause lines are written. */
const LOG_TABS: Array<{ value: string; label: string; source: string | null }> = [
  { value: 'automation', label: 'Automation Logs', source: 'automation' },
  { value: 'logcat', label: 'Logcat', source: 'logcat' },
  { value: 'api', label: 'API / Network Logs', source: 'api' },
  { value: 'crash', label: 'Crash Logs', source: 'crash' },
  { value: 'ai', label: 'AI Logs', source: 'error' },
];

function elapsedLabel(startedAt: string | null): string {
  if (!startedAt) return '—';
  const secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

function StatCard({ label, value, icon: Icon, accent }: { label: string; value: string | number; icon: any; accent?: string }) {
  return (
    <Card className="border-border bg-card/60 p-3.5 backdrop-blur transition hover:border-primary/30">
      <div className="flex items-center justify-between">
        <Icon className={`h-4 w-4 ${accent ?? 'text-muted-foreground'}`} />
      </div>
      <div className="mt-1.5 font-display text-xl font-semibold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </Card>
  );
}

function EnhancedLogPanel({ logs }: { logs: any[] }) {
  const [tab, setTab] = useState('automation');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);

  const activeSource = LOG_TABS.find((t) => t.value === tab)?.source ?? null;
  const filtered = logs.filter((l) => (!activeSource || l.source === activeSource) && (!search || l.message.toLowerCase().includes(search.toLowerCase())));

  function copyLogs() {
    const text = filtered.map((l) => `[${new Date(l.createdAt).toLocaleTimeString()}] ${l.message}`).join('\n');
    if (!text) { toast.error('No log lines to copy.'); return; }
    navigator.clipboard.writeText(text);
    toast.success('Logs copied to clipboard');
  }

  function downloadLogs() {
    const text = filtered.map((l) => `[${new Date(l.createdAt).toISOString()}] [${l.source}/${l.level}] ${l.message}`).join('\n');
    if (!text) { toast.error('No log lines to download.'); return; }
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tab}-logs.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList className="flex-wrap">
            {LOG_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="gap-1.5 text-xs">
                <Terminal className="h-3 w-3" /> {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAutoScroll((v) => !v)}
              className={cn('flex items-center gap-1 rounded-md px-2 py-1 text-[11px]', autoScroll ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground')}
            >
              <RefreshCw className="h-3 w-3" /> Auto Scroll
            </button>
            <Button size="sm" variant="outline" className="gap-1 text-[11px]" onClick={copyLogs}><Copy className="h-3 w-3" /> Copy</Button>
            <Button size="sm" variant="outline" className="gap-1 text-[11px]" onClick={downloadLogs}><Download className="h-3 w-3" /> Download</Button>
          </div>
        </div>

        <div className="relative my-2">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search logs…" className="h-8 pl-8 text-xs" />
        </div>

        {LOG_TABS.map((t) => (
          <TabsContent key={t.value} value={t.value} className="mt-0">
            <LogFeed logs={filtered} autoScroll={autoScroll} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function LogFeed({ logs, autoScroll }: { logs: any[]; autoScroll: boolean }) {
  const containerId = 'qa-log-feed';
  useEffect(() => {
    if (!autoScroll) return;
    const el = document.getElementById(containerId);
    el?.scrollTo({ top: el.scrollHeight });
  }, [logs, autoScroll]);

  return (
    <div id={containerId} className="h-72 space-y-1 overflow-y-auto rounded-lg bg-black/90 p-3 font-mono text-[11px]">
      {logs.length === 0 && <p className="text-muted-foreground">No log entries yet.</p>}
      {logs.map((l) => (
        <div key={l.id} className="flex gap-2">
          <span className="shrink-0 text-muted-foreground">{new Date(l.createdAt).toLocaleTimeString()}</span>
          <span className={cn(l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-400' : 'text-green-400')}>
            {l.message}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function TestCaseExecutionPage() {
  const [pending, startTransition] = useTransition();
  const [stopping, setStopping] = useState(false);
  const [, startCancel] = useTransition();
  const [platform, setPlatform] = useState<Platform>('android');
  // Android/iOS each offer two ways to supply the app: a store URL, or a
  // direct binary upload. Web has only a URL — no mode toggle needed.
  const [androidMode, setAndroidMode] = useState<'url' | 'file'>('url');
  const [iosMode, setIosMode] = useState<'url' | 'file'>('url');
  const [fileName, setFileName] = useState('');
  const [appFileName, setAppFileName] = useState('');
  const [detectedMobileType, setDetectedMobileType] = useState<'apk' | 'aab' | 'ipa' | null>(null);
  const [sheetPreviewError, setSheetPreviewError] = useState<string | null>(null);
  const [repositoryModalOpen, setRepositoryModalOpen] = useState(false);
  const [selectedSheet, setSelectedSheet] = useState<{ id: string; sheetName: string; versionLabel: string; totalTestCases: number } | null>(null);
  const [urlValidation, setUrlValidation] = useState<{ valid: boolean; message: string } | null>(null);
  const [isDraggingAppFile, setIsDraggingAppFile] = useState(false);
  const [isDraggingSheet, setIsDraggingSheet] = useState(false);
  // A sheet file dropped directly on the trigger, before the repository popup
  // was even open — fast-tracked into its Upload New Sheet dialog.
  const [pendingSheetFile, setPendingSheetFile] = useState<File | null>(null);

  const isBinarySource = (platform === 'android' && androidMode === 'file') || (platform === 'ios' && iosMode === 'file');
  // The URL-based sourceType for the current tab, when not uploading a binary.
  const urlSourceType = platform === 'web' ? 'web_url' : platform === 'android' ? 'play_store_url' : 'app_store_url';

  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [screenshots, setScreenshots] = useState<any[]>([]);
  const [bugs, setBugs] = useState<any[]>([]);
  const [testCases, setTestCases] = useState<any[]>([]);
  /** Freshly captured device frame while a run is live; falls back to the last
   *  stored step screenshot once the run finishes. */
  /**
   * Upload progress for the Start Execution button. A 100MB+ APK takes tens of
   * seconds to reach the server and that wait used to be an indefinite spinner,
   * which is indistinguishable from the app having hung.
   */
  const [uploadProgress, setUploadProgress] = useState<SubmitProgress | null>(null);
  const [liveFrame, setLiveFrame] = useState<string | null>(null);
  /**
   * The live snapshot that came back WITH the frame above — module, test case,
   * step, expected, actual, verdict — so every tile in the Live Device panel is
   * describing the same moment as the image, not a value fetched 1.5s apart on
   * a different poll.
   */
  const [liveStatus, setLiveStatus] = useState<{
    live?: boolean;
    inSync?: boolean | null;
    frameInfo?: { screenName?: string; testCaseId?: string; stepNumber?: number | null } | null;
    current?: {
      module?: string | null; testCaseId?: string | null; scenario?: string | null;
      step?: string | null; stepNumber?: number | null; expected?: string;
      actual?: string; status?: string | null; screen?: string | null;
    };
    progress?: number;
  } | null>(null);

  // Test case table controls
  const [tcSearch, setTcSearch] = useState('');
  const [tcStatus, setTcStatus] = useState('all');
  const [tcModule, setTcModule] = useState('all');
  const [tcSort, setTcSort] = useState('order');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bottomTab, setBottomTab] = useState('summary');

  // Run status, logs, bugs and test case results are all small JSON — safe to
  // poll quickly so the step-by-step view keeps up with the device.
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    async function load() {
      const [runRes, logsRes, bugsRes, tcRes] = await Promise.all([
        fetch(`/api/qa/runs/${runId}`).then((r) => r.json()),
        fetch(`/api/qa/logs?runId=${runId}`).then((r) => r.json()),
        fetch(`/api/qa/bugs?runId=${runId}`).then((r) => r.json()),
        fetch(`/api/qa/test-cases?runId=${runId}`).then((r) => r.json()),
      ]);
      if (cancelled) return;
      setRun(runRes.run);
      setLogs(logsRes.logs ?? []);
      setBugs(bugsRes.bugs ?? []);
      setTestCases(tcRes.testCases ?? []);
    }
    load();
    const interval = setInterval(load, 1500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [runId]);

  // The screenshot history is base64 image data — up to 60 frames, several MB a
  // time. Re-fetching that on the fast loop was enough to stall the tab and made
  // the live panel stutter, so it gets its own slower cadence. The live preview
  // no longer depends on it (see the live-frame poll below), so nothing on
  // screen lags because of this.
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    async function loadShots() {
      const res = await fetch(`/api/qa/screenshots?runId=${runId}`).then((r) => r.json()).catch(() => null);
      if (cancelled || !res) return;
      setScreenshots(res.screenshots ?? []);
    }
    loadShots();
    const interval = setInterval(loadShots, 6000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [runId]);

  // Real-time device streaming: picks up the engine's latest stored step
  // screenshot, so the panel follows execution without ever touching the
  // device itself from this route (see live-frame/route.ts — a previous
  // version captured independently on a timer and measured an 8s stall from
  // contending with the engine's own adb calls). A plain DB read is cheap
  // enough to poll quickly with no downside.
  // The frame AND the text describing it arrive together from one endpoint.
  // They used to come from two endpoints on different intervals (this one at
  // 500ms, the run document at 1500ms), so the image on screen and the
  // Expected/Actual/verdict beside it regularly described different steps.
  useEffect(() => {
    if (!runId || run?.status !== 'running') {
      // Keep the last frame on screen after the run ends rather than blanking
      // the panel; `live` is what drives the streaming indicator.
      setLiveStatus(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function pump() {
      const res = await fetch(`/api/qa/runs/${runId}/live-frame`).then((r) => r.json()).catch(() => null);
      if (cancelled) return;
      if (res && !res.error) {
        if (res.frame) setLiveFrame(res.frame);
        setLiveStatus(res);
      }
      // Chained rather than a fixed interval, so a slow response cannot pile up
      // overlapping requests.
      timer = setTimeout(pump, 500);
    }
    pump();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [runId, run?.status]);

  function selectPlatform(value: Platform) {
    setPlatform(value);
    setAppFileName('');
    setDetectedMobileType(null);
    setUrlValidation(null);
  }

  function acceptAppFile(file: File | null) {
    setAppFileName(file?.name ?? '');
    setDetectedMobileType(file ? detectMobileType(file.name) : null);
  }

  async function onRepositorySheetSelected(sheet: { id: string; sheetName: string; versionIndex: number; versionLabel: string; totalTestCases: number }) {
    setSelectedSheet({ id: sheet.id, sheetName: sheet.sheetName, versionLabel: sheet.versionLabel, totalTestCases: sheet.totalTestCases });
    setFileName(sheet.sheetName);
    setSheetPreviewError(null);
    try {
      const res = await fetch(`/api/qa/sheets/${sheet.id}`);
      const data = await res.json();
      if (data.error) setSheetPreviewError(data.error);
    } catch {
      setSheetPreviewError('Could not load this sheet — it will still be validated when execution starts.');
    }
  }

  function validateUrl() {
    const el = document.getElementById('sourceRef') as HTMLInputElement | null;
    const val = el?.value?.trim() ?? '';
    try {
      const u = new URL(val);
      setUrlValidation({ valid: true, message: `Valid URL — ${u.protocol}//${u.host}${u.pathname !== '/' ? u.pathname : ''}` });
    } catch {
      setUrlValidation({ valid: false, message: 'Not a valid URL — include https:// and a valid domain.' });
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    if (!selectedSheet) {
      toast.error('Select a test case sheet from the repository.');
      return;
    }

    if (isBinarySource) {
      if (!detectedMobileType) {
        toast.error(platform === 'android' ? 'Upload a valid .apk or .aab file.' : 'Upload a valid .ipa file.');
        return;
      }
      if (platform === 'android' && detectedMobileType === 'ipa') {
        toast.error('That looks like an iOS .ipa file — switch to iOS Application to upload it.');
        return;
      }
      if (platform === 'ios' && detectedMobileType !== 'ipa') {
        toast.error('iOS Application only accepts .ipa files.');
        return;
      }
      formData.set('sourceType', detectedMobileType);
      formData.set('mode', 'uploaded');
    } else {
      formData.set('sourceType', urlSourceType);
    }

    // The Test Case Repository sheet selected above — loaded directly by the
    // server from the repository, no re-upload of the file needed.
    formData.set('sheetId', selectedSheet.id);

    // Run on the device picked in QA → Devices, when one is selected.
    attachSelectedDevice(formData);

    startTransition(async () => {
      // Binary APK/AAB/IPA uploads go through a Route Handler instead of this
      // server action, since server actions in this Next.js version cap request
      // bodies at 1MB — far too small for a real app binary.
      const res = isBinarySource
        ? await submitBinaryRun(formData, setUploadProgress)
        : await startUploadedTestExecution(formData);
      setUploadProgress(null);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success('AI test case execution started');
      setRunId(res.runId ?? null);
    });
  }

  const moduleOptions = useMemo(
    () => Array.from(new Set(testCases.map((t) => t.module).filter(Boolean))).sort(),
    [testCases],
  );

  const avgExecutionSeconds = useMemo(() => {
    const evaluated = testCases.filter((t) => t.result !== 'pending').map((t) => new Date(t.createdAt).getTime());
    if (evaluated.length < 2) return null;
    const sorted = [...evaluated].sort((a, b) => a - b);
    const diffs: number[] = [];
    for (let i = 1; i < sorted.length; i++) diffs.push((sorted[i] - sorted[i - 1]) / 1000);
    return diffs.reduce((a, b) => a + b, 0) / diffs.length;
  }, [testCases]);

  const filteredTestCases = useMemo(() => {
    const q = tcSearch.trim().toLowerCase();
    let list = testCases.filter((t) => {
      if (tcStatus !== 'all' && t.result !== tcStatus) return false;
      if (tcModule !== 'all' && t.module !== tcModule) return false;
      if (q && !`${t.testCaseId} ${t.scenario ?? t.name} ${t.module}`.toLowerCase().includes(q)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (tcSort === 'priority') return String(a.priority).localeCompare(String(b.priority));
      if (tcSort === 'status') return String(a.result).localeCompare(String(b.result));
      if (tcSort === 'module') return String(a.module).localeCompare(String(b.module));
      return (a.order ?? 0) - (b.order ?? 0);
    });
    return list;
  }, [testCases, tcSearch, tcStatus, tcModule, tcSort]);

  const executionTimeline = useMemo(() => {
    const withScreens = screenshots.map((s) => {
      const match = testCases.find((t) => (t.scenario ?? t.name) === s.testStep);
      return { ...s, testCase: match };
    });
    return withScreens
      .slice()
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((s, i, arr) => ({
        ...s,
        durationSeconds: i > 0 ? Math.max(0, Math.round((new Date(s.createdAt).getTime() - new Date(arr[i - 1].createdAt).getTime()) / 1000)) : null,
        stepNumber: i + 1,
      }));
  }, [screenshots, testCases]);

  const bugsByCategory = useMemo(() => {
    const map = new Map<string, any[]>();
    BUG_CATEGORIES.forEach((c) => map.set(c, []));
    bugs.forEach((b) => { if (map.has(b.type)) map.get(b.type)!.push(b); });
    return map;
  }, [bugs]);

  const lastEvaluated = useMemo(() => {
    const evaluated = testCases.filter((t) => t.result !== 'pending');
    return evaluated.length > 0 ? evaluated[evaluated.length - 1] : null;
  }, [testCases]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === filteredTestCases.length ? new Set() : new Set(filteredTestCases.map((t) => t.id))));
  }

  function exportTestCases(format: 'csv' | 'excel') {
    const source = selected.size > 0 ? filteredTestCases.filter((t) => selected.has(t.id)) : filteredTestCases;
    const rows = source.map((t) => ({
      'Test Case ID': t.testCaseId, Scenario: t.scenario ?? t.name, Module: t.module, Priority: t.priority,
      Status: t.result, Device: run?.currentDevice ?? '—', Platform: run?.project?.platform ?? '—',
      'Bug Count': t.bugId ? 1 : 0,
    }));
    if (rows.length === 0) { toast.error('No test cases to export.'); return; }
    if (format === 'csv') exportCsv('test-case-results.csv', rows);
    else exportExcel('test-case-results.xlsx', rows, 'Test Case Results');
    toast.success(`${rows.length} test case(s) exported`);
  }

  const configReady = fileName && (isBinarySource ? !!detectedMobileType : true);

  // The Stop control only makes sense once execution has actually started,
  // and is disabled as soon as a stop has been requested (locally, or already
  // recorded server-side) so it can't be pressed twice.
  const isRunning = run?.status === 'running';
  const stopRequested = stopping || run?.status === 'cancelled' || run?.currentStep === 'Cancelling…';
  // Once a run reaches any terminal state, the config form (and its Start
  // Execution button) stays hidden forever with no way back — this is exactly
  // what reads as "the button stopped working". Offer an explicit reset.
  const runIsTerminal = run && ['passed', 'failed', 'partial', 'cancelled'].includes(run.status);

  function onNewExecution() {
    setRunId(null);
    setRun(null);
    setLogs([]);
    setScreenshots([]);
    setBugs([]);
    setTestCases([]);
  }

  function onStop() {
    if (!runId) return;
    if (!confirm('Stop this execution? It will end now and any partial results collected so far are saved.')) return;
    setStopping(true);
    startCancel(async () => {
      const res = await cancelQaTestRun(runId);
      if (res?.error) { setStopping(false); toast.error(res.error); } else toast.success('Stopping run…');
    });
  }

  return (
    <div className="mx-auto max-w-[1800px] space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">AI Test Case Execution</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure, monitor, and analyze test execution from a single enterprise QA workspace.
          </p>
        </div>
        {run && (
          <div className="flex items-center gap-2">
            <span className={cn('h-2 w-2 rounded-full', RUN_STATUS_DOT[run.status])} />
            <Badge className={RUN_STATUS_COLOR[run.status] ?? ''}>{run.status}</Badge>
            {isRunning && (
              <Button size="sm" variant="outline" className="gap-1.5" disabled={stopRequested} onClick={onStop}>
                {stopRequested ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                {stopRequested ? 'Stopping…' : 'Stop Execution'}
              </Button>
            )}
            {runIsTerminal && (
              <Button size="sm" className="gap-1.5" onClick={onNewExecution}>
                <RefreshCw className="h-3.5 w-3.5" /> New Execution
              </Button>
            )}
            <Link href={`/qa/runs/${runId}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Full Run Page <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_355px] xl:items-start">
        {/* SECTION 2 — Main workspace (70%) */}
        <div className="space-y-4">
          {/* SECTION 1 — Configuration, now the first item in the main column */}
          <Card className="border-border bg-card/60 p-3 backdrop-blur">
            <h2 className="mb-2 px-1 font-display text-xs font-semibold uppercase tracking-wide text-muted-foreground">Test Run Configuration</h2>
            <div className="flex flex-wrap items-center gap-2">
              {PLATFORM_TABS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => selectPlatform(s.value)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition',
                    platform === s.value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-secondary/70',
                  )}
                >
                  <span>{s.label}</span>
                </button>
              ))}
              <div className="ml-auto shrink-0 rounded-lg border border-border bg-secondary/20 px-2.5 py-1.5 text-[10px] text-muted-foreground">
                {configReady ? '✓ Ready to execute' : '○ Configuration incomplete'}
              </div>
            </div>
          </Card>

          {!runId ? (
            <Card className="border-border bg-card/60 p-5 backdrop-blur">
              <form onSubmit={onSubmit} className="space-y-4">
                {/* Android/iOS: choose store URL vs direct binary upload. Web
                    has only a URL, so no toggle is shown for it. */}
                {(platform === 'android' || platform === 'ios') && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => (platform === 'android' ? setAndroidMode('url') : setIosMode('url'))}
                      className={cn(
                        'flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition',
                        (platform === 'android' ? androidMode : iosMode) === 'url'
                          ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-secondary/40',
                      )}
                    >
                      {platform === 'android' ? 'Play Store URL' : 'App Store URL'}
                    </button>
                    <button
                      type="button"
                      onClick={() => (platform === 'android' ? setAndroidMode('file') : setIosMode('file'))}
                      className={cn(
                        'flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition',
                        (platform === 'android' ? androidMode : iosMode) === 'file'
                          ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-secondary/40',
                      )}
                    >
                      {platform === 'android' ? 'Upload APK' : 'Upload IPA'}
                    </button>
                  </div>
                )}

                {/* Binary upload — always mounted, visibility toggled so the
                    selected File survives switching between tabs. */}
                <div className={cn('space-y-2', isBinarySource ? 'block' : 'hidden')}>
                  <Label htmlFor="appFile">{platform === 'android' ? 'Upload APK / AAB *' : 'Upload IPA *'}</Label>
                  <label
                    htmlFor="appFile"
                    onDragOver={(e) => { e.preventDefault(); setIsDraggingAppFile(true); }}
                    onDragLeave={() => setIsDraggingAppFile(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingAppFile(false);
                      const file = e.dataTransfer.files?.[0] ?? null;
                      // Drag-and-drop never touches the real <input>, only the
                      // DataTransfer payload — assign it to the input's own
                      // FileList so FormData(form) actually includes the file.
                      const input = document.getElementById('appFile') as HTMLInputElement | null;
                      if (input && file) {
                        const dt = new DataTransfer();
                        dt.items.add(file);
                        input.files = dt.files;
                      }
                      acceptAppFile(file);
                    }}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-xs transition',
                      isDraggingAppFile ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-secondary/40',
                    )}
                  >
                    <UploadCloud className="h-5 w-5 flex-shrink-0" />
                    {appFileName ? (
                      <span className="truncate text-foreground">{appFileName}</span>
                    ) : isDraggingAppFile ? (
                      <span>Drop it here…</span>
                    ) : (
                      <span>{platform === 'android' ? 'Drag & drop your .apk or .aab file, or click to browse.' : 'Drag & drop your .ipa file, or click to browse.'}</span>
                    )}
                    <input
                      id="appFile"
                      name="appFile"
                      type="file"
                      accept={platform === 'android' ? ANDROID_ACCEPT : IOS_ACCEPT}
                      className="hidden"
                      onChange={(e) => acceptAppFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  {appFileName && (
                    <div className="rounded-lg border border-border bg-secondary/20 p-3 text-xs">
                      <div className="font-medium text-muted-foreground">File Information</div>
                      <div className="mt-1 flex items-center justify-between">
                        <span>{appFileName}</span>
                        {detectedMobileType ? (
                          <Badge className="bg-primary/15 text-primary">{MOBILE_TYPE_LABEL[detectedMobileType]} detected</Badge>
                        ) : (
                          <Badge variant="destructive">Unrecognized type</Badge>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Upload complete — ready for execution
                      </div>
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Real package/bundle ID, display name, and version are extracted automatically.
                  </p>
                </div>

                {/* URL entry — Play Store / App Store / Website, one input
                    shared across the three since only one is visible at a time. */}
                <div className={cn('space-y-2', !isBinarySource ? 'block' : 'hidden')}>
                  <Label htmlFor="sourceRef">{SOURCE_REF_CONFIG[urlSourceType].label} *</Label>
                  <div className="flex gap-2">
                    <Input
                      id="sourceRef"
                      name="sourceRef"
                      required={!isBinarySource}
                      placeholder={SOURCE_REF_CONFIG[urlSourceType].placeholder}
                      onChange={() => setUrlValidation(null)}
                      className="flex-1"
                    />
                    <Button type="button" variant="outline" onClick={validateUrl} className="shrink-0 text-xs">Validate URL</Button>
                  </div>
                  {urlValidation && (
                    <p className={cn('text-[11px] font-medium', urlValidation.valid ? 'text-emerald-500' : 'text-destructive')}>
                      {urlValidation.message}
                    </p>
                  )}
                </div>

                {/* Test Case Repository — always available regardless of which
                    platform tab is active. Sheets are selected from (or
                    uploaded into) a centralized, versioned repository instead
                    of being re-uploaded for every run. */}
                <div className="space-y-2 border-t border-border pt-4">
                  <Label>Test Case Sheet *</Label>
                  <button
                    type="button"
                    onClick={() => setRepositoryModalOpen(true)}
                    onDragOver={(e) => { e.preventDefault(); setIsDraggingSheet(true); }}
                    onDragLeave={() => setIsDraggingSheet(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingSheet(false);
                      const f = e.dataTransfer.files?.[0] ?? null;
                      if (f) {
                        // Opens the Test Case Repository popup with the
                        // dropped file already loaded into Upload New Sheet,
                        // preview included.
                        setPendingSheetFile(f);
                        setRepositoryModalOpen(true);
                      }
                    }}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-xs transition',
                      isDraggingSheet ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-secondary/40',
                    )}
                  >
                    {!selectedSheet && <FileSpreadsheet className="h-5 w-5 flex-shrink-0" />}
                    {selectedSheet ? (
                      <span className="flex flex-col items-start truncate text-left text-foreground">
                        <span className="flex items-center gap-1.5 truncate"><FileSpreadsheet className="h-3.5 w-3.5 flex-shrink-0" /> {selectedSheet.sheetName}</span>
                        <span className="text-[10px] text-muted-foreground">{selectedSheet.versionLabel} · {selectedSheet.totalTestCases} test case(s) · click to change</span>
                      </span>
                    ) : isDraggingSheet ? (
                      <span>Drop it here…</span>
                    ) : (
                      <span>Click to select a sheet from the Test Case Repository, or drag & drop / upload a new one.</span>
                    )}
                  </button>
                  <p className="text-[11px] text-muted-foreground">
                    Columns: {REQUIRED_COLUMNS.join(', ')}. Order/casing flexible — headers auto-matched.
                  </p>

                  {sheetPreviewError && <p className="text-[11px] text-destructive">{sheetPreviewError}</p>}
                </div>

                <div className="space-y-3 border-t border-border pt-4">
                  <SelectedDeviceBanner show={isBinarySource || (platform === 'android' && androidMode === 'url')} />
                  <Button type="submit" disabled={pending} className="w-full gap-2">
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    {/*
                      A 100MB+ APK takes tens of seconds to reach the server, and
                      that used to be an unlabelled spinner — indistinguishable
                      from a hang. Report the actual percentage while bytes are
                      moving, then say the server is working, so the wait is
                      always accounted for.
                    */}
                    {!pending && 'Start Execution'}
                    {pending && !uploadProgress && 'Starting…'}
                    {pending && uploadProgress?.processing && 'Preparing run on the server…'}
                    {pending && uploadProgress && !uploadProgress.processing && (
                      uploadProgress.percent != null
                        ? `Uploading app… ${uploadProgress.percent}%`
                        : 'Uploading app…'
                    )}
                  </Button>
                  {pending && uploadProgress && !uploadProgress.processing && uploadProgress.percent != null && (
                    <>
                      <Progress value={uploadProgress.percent} className="h-1.5" />
                      <p className="text-center text-[11px] text-muted-foreground">
                        {(uploadProgress.loadedBytes / 1048576).toFixed(0)}MB of {(uploadProgress.totalBytes / 1048576).toFixed(0)}MB sent —
                        {' '}execution begins automatically once the upload completes.
                      </p>
                    </>
                  )}
                </div>
              </form>
            </Card>
          ) : !run ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
                <StatCard label="Total Test Cases" value={run.totalCases || testCases.length} icon={FileSpreadsheet} />
                <StatCard label="Executed" value={run.passedCases + run.failedCases + run.blockedCases + run.skippedCases} icon={CheckCircle2} />
                <StatCard label="Passed" value={run.passedCases} icon={CheckCircle2} accent="text-emerald-500" />
                <StatCard label="Failed" value={run.failedCases} icon={XCircle} accent="text-red-500" />
                <StatCard label="Blocked" value={run.blockedCases} icon={ShieldAlert} accent="text-amber-500" />
                <StatCard label="Skipped" value={run.skippedCases} icon={SkipForward} />
                <StatCard
                  label="Success Rate"
                  value={(run.passedCases + run.failedCases) > 0 ? `${Math.round((run.passedCases / (run.passedCases + run.failedCases + run.blockedCases + run.skippedCases)) * 100)}%` : '—'}
                  icon={CheckCircle2}
                />
                <StatCard label="Execution Time" value={elapsedLabel(run.startedAt)} icon={Timer} />
                <StatCard label="Avg. Execution Time" value={avgExecutionSeconds != null ? `${avgExecutionSeconds.toFixed(1)}s` : '—'} icon={Clock} />
                <StatCard label="Bugs Found" value={bugs.length} icon={BugIcon} accent={bugs.length > 0 ? 'text-destructive' : undefined} />
              </div>

              <Card className="border-border bg-card/60 p-5 backdrop-blur">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 rounded-full', RUN_STATUS_DOT[run.status])} />
                    <h2 className="font-display text-sm font-semibold">Live Test Execution</h2>
                  </div>
                  <span className="text-xs text-muted-foreground">{run.progress}%</span>
                </div>
                <Progress value={run.progress} className="h-2" />
                {/*
                  While the run is live these tiles read the SAME response that
                  delivered the frame beside them (`liveStatus`), falling back to
                  the run document only once the run has ended.

                  Two earlier versions of this were wrong in opposite directions.
                  First the values came from `lastEvaluated` — the last COMPLETED
                  case — so they described the previous test case under a "Live"
                  heading. Then they came from the run document, which is correct
                  data but arrives on a 1500ms poll while the frame arrives on a
                  500ms one, so image and text still drifted apart. Reading both
                  from one response is what actually keeps them together.
                */}
                {(() => {
                  const cur = (run.status === 'running' ? liveStatus?.current : null) ?? null;
                  const val = (live: string | null | undefined, fallback: string | null | undefined) =>
                    (run.status === 'running' ? (live ?? fallback) : fallback) || '—';
                  const moduleName = val(cur?.module, run.currentModule ?? run.currentSuite);
                  const tcId = val(cur?.testCaseId, run.currentTestCaseId ?? run.currentCase);
                  const scenario = val(cur?.scenario, run.currentScenario);
                  const stepText = val(cur?.step, run.currentStep);
                  const screen = val(cur?.screen, run.currentScreen);
                  const expected = val(cur?.expected, run.currentExpected);
                  const actual = val(cur?.actual, run.currentActual);
                  const stepStatus = (run.status === 'running' ? cur?.status : null) ?? run.currentStepStatus;
                  return (
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                  <div><div className="text-muted-foreground">Current Module</div><div className="truncate font-medium" title={moduleName}>{moduleName}</div></div>
                  <div><div className="text-muted-foreground">Current Test Case ID</div><div className="truncate font-medium" title={tcId}>{tcId}</div></div>
                  <div><div className="text-muted-foreground">Current Test Case</div><div className="truncate font-medium" title={scenario}>{scenario}</div></div>
                  <div><div className="text-muted-foreground">Current Test Step</div><div className="truncate font-medium" title={stepText}>{stepText}</div></div>
                  <div><div className="text-muted-foreground">Current Screen</div><div className="truncate font-medium" title={screen}>{screen}</div></div>
                  <div><div className="text-muted-foreground">Current Feature</div><div className="truncate font-medium" title={run.currentFeature ?? undefined}>{run.currentFeature ?? '—'}</div></div>
                  <div><div className="text-muted-foreground">Expected Result</div><div className="truncate font-medium" title={expected}>{expected}</div></div>
                  <div><div className="text-muted-foreground">Actual Result</div><div className="truncate font-medium" title={actual}>{actual}</div></div>
                  <div>
                    <div className="text-muted-foreground">Pass / Fail Status</div>
                    {stepStatus && stepStatus !== 'running' ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[stepStatus] ?? 'bg-muted-foreground')} />
                        <Badge className={`${STATUS_BADGE[stepStatus] ?? STATUS_BADGE.pending} text-[10px]`}>{stepStatus}</Badge>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                        <span className="font-medium">Running</span>
                      </span>
                    )}
                  </div>
                </div>
                  );
                })()}
              </Card>

              {/* Test Case Table */}
              <Card className="border-border bg-card/60 backdrop-blur">
                <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
                  <div className="flex h-9 min-w-[180px] flex-1 items-center gap-2 rounded-md border border-input bg-background px-3">
                    <Search className="h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      value={tcSearch}
                      onChange={(e) => setTcSearch(e.target.value)}
                      placeholder="Search test cases..."
                      className="h-full w-full bg-transparent text-xs outline-none"
                    />
                  </div>
                  <Select value={tcStatus} onValueChange={setTcStatus}>
                    <SelectTrigger className="h-9 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="pass">Pass</SelectItem>
                      <SelectItem value="fail">Fail</SelectItem>
                      <SelectItem value="blocked">Blocked</SelectItem>
                      <SelectItem value="skipped">Skipped</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={tcModule} onValueChange={setTcModule}>
                    <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Modules</SelectItem>
                      {moduleOptions.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={tcSort} onValueChange={setTcSort}>
                    <SelectTrigger className="h-9 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="order">Sort: Order</SelectItem>
                      <SelectItem value="priority">Sort: Priority</SelectItem>
                      <SelectItem value="status">Sort: Status</SelectItem>
                      <SelectItem value="module">Sort: Module</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => exportTestCases('csv')}>
                    <Download className="h-3.5 w-3.5" /> CSV
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => exportTestCases('excel')}>
                    <Download className="h-3.5 w-3.5" /> Excel
                  </Button>
                </div>
                <div className="max-h-[420px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"><Checkbox checked={selected.size > 0 && selected.size === filteredTestCases.length} onCheckedChange={toggleSelectAll} /></TableHead>
                        <TableHead>Test Case ID</TableHead>
                        <TableHead>Scenario</TableHead>
                        <TableHead>Module</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Platform</TableHead>
                        <TableHead>Bugs</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTestCases.length === 0 ? (
                        <TableRow><TableCell colSpan={7} className="py-8 text-center text-xs text-muted-foreground">No test cases match these filters.</TableCell></TableRow>
                      ) : filteredTestCases.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell><Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggleSelect(t.id)} /></TableCell>
                          <TableCell className="font-mono text-xs">{t.testCaseId}</TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs" title={t.scenario ?? t.name}>{t.scenario ?? t.name}</TableCell>
                          <TableCell className="text-xs">{t.module}</TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1.5">
                              <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[t.result])} />
                              <Badge className={`${STATUS_BADGE[t.result] ?? ''} text-[10px]`}>{t.result}</Badge>
                            </span>
                          </TableCell>
                          <TableCell className="text-xs capitalize text-muted-foreground">{run.project?.platform ?? '—'}</TableCell>
                          <TableCell className="text-xs">{t.bugId ? 1 : 0}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
                  {filteredTestCases.length} of {testCases.length} test case(s) {selected.size > 0 ? `· ${selected.size} selected` : ''}
                </div>
              </Card>
            </>
          )}
        </div>

        {/* SECTION 3 — Live Device (30%, fixed/sticky) */}
        <div className="space-y-4 xl:sticky xl:top-4">
          <Card className="border-border bg-card/60 p-4 backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-xs font-semibold">Live Tracking</h2>
              <div className="flex items-center gap-1.5">
                {isRunning && liveFrame && (
                  <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-500">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Streaming
                  </span>
                )}
                {run && <Badge variant="secondary" className="text-[10px]">{run.engineMode === 'real_browser' ? 'Real' : 'Simulated'}</Badge>}
              </div>
            </div>
            {!run ? (
              <Skeleton className="mx-auto h-[min(58vh,440px)] min-h-[280px] w-full rounded-[22px]" />
            ) : (
              <>
                {/*
                  Device frame: a fixed-HEIGHT, flexible-width bezel — deliberately
                  NOT a CSS aspect-ratio box. Combining `aspect-[..]` with a
                  `max-h-[..]` clamp (the previous approach) made the box's
                  rendered shape disagree with its own declared ratio once the
                  clamp kicked in, and a percentage-sized child (`h-full` on the
                  <img>) could then compute against the pre-clamp height in some
                  browsers — cropping the bottom via overflow-hidden.
                  A plain fixed-height box sidesteps that class of bug entirely:
                  object-contain letterboxes the real device frame (whatever its
                  actual ratio — 16:9, 18:9, 20:9, tablets, anything) to fit
                  inside, full stop. Never crops, never stretches.
                */}
                <div className="relative mx-auto flex h-[min(58vh,440px)] min-h-[280px] w-full items-center justify-center rounded-[22px] border-[3px] border-neutral-800 bg-black p-2 shadow-lg dark:border-neutral-700">
                  {/* Speaker/notch cutout — purely cosmetic, gives the frame a
                      device-like silhouette without assuming a specific model. */}
                  <div className="pointer-events-none absolute left-1/2 top-0 z-10 h-3.5 w-16 -translate-x-1/2 rounded-b-lg bg-neutral-800 dark:bg-neutral-700" />
                  <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl bg-secondary/20">
                    {liveFrame || screenshots.length > 0 ? (
                      <img
                        src={liveFrame ?? screenshots[screenshots.length - 1].imageDataUrl}
                        alt="Current device screen"
                        className="h-full w-full object-contain"
                      />
                    ) : run.engineMode === 'real_browser' ? (
                      <Globe className="h-8 w-8 text-muted-foreground" />
                    ) : (
                      <Smartphone className="h-8 w-8 text-muted-foreground" />
                    )}
                  </div>
                </div>
                {/* The "Live Test Execution" card in the main column breaks out
                    Module/TC ID/Test Case/Step/Expected/Actual/verdict in full,
                    all from the same live run fields. This strip repeats only
                    enough to read the frame on its own. */}
                <div className="mt-2 space-y-1.5 text-[11px]">
                  {(run.currentModule || run.currentTestCaseId || run.currentSuite) && (
                    <div className="truncate font-medium text-foreground">
                      {[run.currentModule ?? run.currentSuite, run.currentTestCaseId ?? run.currentCase]
                        .filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {run.currentStep && (
                    <div className="line-clamp-2 text-muted-foreground">{run.currentStep}</div>
                  )}
                  {run.currentStepStatus === 'running' ? (
                    <Badge className="gap-1.5 bg-primary/10 text-[10px] font-medium text-primary">
                      <Loader2 className="h-3 w-3 animate-spin" /> Running
                    </Badge>
                  ) : run.currentStepStatus && (
                    <Badge
                      className={cn(
                        'text-[10px] font-semibold uppercase',
                        run.currentStepStatus === 'pass' && 'bg-emerald-500/15 text-emerald-500',
                        run.currentStepStatus === 'fail' && 'bg-destructive/15 text-destructive',
                        run.currentStepStatus === 'blocked' && 'bg-amber-500/15 text-amber-500',
                        run.currentStepStatus === 'skipped' && 'bg-secondary text-muted-foreground',
                      )}
                    >
                      {run.currentStepStatus}
                    </Badge>
                  )}
                </div>
              </>
            )}
          </Card>

          <Card className="border-border bg-card/60 p-4 backdrop-blur">
            <h2 className="mb-2 font-display text-xs font-semibold">AI Findings</h2>
            {bugs.length === 0 ? (
              <p className="py-4 text-center text-[11px] text-muted-foreground">No issues detected yet.</p>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {BUG_CATEGORIES.filter((c) => (bugsByCategory.get(c)?.length ?? 0) > 0).map((c) => (
                  <div key={c} className="flex items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-xs">
                    <span className="capitalize">{c}</span>
                    <Badge variant="secondary" className="text-[10px]">{bugsByCategory.get(c)!.length}</Badge>
                  </div>
                ))}
              </div>
            )}
            {(bugsByCategory.get('crash')!.length > 0 || bugsByCategory.get('anr')!.length > 0) && (
              <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
                {bugsByCategory.get('crash')!.length} crash · {bugsByCategory.get('anr')!.length} ANR alert(s) detected
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* BOTTOM — Full-width panel */}
      {runId && run && (
        <Card className="border-border bg-card/60 backdrop-blur">
          <Tabs value={bottomTab} onValueChange={setBottomTab}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="summary">Execution Summary</TabsTrigger>
              <TabsTrigger value="results">Test Case Results</TabsTrigger>
              <TabsTrigger value="bugs">AI Bug Report ({bugs.length})</TabsTrigger>
              <TabsTrigger value="screenshots">Screenshots</TabsTrigger>
              <TabsTrigger value="timeline">Execution Timeline</TabsTrigger>
              <TabsTrigger value="logs" className="gap-1.5"><ScrollText className="h-3.5 w-3.5" /> Live Logs</TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="p-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div><div className="text-xs text-muted-foreground">Project</div><div className="text-sm font-medium">{run.project?.name ?? '—'}</div></div>
                <div><div className="text-xs text-muted-foreground">Source Type</div><div className="text-sm font-medium capitalize">{run.project?.sourceType?.replace(/_/g, ' ') ?? '—'}</div></div>
                <div><div className="text-xs text-muted-foreground">Build Version</div><div className="text-sm font-medium">{run.buildVersion}</div></div>
                <div><div className="text-xs text-muted-foreground">Executed By</div><div className="text-sm font-medium">{run.executedByName || '—'}</div></div>
                <div><div className="text-xs text-muted-foreground">Started</div><div className="text-sm font-medium">{run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}</div></div>
                <div><div className="text-xs text-muted-foreground">Completed</div><div className="text-sm font-medium">{run.completedAt ? new Date(run.completedAt).toLocaleString() : 'In progress'}</div></div>
              </div>
            </TabsContent>

            <TabsContent value="results" className="max-h-[420px] overflow-y-auto p-5">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Test Case ID</TableHead><TableHead>Scenario</TableHead><TableHead>Module</TableHead>
                    <TableHead>Status</TableHead><TableHead>Expected</TableHead><TableHead>Actual</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {testCases.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">No results yet.</TableCell></TableRow>
                  ) : testCases.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs">{t.testCaseId}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs">{t.scenario ?? t.name}</TableCell>
                      <TableCell className="text-xs">{t.module}</TableCell>
                      <TableCell><Badge className={`${STATUS_BADGE[t.result] ?? ''} text-[10px]`}>{t.result}</Badge></TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">{t.expectedResult}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">{t.actualResult}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="bugs" className="max-h-[500px] overflow-y-auto p-5">
              {bugs.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No bugs detected yet.</p>
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
                <p className="py-8 text-center text-sm text-muted-foreground">No screenshots yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {screenshots.map((s) => (
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
                <p className="py-8 text-center text-sm text-muted-foreground">No executed steps yet.</p>
              ) : (
                <div className="space-y-2">
                  {executionTimeline.map((e) => (
                    <div key={e.id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                      <img src={e.imageDataUrl} alt={e.screenName} className="h-12 w-8 shrink-0 rounded object-cover" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">#{e.stepNumber}</span>
                          <span className="font-medium">{e.testCase?.testCaseId ?? '—'}</span>
                          {e.testCase && (
                            <span className="inline-flex items-center gap-1.5">
                              <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[e.testCase.result])} />
                              <Badge className={`${STATUS_BADGE[e.testCase.result] ?? ''} text-[9px]`}>{e.testCase.result}</Badge>
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">{e.screenName} · {new Date(e.createdAt).toLocaleTimeString()}</div>
                      </div>
                      <div className="shrink-0 text-[11px] text-muted-foreground">{e.durationSeconds != null ? `${e.durationSeconds}s` : '—'}</div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="logs" className="p-5">
              <EnhancedLogPanel logs={logs} />
            </TabsContent>
          </Tabs>
        </Card>
      )}

      <TestCaseSheetModal
        open={repositoryModalOpen}
        onOpenChange={setRepositoryModalOpen}
        onSelect={onRepositorySheetSelected}
        pendingFile={pendingSheetFile}
        onPendingFileConsumed={() => setPendingSheetFile(null)}
      />
    </div>
  );
}
