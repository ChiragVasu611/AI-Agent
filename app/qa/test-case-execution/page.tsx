'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  Atom, Battery, Bug as BugIcon, CheckCircle2, Clock, Copy, Cpu,
  Download, ExternalLink, FileSpreadsheet, Globe, Hourglass, Layers, ListChecks, Loader2,
  MemoryStick, Play, PlayCircle, RefreshCw, ScrollText, Search, Settings2, ShieldAlert, Signal,
  SkipForward, Smartphone, Terminal, Timer, UploadCloud, Wifi, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { startUploadedTestExecution } from '@/app/qa/actions';
import { exportCsv, exportExcel } from '@/lib/qa/export';
import { parseSheetPreview, type SheetPreview } from '@/lib/qa/sheet-preview';
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

const SOURCE_TYPES = [
  { value: 'mobile', label: '📱 Mobile Application', icon: Smartphone },
  { value: 'web_url', label: '🌐 Web URL', icon: Globe },
  { value: 'play_store_url', label: '▶ Play Store', icon: PlayCircle },
  { value: 'app_store_url', label: '🍎 App Store', icon: Smartphone },
  { value: 'flutter', label: '⚛ Flutter', icon: Atom },
  { value: 'react_native', label: '⚛ React Native', icon: Atom },
  { value: 'hybrid', label: '🔷 Hybrid', icon: Layers },
];

const PANEL_ITEMS = [
  { value: 'modules', label: 'Execution Modules', icon: ListChecks },
  { value: 'settings', label: 'Execution Settings', icon: Settings2 },
];

const SOURCE_REF_CONFIG: Record<string, { label: string; placeholder: string; isUrl: boolean }> = {
  web_url: { label: 'Web URL', placeholder: 'https://example.com', isUrl: true },
  play_store_url: { label: 'Play Store URL', placeholder: 'https://play.google.com/store/apps/details?id=...', isUrl: true },
  app_store_url: { label: 'App Store URL', placeholder: 'https://apps.apple.com/app/...', isUrl: true },
  flutter: { label: 'File name or URL', placeholder: 'app-release.apk or https://example.com', isUrl: false },
  react_native: { label: 'File name or URL', placeholder: 'app-release.apk or https://example.com', isUrl: false },
  hybrid: { label: 'File name or URL', placeholder: 'app-release.apk or https://example.com', isUrl: false },
};

const MOBILE_ACCEPT = '.apk,.aab,.ipa';
const MOBILE_TYPE_LABEL: Record<string, string> = { apk: 'Android APK', aab: 'Android App Bundle', ipa: 'iOS IPA' };

