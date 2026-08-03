'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  Download, Eye, History, Loader2, RotateCcw, Search, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { rerunQaTestRun, deleteQaTestRun } from '@/app/qa/runs/actions';
import { exportCsv, exportExcel, exportPdf } from '@/lib/qa/export';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const STATUS_BADGE: Record<string, string> = {
  queued: 'bg-secondary text-muted-foreground',
  running: 'bg-primary/15 text-primary',
  passed: 'bg-success/15 text-success',
  failed: 'bg-destructive/15 text-destructive',
  partial: 'bg-amber-500/15 text-amber-500',
  cancelled: 'bg-secondary text-muted-foreground',
  // Never executed — deliberately not styled like a failure or a pass.
  blocked: 'bg-amber-500/15 text-amber-600 border border-amber-500/30',
};

const MODULE_TYPE_OPTIONS = [
  { value: 'all', label: 'All Module Types' },
  { value: 'catalog', label: 'Test Execution' },
  { value: 'uploaded', label: 'AI Test Case Execution' },
];

const PAGE_SIZES = [10, 25, 50, 100];

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return '—';
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const secs = Math.max(0, Math.round((end - new Date(startedAt).getTime()) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US');
}

export default function QaTestRunsPage() {
  const [pending, startTransition] = useTransition();
  const [runs, setRuns] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [moduleType, setModuleType] = useState('all');
  const [executedBy, setExecutedBy] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState('latest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (moduleType !== 'all') params.set('moduleType', moduleType);
    if (executedBy) params.set('executedBy', executedBy);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    params.set('sort', sort);
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    fetch(`/api/qa/runs?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => { setRuns(data.runs ?? []); setTotal(data.total ?? 0); })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, moduleType, executedBy, dateFrom, dateTo, sort, page, pageSize]);

  useEffect(() => { setPage(1); }, [search, moduleType, executedBy, dateFrom, dateTo, sort, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const exportRows = useMemo(() => runs.map((r) => ({
    'Run ID': `RUN-${r.runNumber}`,
    'Project Name': r.project?.name ?? '—',
    'Application Name': r.project?.appDisplayName ?? r.project?.name ?? '—',
    'Module Type': r.sourceMode === 'uploaded' ? 'AI Test Case Execution' : 'Test Execution',
    Platform: r.project?.platform ?? '—',
    'Device Name': r.currentDevice ?? '—',
    'Executed By': r.executedByName ?? '—',
    'Execution Date & Time': formatDateTime(r.startedAt ?? r.createdAt),
    'Execution Duration': formatDuration(r.startedAt, r.completedAt),
    Status: r.status,
    'Bugs Found': r.bugCount,
  })), [runs]);

  function handleExport(format: 'csv' | 'excel' | 'pdf') {
    if (exportRows.length === 0) { toast.error('No test runs to export.'); return; }
    if (format === 'csv') exportCsv('qa-test-runs.csv', exportRows);
    else if (format === 'excel') exportExcel('qa-test-runs.xlsx', exportRows, 'Test Runs');
    else exportPdf('qa-test-runs.pdf', 'QA Test Runs', 'Complete history of every executed test run', exportRows);
    toast.success(`${exportRows.length} test run(s) exported`);
  }

  function onRerun(runId: string) {
    setBusyId(runId);
    startTransition(async () => {
      const res = await rerunQaTestRun(runId);
      if (res?.error) toast.error(res.error);
      else { toast.success('Re-run started — a new run has been created.'); load(); }
      setBusyId(null);
    });
  }

  function onDelete(runId: string, runNumber: number) {
    if (!confirm(`Delete Run #${runNumber}? This removes its bugs, logs, screenshots, and test case results. This cannot be undone.`)) return;
    setBusyId(runId);
    startTransition(async () => {
      const res = await deleteQaTestRun(runId);
      if (res?.error) toast.error(res.error);
      else { toast.success('Test run deleted'); load(); }
      setBusyId(null);
    });
  }

  return (
    <div className="mx-auto max-w-[1800px] space-y-6 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
            <History className="h-6 w-6 text-primary" /> Test Runs
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The complete, permanent history of every test execution — nothing is ever overwritten.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleExport('csv')}><Download className="h-3.5 w-3.5" /> CSV</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleExport('excel')}><Download className="h-3.5 w-3.5" /> Excel</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleExport('pdf')}><Download className="h-3.5 w-3.5" /> PDF</Button>
        </div>
      </div>

      <Card className="border-border bg-card/60 p-4 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-md border border-input bg-background px-3">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by Run ID or Project Name..."
              className="h-full w-full bg-transparent text-xs outline-none"
            />
          </div>
          <Select value={moduleType} onValueChange={setModuleType}>
            <SelectTrigger className="h-9 w-[190px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODULE_TYPE_OPTIONS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input value={executedBy} onChange={(e) => setExecutedBy(e.target.value)} placeholder="Executed by..." className="h-9 w-[150px] text-xs" />
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-[150px] text-xs" />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-[150px] text-xs" />
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">Latest</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
              <SelectItem value="duration">Execution Time</SelectItem>
              <SelectItem value="bugCount">Bug Count</SelectItem>
              <SelectItem value="passed">Passed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden border-border bg-card/60 backdrop-blur">
        <div className="max-h-[65vh] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Run ID</TableHead>
                <TableHead>Project Name</TableHead>
                <TableHead>Application Name</TableHead>
                <TableHead>Module Type</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Device Name</TableHead>
                <TableHead>Executed By</TableHead>
                <TableHead>Execution Date &amp; Time</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={11} className="py-10 text-center text-sm text-muted-foreground">Loading...</TableCell></TableRow>
              ) : runs.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="py-10 text-center text-sm text-muted-foreground">No test runs match these filters.</TableCell></TableRow>
              ) : runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/qa/runs/${r.id}`} className="text-primary hover:underline">RUN-{r.runNumber}</Link>
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate text-xs">{r.project?.name ?? '—'}</TableCell>
                  <TableCell className="max-w-[160px] truncate text-xs">{r.project?.appDisplayName ?? r.project?.name ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">{r.sourceMode === 'uploaded' ? 'AI Test Case Execution' : 'Test Execution'}</Badge>
                  </TableCell>
                  <TableCell className="text-xs capitalize text-muted-foreground">{r.project?.platform ?? '—'}</TableCell>
                  <TableCell className="max-w-[140px] truncate text-xs text-muted-foreground">{r.currentDevice ?? '—'}</TableCell>
                  <TableCell className="max-w-[120px] truncate text-xs text-muted-foreground">{r.executedByName ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(r.startedAt ?? r.createdAt)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDuration(r.startedAt, r.completedAt)}</TableCell>
                  <TableCell><Badge className={`${STATUS_BADGE[r.status] ?? ''} text-[10px]`}>{r.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Link href={`/qa/runs/${r.id}`}>
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="View Report"><Eye className="h-3.5 w-3.5" /></Button>
                      </Link>
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Re-Run" disabled={pending && busyId === r.id} onClick={() => onRerun(r.id)}>
                        {pending && busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Delete" disabled={pending && busyId === r.id} onClick={() => onDelete(r.id, r.runNumber)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="h-8 w-[80px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((s) => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <span>{total} total run(s)</span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span>Page {page} of {totalPages}</span>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
