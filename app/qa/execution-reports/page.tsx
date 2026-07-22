'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, FileDown, FileSpreadsheet, FileText, GitCompare, ChevronDown,
  Bug as BugIcon, CheckCircle2, XCircle, Clock, X,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { exportCsv, exportExcel, exportPdf, bugsToRows } from '@/lib/qa/export';

const STATUS_STYLES: Record<string, string> = {
  passed: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  failed: 'bg-red-500/15 text-red-500 border-red-500/30',
  partial: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  running: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
  queued: 'bg-muted text-muted-foreground border-border',
  cancelled: 'bg-muted text-muted-foreground border-border',
};

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-500 border-red-500/30',
  high: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
  medium: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  low: 'bg-sky-500/15 text-sky-500 border-sky-500/30',
};

function formatDuration(seconds: number | null) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function durationOf(run: any): number | null {
  if (!run?.startedAt || !run?.completedAt) return null;
  return Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000);
}

function RunLabel({ run }: { run: any }) {
  const dt = new Date(run.createdAt);
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-left text-xs">
      <span className="truncate text-sm font-semibold">{run.project?.name ?? 'Unknown app'}</span>
      <span className="text-muted-foreground">Run #{run.runNumber}</span>
      <span className="text-muted-foreground">·</span>
      <span className="text-muted-foreground">{dt.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}</span>
      <span className="text-muted-foreground">{dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
      <span className="text-muted-foreground">·</span>
      <span className="text-muted-foreground">{run.currentDevice ?? 'No device'}</span>
      <span className="text-muted-foreground">·</span>
      <span className="text-muted-foreground">v{run.buildVersion}</span>
    </div>
  );
}