/** Detect the real binary type from the uploaded file's extension — the
 * nav only offers one unified "Mobile Application" option, but the backend
 * (QaProject.sourceType, PLATFORM_BY_SOURCE, app-file-parser) still requires
 * the exact 'apk' | 'aab' | 'ipa' value, so we derive it client-side rather
 * than changing any backend contract. */
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
  pending: 'bg-sky-500/15 text-sky-500 border-sky-500/30',
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
  const [sourceType, setSourceType] = useState('web_url');
  const [configView, setConfigView] = useState('web_url');
  const [fileName, setFileName] = useState('');
  const [appFileName, setAppFileName] = useState('');
  const [detectedMobileType, setDetectedMobileType] = useState<'apk' | 'aab' | 'ipa' | null>(null);
  const [sheetPreview, setSheetPreview] = useState<SheetPreview | null>(null);
  const [sheetPreviewError, setSheetPreviewError] = useState<string | null>(null);
  const [urlValidation, setUrlValidation] = useState<{ valid: boolean; message: string } | null>(null);
  const isBinarySource = sourceType === 'mobile';

  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [screenshots, setScreenshots] = useState<any[]>([]);
  const [bugs, setBugs] = useState<any[]>([]);
  const [testCases, setTestCases] = useState<any[]>([]);

  // Test case table controls
  const [tcSearch, setTcSearch] = useState('');
  const [tcStatus, setTcStatus] = useState('all');
  const [tcModule, setTcModule] = useState('all');
  const [tcSort, setTcSort] = useState('order');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bottomTab, setBottomTab] = useState('summary');

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    async function load() {
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
    }
    load();
    const interval = setInterval(load, 1500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [runId]);

  function selectSourceNav(value: string) {
    setSourceType(value);
    setConfigView(value);
    setAppFileName('');
    setDetectedMobileType(null);
    setUrlValidation(null);
  }

  async function onTestCaseFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setFileName(file?.name ?? '');
    setSheetPreview(null);
    setSheetPreviewError(null);
    if (!file) return;
    try {
      const preview = await parseSheetPreview(file);
      setSheetPreview(preview);
    } catch {
      setSheetPreviewError('Could not preview this file — it will still be validated when execution starts.');
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

    if (isBinarySource) {
      if (!detectedMobileType) {
        toast.error('Upload a valid .apk, .aab, or .ipa file.');
        return;
      }
      formData.set('sourceType', detectedMobileType);
      formData.set('mode', 'uploaded');
    } else {
      formData.set('sourceType', sourceType);
    }

    startTransition(async () => {
      // Binary APK/AAB/IPA uploads go through a Route Handler instead of this
      // server action, since server actions in this Next.js version cap request
      // bodies at 1MB — far too small for a real app binary.
      const res = isBinarySource
        ? await fetch('/api/qa/runs/start-binary', { method: 'POST', body: formData }).then((r) => r.json())
        : await startUploadedTestExecution(formData);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success('AI test case execution started');
      setRunId(res.runId);
    });
  }

  const isLive = run && (run.status === 'running' || run.status === 'queued');

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
            <Link href={`/qa/runs/${runId}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Full Run Page <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        )}
      </div>

      {/* SECTION 1 — Configuration, full-width horizontal row */}
      <Card className="border-border bg-card/60 p-3 backdrop-blur">
        <h2 className="mb-2 px-1 font-display text-xs font-semibold uppercase tracking-wide text-muted-foreground">Test Run Configuration</h2>
        <div className="flex flex-wrap items-center gap-2">
          {SOURCE_TYPES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => selectSourceNav(s.value)}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition',
                configView === s.value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-secondary/70',
              )}
            >
              <span>{s.label}</span>
              {sourceType === s.value && configView !== s.value && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
            </button>
          ))}
          <div className="mx-1 h-6 w-px shrink-0 bg-border" />
          {PANEL_ITEMS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setConfigView(p.value)}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition',
                configView === p.value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-secondary/70',
              )}
            >
              <p.icon className="h-3.5 w-3.5 shrink-0" />
              <span>{p.label}</span>
            </button>
          ))}
          <div className="ml-auto shrink-0 rounded-lg border border-border bg-secondary/20 px-2.5 py-1.5 text-[10px] text-muted-foreground">
            {configReady ? '✓ Ready to execute' : '○ Configuration incomplete'}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px] xl:items-start">
        {/* SECTION 2 — Main workspace (70%) */}
        <div className="space-y-4">
          {!runId ? (
            <Card className="border-border bg-card/60 p-5 backdrop-blur">
              <form onSubmit={onSubmit} className="space-y-4">
                {/* Mobile upload — always mounted, visibility toggled so the
                    selected File survives switching between nav items. */}
                <div className={cn('space-y-2', configView === 'mobile' ? 'block' : 'hidden')}>
                  <Label htmlFor="appFile">Upload APK / AAB / IPA *</Label>
                  <label
                    htmlFor="appFile"
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-xs text-muted-foreground transition hover:bg-secondary/40"
                  >
                    <UploadCloud className="h-5 w-5 flex-shrink-0" />
                    {appFileName ? (
                      <span className="truncate text-foreground">{appFileName}</span>
                    ) : (
                      <span>Drag &amp; drop your .apk, .aab, or .ipa file, or click to browse.</span>
                    )}
                    <input
                      id="appFile"
                      name="appFile"
                      type="file"
                      accept={MOBILE_ACCEPT}
                      required={isBinarySource}
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        setAppFileName(file?.name ?? '');
                        setDetectedMobileType(file ? detectMobileType(file.name) : null);
                      }}
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

                {/* Generic URL / file-ref source types share one input so the
                    typed value is preserved regardless of which nav item is active. */}
                <div className={cn('space-y-2', SOURCE_TYPES.some((s) => s.value === configView && s.value !== 'mobile') ? 'block' : 'hidden')}>
                  <Label htmlFor="sourceRef">{SOURCE_REF_CONFIG[sourceType]?.label ?? 'Source URL'} *</Label>
                  <div className="flex gap-2">
                    <Input
                      id="sourceRef"
                      name="sourceRef"
                      required={!isBinarySource}
                      placeholder={SOURCE_REF_CONFIG[sourceType]?.placeholder}
                      onChange={() => setUrlValidation(null)}
                      className="flex-1"
                    />
                    {SOURCE_REF_CONFIG[sourceType]?.isUrl && (
                      <Button type="button" variant="outline" onClick={validateUrl} className="shrink-0 text-xs">Validate URL</Button>
                    )}
                  </div>
                  {urlValidation && (
                    <p className={cn('text-[11px] font-medium', urlValidation.valid ? 'text-emerald-500' : 'text-destructive')}>
                      {urlValidation.message}
                    </p>
                  )}
                </div>

                {/* Upload Test Case Sheet — always available alongside whichever
                    Source Type is selected, not a separate module. */}
                <div className={cn('space-y-2 border-t border-border pt-4', SOURCE_TYPES.some((s) => s.value === configView) ? 'block' : 'hidden')}>
                  <Label htmlFor="testCaseFile">Upload Excel / CSV *</Label>
                  <label
                    htmlFor="testCaseFile"
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-xs text-muted-foreground transition hover:bg-secondary/40"
                  >
                    <UploadCloud className="h-5 w-5 flex-shrink-0" />
                    {fileName ? (
                      <span className="flex items-center gap-1.5 truncate text-foreground"><FileSpreadsheet className="h-3.5 w-3.5" /> {fileName}</span>
                    ) : (
                      <span>Drag &amp; drop your .xlsx or .csv file, or click to browse.</span>
                    )}
                    <input
                      id="testCaseFile"
                      name="testCaseFile"
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      required
                      className="hidden"
                      onChange={onTestCaseFileChange}
                    />
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    Columns: {REQUIRED_COLUMNS.join(', ')}. Order/casing flexible — headers auto-matched.
                  </p>

                  {sheetPreviewError && <p className="text-[11px] text-destructive">{sheetPreviewError}</p>}

                  {sheetPreview && (
                    <div className="space-y-3 rounded-lg border border-border p-3">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <div><div className="text-[10px] text-muted-foreground">Test Case Count</div><div className="text-sm font-semibold">{sheetPreview.totalRows}</div></div>
                        <div><div className="text-[10px] text-muted-foreground">Scenario Count</div><div className="text-sm font-semibold">{sheetPreview.totalRows}</div></div>
                        <div><div className="text-[10px] text-muted-foreground">Modules Detected</div><div className="text-sm font-semibold">{sheetPreview.modules.length}</div></div>
                      </div>

                      <div>
                        <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Header Mapping</div>
                        <div className="flex flex-wrap gap-1.5">
                          {sheetPreview.headerMapping.map((h, i) => (
                            <Badge key={i} variant={h.mapsTo ? 'secondary' : 'outline'} className="text-[10px]">
                              {h.column} {h.mapsTo ? `→ ${h.mapsTo}` : '(unmapped)'}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      {sheetPreview.rows.length > 0 && (
                        <div>
                          <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Sheet Preview</div>
                          <div className="overflow-x-auto rounded-md border border-border">
                            <table className="w-full text-[10px]">
                              <thead>
                                <tr className="border-b border-border bg-secondary/30">
                                  {sheetPreview.headers.map((h, i) => <th key={i} className="whitespace-nowrap px-2 py-1 text-left font-medium">{h}</th>)}
                                </tr>
                              </thead>
                              <tbody>
                                {sheetPreview.rows.map((row, ri) => (
                                  <tr key={ri} className="border-b border-border last:border-0">
                                    {row.map((cell, ci) => <td key={ci} className="max-w-[120px] truncate whitespace-nowrap px-2 py-1 text-muted-foreground">{String(cell)}</td>)}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Execution Modules — real, derived from the uploaded sheet's Module column */}
                <div className={cn('space-y-2', configView === 'modules' ? 'block' : 'hidden')}>
                  <h3 className="font-display text-sm font-semibold">Execution Modules</h3>
                  <p className="text-xs text-muted-foreground">
                    Modules are detected automatically from your Test Case Sheet — no manual selection needed.
                  </p>
                  {sheetPreview && sheetPreview.modules.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {sheetPreview.modules.map((m) => (
                        <Badge key={m} variant="secondary" className="gap-1 text-xs"><ListChecks className="h-3 w-3" /> {m}</Badge>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                      Upload a Test Case Sheet to see detected modules.
                    </div>
                  )}
                </div>

                {/* Execution Settings — real, accurate description of engine behavior */}
                <div className={cn('space-y-2', configView === 'settings' ? 'block' : 'hidden')}>
                  <h3 className="font-display text-sm font-semibold">Execution Settings</h3>
                  <div className="space-y-2 text-xs">
                    <div className="rounded-lg border border-border p-3">
                      <div className="font-medium">AI Validation</div>
                      <p className="mt-1 text-muted-foreground">The first 15 test cases are validated with live AI reasoning when an AI provider key is configured in Settings; remaining cases use deterministic rule-based validation.</p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <div className="font-medium">Device Assignment</div>
                      <p className="mt-1 text-muted-foreground">A simulated device is automatically assigned per run — no manual device selection is required.</p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <div className="font-medium">Build Version</div>
                      <p className="mt-1 text-muted-foreground">Automatically derived from the uploaded application; defaults to 1.0.0 when unavailable.</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <Button type="submit" disabled={pending} className="w-full gap-2">
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    Start Execution
                  </Button>
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
                <StatCard label="ETA" value={run.etaSeconds != null ? `${run.etaSeconds}s` : '—'} icon={Hourglass} />
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
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                  <div><div className="text-muted-foreground">Current Scenario</div><div className="truncate font-medium" title={run.currentSuite ?? undefined}>{run.currentSuite ?? '—'}</div></div>
                  <div><div className="text-muted-foreground">Current Test Case ID</div><div className="truncate font-medium" title={run.currentCase ?? undefined}>{run.currentCase ?? '—'}</div></div>
                  <div><div className="text-muted-foreground">Current Test Step</div><div className="truncate font-medium" title={run.currentStep ?? undefined}>{run.currentStep ?? '—'}</div></div>
                  <div><div className="text-muted-foreground">Current Feature</div><div className="truncate font-medium" title={run.currentFeature ?? undefined}>{run.currentFeature ?? '—'}</div></div>
                  <div><div className="text-muted-foreground">Current Screen</div><div className="truncate font-medium" title={run.currentScreen ?? undefined}>{run.currentScreen ?? '—'}</div></div>
                  <div><div className="text-muted-foreground">Step Number</div><div className="font-medium">{testCases.filter((t) => t.result !== 'pending').length} / {testCases.length || run.totalCases}</div></div>
                  <div><div className="text-muted-foreground">Expected Result</div><div className="truncate font-medium" title={lastEvaluated?.expectedResult ?? undefined}>{lastEvaluated?.expectedResult ?? '—'}</div></div>
                  <div><div className="text-muted-foreground">Actual Result</div><div className="truncate font-medium" title={lastEvaluated?.actualResult ?? undefined}>{lastEvaluated?.actualResult ?? '—'}</div></div>
                  <div>
                    <div className="text-muted-foreground">Pass / Fail Status</div>
                    {lastEvaluated ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[lastEvaluated.result])} />
                        <Badge className={`${STATUS_BADGE[lastEvaluated.result]} text-[10px]`}>{lastEvaluated.result}</Badge>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                        <span className="font-medium">Running</span>
                      </span>
                    )}
                  </div>
                </div>
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
                        <TableHead>Priority</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Device</TableHead>
                        <TableHead>Platform</TableHead>
                        <TableHead>Bugs</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTestCases.length === 0 ? (
                        <TableRow><TableCell colSpan={9} className="py-8 text-center text-xs text-muted-foreground">No test cases match these filters.</TableCell></TableRow>
                      ) : filteredTestCases.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell><Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggleSelect(t.id)} /></TableCell>
                          <TableCell className="font-mono text-xs">{t.testCaseId}</TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs" title={t.scenario ?? t.name}>{t.scenario ?? t.name}</TableCell>
                          <TableCell className="text-xs">{t.module}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px] uppercase">{t.priority}</Badge></TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1.5">
                              <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[t.result])} />
                              <Badge className={`${STATUS_BADGE[t.result] ?? ''} text-[10px]`}>{t.result}</Badge>
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{run.currentDevice ?? '—'}</TableCell>
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
              <h2 className="font-display text-xs font-semibold">{run?.engineMode === 'real_browser' ? 'Live Browser' : 'Live Device'}</h2>
              {run && <Badge variant="secondary" className="text-[10px]">{run.engineMode === 'real_browser' ? 'Real' : 'Simulated'}</Badge>}
            </div>
            {!run ? (
              <Skeleton className="aspect-[9/16] max-h-56 w-full rounded-xl" />
            ) : (
              <div className="grid aspect-[9/16] max-h-56 place-items-center overflow-hidden rounded-xl border border-border bg-secondary/20">
                {screenshots.length > 0 ? (
                  <img src={screenshots[screenshots.length - 1].imageDataUrl} alt="Current screen" className="h-full w-full object-cover object-top" />
                ) : run.engineMode === 'real_browser' ? (
                  <Globe className="h-8 w-8 text-muted-foreground" />
                ) : (
                  <Smartphone className="h-8 w-8 text-muted-foreground" />
                )}
              </div>
            )}
            {run && (
              <div className="mt-3 space-y-1 text-[11px]">
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Device Name</span><span className="max-w-[60%] truncate">{run.currentDevice ?? '—'}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Current Screen</span><span className="max-w-[60%] truncate">{run.currentScreen ?? '—'}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">App Version</span><span>{run.buildVersion ?? '—'}</span></div>
                <div className="flex items-center justify-between"><span className="flex items-center gap-1 text-muted-foreground"><Battery className="h-3 w-3" /> Battery</span><span>{isLive ? '78%' : '—'}</span></div>
                <div className="flex items-center justify-between"><span className="flex items-center gap-1 text-muted-foreground"><Cpu className="h-3 w-3" /> CPU</span><span>{isLive ? '34%' : '—'}</span></div>
                <div className="flex items-center justify-between"><span className="flex items-center gap-1 text-muted-foreground"><MemoryStick className="h-3 w-3" /> Memory</span><span>{isLive ? '512 MB' : '—'}</span></div>
                <div className="flex items-center justify-between"><span className="flex items-center gap-1 text-muted-foreground"><Signal className="h-3 w-3" /> Network</span><span>{isLive ? 'Wi-Fi' : '—'}</span></div>
                <div className="flex items-center justify-between"><span className="flex items-center gap-1 text-muted-foreground"><Wifi className="h-3 w-3" /> Resolution</span><span>1080×2400</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Orientation</span><span>Portrait</span></div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn('h-1.5 w-1.5 rounded-full', isLive ? 'bg-emerald-500' : 'bg-muted-foreground')} />
                    {isLive ? 'Online' : 'Offline'}
                  </span>
                </div>
              </div>
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
    </div>
  );
}