export default function ExecutionReportsPage() {
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<any>(null);
  const [testCases, setTestCases] = useState<any[]>([]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deviceFilter, setDeviceFilter] = useState('');
  const [executedByFilter, setExecutedByFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState('latest');

  const [severityFilter, setSeverityFilter] = useState<string[]>([]);
  const [activeTile, setActiveTile] = useState<'execution' | 'testcases'>('execution');

  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareData, setCompareData] = useState<any>(null);

  async function loadRuns() {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (deviceFilter) params.set('device', deviceFilter);
    if (executedByFilter) params.set('executedBy', executedByFilter);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    params.set('sort', sort);
    params.set('limit', '200');
    const res = await fetch(`/api/qa/runs?${params.toString()}`);
    const data = await res.json();
    setRuns(data.runs ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, deviceFilter, executedByFilter, dateFrom, dateTo, sort]);

  // Refs mirror the latest selection so async .then() callbacks can check
  // "is my request still the current one" — a value closed over at effect-start
  // never changes, so comparing against the closed-over state is a no-op; only
  // a ref mutated on every render reflects a newer selection made mid-flight.
  const selectedRunIdRef = useRef(selectedRunId);
  useEffect(() => { selectedRunIdRef.current = selectedRunId; }, [selectedRunId]);
  const compareIdsRef = useRef(compareIds);
  useEffect(() => { compareIdsRef.current = compareIds; }, [compareIds]);

  useEffect(() => {
    // Clear immediately on switch, and fence every response against the run it
    // was requested for — otherwise a slow response for a previously-selected
    // run can resolve after a newer selection and overwrite it with stale data.
    setRunDetail(null);
    setTestCases([]);
    if (!selectedRunId) return;
    const requestedFor = selectedRunId;

    fetch(`/api/qa/runs/compare?a=${requestedFor}&b=${requestedFor}`)
      .then((r) => r.json())
      .then((data) => { if (requestedFor === selectedRunIdRef.current) setRunDetail(data.a); });
    fetch(`/api/qa/test-cases?runId=${requestedFor}`)
      .then((r) => r.json())
      .then((data) => { if (requestedFor === selectedRunIdRef.current) setTestCases(data.testCases ?? []); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRunId]);

  useEffect(() => {
    if (compareIds.length !== 2) { setCompareData(null); return; }
    const requestedFor = [...compareIds];
    fetch(`/api/qa/runs/compare?a=${compareIds[0]}&b=${compareIds[1]}`)
      .then((r) => r.json())
      .then((data) => {
        const cur = compareIdsRef.current;
        if (requestedFor[0] === cur[0] && requestedFor[1] === cur[1]) setCompareData(data);
      });
  }, [compareIds]);

  const [runBugs, setRunBugs] = useState<any[]>([]);
  useEffect(() => {
    setRunBugs([]);
    if (!selectedRunId) return;
    const requestedFor = selectedRunId;
    fetch(`/api/qa/bugs?runId=${requestedFor}`)
      .then((r) => r.json())
      .then((d) => { if (requestedFor === selectedRunIdRef.current) setRunBugs(d.bugs ?? []); })
      .catch(() => { if (requestedFor === selectedRunIdRef.current) setRunBugs([]); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRunId]);

  const filteredBugs = useMemo(() => {
    if (severityFilter.length === 0) return runBugs;
    return runBugs.filter((b) => severityFilter.includes(b.severity));
  }, [runBugs, severityFilter]);

  const bugsBySeverity = useMemo(() => {
    const groups: Record<string, any[]> = { critical: [], high: [], medium: [], low: [] };
    filteredBugs.forEach((b) => { groups[b.severity]?.push(b); });
    return groups;
  }, [filteredBugs]);

  const selectedRun = runDetail?.run;

  function toggleSeverity(sev: string) {
    setSeverityFilter((prev) => (prev.includes(sev) ? prev.filter((s) => s !== sev) : [...prev, sev]));
  }

  function toggleCompareId(id: string) {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  }

  function handleExportCsv() {
    if (!selectedRun) return;
    exportCsv(`${selectedRun.runName || 'run'}-bugs.csv`, bugsToRows(runBugs));
  }
  function handleExportExcel() {
    if (!selectedRun) return;
    exportExcel(`${selectedRun.runName || 'run'}-bugs.xlsx`, bugsToRows(runBugs), 'Bugs');
  }
  function handleExportPdf() {
    if (!selectedRun) return;
    exportPdf(
      `${selectedRun.runName || 'run'}-report.pdf`,
      `Execution Report — ${selectedRun.project?.name ?? ''}`,
      `Run #${selectedRun.runNumber} · ${new Date(selectedRun.createdAt).toLocaleString()} · Build ${selectedRun.buildVersion} · ${selectedRun.currentDevice ?? ''}`,
      bugsToRows(runBugs),
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Execution Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every completed run is preserved permanently. Select a run to view its reports — nothing is re-executed.
          </p>
        </div>
        <Button
          variant={compareMode ? 'default' : 'outline'}
          size="sm"
          className="gap-2"
          onClick={() => { setCompareMode((v) => !v); setCompareIds([]); }}
        >
          <GitCompare className="h-4 w-4" /> Compare Runs
        </Button>
      </div>

      {/* Run History Dropdown */}
      <Card className="border-border bg-card/60 p-4 backdrop-blur">
        <button
          type="button"
          onClick={() => setDropdownOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-background/40 px-4 py-3 text-left"
        >
          {selectedRun && !compareMode ? <RunLabel run={selectedRun} /> : (
            <span className="text-sm text-muted-foreground">
              {compareMode ? `Select two runs to compare (${compareIds.length}/2 selected)` : 'Select a run from history…'}
            </span>
          )}
          <ChevronDown className={`h-4 w-4 flex-shrink-0 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {dropdownOpen && (
          <div className="mt-3 space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="relative sm:col-span-2 lg:col-span-1">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search app, run…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="passed">Passed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                  <SelectItem value="queued">Queued</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Device contains…" value={deviceFilter} onChange={(e) => setDeviceFilter(e.target.value)} />
              <Input placeholder="Executed by…" value={executedByFilter} onChange={(e) => setExecutedByFilter(e.target.value)} />
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger><SelectValue placeholder="Sort" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">Latest first</SelectItem>
                  <SelectItem value="oldest">Oldest first</SelectItem>
                  <SelectItem value="duration">Duration</SelectItem>
                  <SelectItem value="bugCount">Bug count</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="max-h-96 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {loading ? (
                <div className="p-6 text-center text-sm text-muted-foreground">Loading run history…</div>
              ) : runs.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No completed executions match these filters.</div>
              ) : (
                runs.map((r) => {
                  const isSelected = compareMode ? compareIds.includes(r.id) : selectedRunId === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        if (compareMode) { toggleCompareId(r.id); return; }
                        setSelectedRunId(r.id);
                        setDropdownOpen(false);
                        setSeverityFilter([]);
                        setActiveTile('execution');
                      }}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-secondary/50 ${isSelected ? 'bg-primary/10' : ''}`}
                    >
                      <RunLabel run={r} />
                      <Badge variant="outline" className={`flex-shrink-0 text-xs capitalize ${STATUS_STYLES[r.status] ?? ''}`}>{r.status}</Badge>
                      {r.bugCount > 0 && <Badge variant="outline" className="flex-shrink-0 gap-1 text-xs"><BugIcon className="h-3 w-3" />{r.bugCount}</Badge>}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </Card>

      {compareMode && compareData && (
        <Card className="border-border bg-card/60 p-5 backdrop-blur">
          <h2 className="mb-4 font-display text-lg font-semibold">Run Comparison</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {[compareData.a, compareData.b].map((d: any, i: number) => (
              <div key={i} className="rounded-lg border border-border p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">{d.run.project?.name}</span>
                  <Badge variant="outline" className={`text-xs capitalize ${STATUS_STYLES[d.run.status] ?? ''}`}>{d.run.status}</Badge>
                </div>
                <dl className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between"><dt>Run</dt><dd>#{d.run.runNumber}</dd></div>
                  <div className="flex justify-between"><dt>Date</dt><dd>{new Date(d.run.createdAt).toLocaleString()}</dd></div>
                  <div className="flex justify-between"><dt>Build</dt><dd>{d.run.buildVersion}</dd></div>
                  <div className="flex justify-between"><dt>Device</dt><dd>{d.run.currentDevice ?? '—'}</dd></div>
                  <div className="flex justify-between"><dt>Duration</dt><dd>{formatDuration(d.durationSeconds)}</dd></div>
                  <div className="flex justify-between"><dt>Total bugs</dt><dd>{d.bugCount}</dd></div>
                  {SEVERITY_ORDER.map((sev) => (
                    <div key={sev} className="flex justify-between capitalize"><dt>{sev}</dt><dd>{d.severityCounts[sev]}</dd></div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </Card>
      )}

      {!compareMode && selectedRun && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setActiveTile('execution')}
              className={`rounded-xl border p-4 text-left transition ${activeTile === 'execution' ? 'border-primary bg-primary/10' : 'border-border bg-card/40 hover:bg-secondary/40'}`}
            >
              <div className="flex items-center gap-2 text-sm font-semibold"><FileText className="h-4 w-4" /> Test Execution Report</div>
              <p className="mt-1 text-xs text-muted-foreground">Run summary, status breakdown, and full bug/issue report.</p>
            </button>
            <button
              type="button"
              onClick={() => setActiveTile('testcases')}
              className={`rounded-xl border p-4 text-left transition ${activeTile === 'testcases' ? 'border-primary bg-primary/10' : 'border-border bg-card/40 hover:bg-secondary/40'}`}
            >
              <div className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-4 w-4" /> Test Case Report</div>
              <p className="mt-1 text-xs text-muted-foreground">Every test case executed — {testCases.length} total.</p>
            </button>
          </div>

          <Card className="border-border bg-card/60 p-5 backdrop-blur">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-4">
                <div><div className="text-muted-foreground">Execution ID</div><div className="font-mono">{selectedRun.id.slice(-8)}</div></div>
                <div><div className="text-muted-foreground">Executed By</div><div>{selectedRun.executedByName || '—'}</div></div>
                <div><div className="text-muted-foreground">Duration</div><div>{formatDuration(durationOf(selectedRun))}</div></div>
                <div><div className="text-muted-foreground">Bugs Found</div><div>{runBugs.length}</div></div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={handleExportCsv}><FileDown className="h-3.5 w-3.5" /> CSV</Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={handleExportExcel}><FileSpreadsheet className="h-3.5 w-3.5" /> Excel</Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={handleExportPdf}><FileText className="h-3.5 w-3.5" /> PDF</Button>
              </div>
            </div>

            {activeTile === 'testcases' ? (
              <div className="divide-y divide-border">
                {testCases.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">No test cases recorded for this run.</div>
                ) : testCases.map((tc) => (
                  <div key={tc.id} className="flex items-center gap-3 py-2.5 text-sm">
                    {tc.result === 'pass' ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-500" /> : <XCircle className="h-4 w-4 flex-shrink-0 text-red-500" />}
                    <span className="font-mono text-xs text-muted-foreground">{tc.testCaseId}</span>
                    <span className="flex-1 truncate">{tc.name}</span>
                    <Badge variant="outline" className="text-xs capitalize">{tc.module}</Badge>
                    {tc.result === 'fail' && tc.failedStepNumber && (
                      <span className="text-xs text-muted-foreground">Step {tc.failedStepNumber}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap gap-2">
                  {SEVERITY_ORDER.map((sev) => (
                    <button
                      key={sev}
                      type="button"
                      onClick={() => toggleSeverity(sev)}
                      className={`rounded-full border px-3 py-1 text-xs capitalize transition ${SEVERITY_STYLES[sev]} ${severityFilter.length && !severityFilter.includes(sev) ? 'opacity-40' : ''}`}
                    >
                      {sev} ({bugsBySeverity[sev]?.length ?? 0})
                    </button>
                  ))}
                  {severityFilter.length > 0 && (
                    <button type="button" onClick={() => setSeverityFilter([])} className="flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                      <X className="h-3 w-3" /> Clear
                    </button>
                  )}
                </div>

                {filteredBugs.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {runBugs.length === 0 ? 'No bugs found — this run passed cleanly.' : 'No bugs match the selected severity filter.'}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {SEVERITY_ORDER.filter((sev) => (severityFilter.length === 0 || severityFilter.includes(sev)) && bugsBySeverity[sev]?.length).map((sev) => (
                      <div key={sev} className="space-y-2">
                        {bugsBySeverity[sev].map((b: any) => (
                          <details key={b.id} className="rounded-lg border border-border bg-background/30 p-3">
                            <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-medium">
                              <Badge variant="outline" className={`text-xs capitalize ${SEVERITY_STYLES[b.severity]}`}>{b.severity}</Badge>
                              <span className="font-mono text-xs text-muted-foreground">{b.bugNumber}</span>
                              <span>{b.title}</span>
                              <Badge variant="outline" className="ml-auto text-xs uppercase">{b.priority}</Badge>
                            </summary>
                            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                              <div><span className="text-muted-foreground">Category:</span> {b.type}</div>
                              <div><span className="text-muted-foreground">Module / Feature:</span> {b.module} / {b.feature}</div>
                              <div><span className="text-muted-foreground">Screen:</span> {b.screenName || '—'}</div>
                              <div><span className="text-muted-foreground">Test Case:</span> {b.testCaseId || '—'} {b.failedStepNumber ? `(step ${b.failedStepNumber})` : ''}</div>
                              <div><span className="text-muted-foreground">Device:</span> {b.deviceInfo || '—'}</div>
                              <div><span className="text-muted-foreground">OS Version:</span> {b.osVersion || '—'}</div>
                              <div><span className="text-muted-foreground">App Version:</span> {b.appVersion || '—'}</div>
                              <div><span className="text-muted-foreground">Status:</span> {b.status}</div>
                              <div className="sm:col-span-2"><span className="text-muted-foreground">Expected:</span> {b.expectedResult || '—'}</div>
                              <div className="sm:col-span-2"><span className="text-muted-foreground">Actual:</span> {b.actualResult || '—'}</div>
                              {b.stepsToReproduce?.length > 0 && (
                                <div className="sm:col-span-2">
                                  <span className="text-muted-foreground">Steps to Reproduce:</span>
                                  <ol className="ml-4 list-decimal">{b.stepsToReproduce.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>
                                </div>
                              )}
                              {b.apiRequest && <div className="sm:col-span-2"><span className="text-muted-foreground">API Request:</span> <code className="break-all">{b.apiRequest}</code></div>}
                              {b.apiResponse && <div className="sm:col-span-2"><span className="text-muted-foreground">API Response:</span> <code className="break-all">{b.apiResponse}</code></div>}
                              {b.stackTrace && <div className="sm:col-span-2"><span className="text-muted-foreground">Stack Trace:</span> <pre className="whitespace-pre-wrap break-all text-[11px]">{b.stackTrace}</pre></div>}
                              {b.logs && <div className="sm:col-span-2"><span className="text-muted-foreground">Logs:</span> <pre className="whitespace-pre-wrap break-all text-[11px]">{b.logs}</pre></div>}
                              <div className="sm:col-span-2"><span className="text-muted-foreground">AI Root Cause:</span> {b.aiRootCause || '—'}</div>
                              <div className="sm:col-span-2"><span className="text-muted-foreground">Suggested Fix:</span> {b.suggestedFix || '—'}</div>
                              {b.screenshotDataUrl && (
                                <div className="sm:col-span-2">
                                  <span className="text-muted-foreground">Screenshot:</span>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={b.screenshotDataUrl} alt="Bug screenshot" className="mt-1 max-w-xs rounded border border-border" />
                                </div>
                              )}
                            </div>
                          </details>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Card>
        </>
      )}

      {!compareMode && !selectedRun && (
        <Card className="border-border bg-card/40 p-10 text-center backdrop-blur">
          <Clock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Select a run from the history above to view its reports.</p>
        </Card>
      )}
    </div>
  );
}
