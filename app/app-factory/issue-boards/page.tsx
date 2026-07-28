'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  BarChart3, CalendarClock, CheckCircle2, KanbanSquare, Loader2, RefreshCw, Search,
  Smartphone, User2, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { syncIssueBoardsNow } from './actions';
import { IssueSummaryWidgets } from '@/components/modules/app-factory/issue-boards/issue-summary-widgets';
import { IssueBoardsBell } from '@/components/modules/app-factory/issue-boards/issue-boards-bell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  BOARD_STATUSES, BOARD_STATUS_BADGE, BOARD_STATUS_LABEL, MODULE_TYPE_LABEL,
  PRIORITIES, SEVERITIES,
} from '@/lib/issue-boards/constants';

const SORTS = [
  { value: 'latest', label: 'Latest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'most_issues', label: 'Most Issues' },
  { value: 'recently_updated', label: 'Recently Updated' },
];

const PAGE_SIZES = [12, 24, 48];

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US');
}

interface FilterOptions {
  projects: string[];
  applications: string[];
  platforms: string[];
  developers: string[];
}

export default function IssueBoardsPage() {
  const [boards, setBoards] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<FilterOptions>({ projects: [], applications: [], platforms: [], developers: [] });
  const [syncing, startSync] = useTransition();

  const [search, setSearch] = useState('');
  const [project, setProject] = useState('all');
  const [application, setApplication] = useState('all');
  const [executionId, setExecutionId] = useState('');
  const [moduleType, setModuleType] = useState('all');
  const [platform, setPlatform] = useState('all');
  const [status, setStatus] = useState('all');
  const [developer, setDeveloper] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [priority, setPriority] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState('latest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page), pageSize: String(pageSize), sort,
    });
    if (search) params.set('search', search);
    if (project !== 'all') params.set('project', project);
    if (application !== 'all') params.set('application', application);
    if (executionId) params.set('executionId', executionId);
    if (moduleType !== 'all') params.set('moduleType', moduleType);
    if (platform !== 'all') params.set('platform', platform);
    if (status !== 'all') params.set('status', status);
    if (developer !== 'all') params.set('developer', developer);
    if (severity !== 'all') params.set('severity', severity);
    if (priority !== 'all') params.set('priority', priority);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    fetch(`/api/app-factory/issue-boards?${params.toString()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        setBoards(data.boards ?? []);
        setTotal(data.total ?? 0);
        if (data.filterOptions) setOptions(data.filterOptions);
      })
      .finally(() => setLoading(false));
  }, [search, project, application, executionId, moduleType, platform, status, developer, severity, priority, dateFrom, dateTo, sort, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { setPage(1); }, [
    search, project, application, executionId, moduleType, platform, status,
    developer, severity, priority, dateFrom, dateTo, sort, pageSize,
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function onSync() {
    startSync(async () => {
      const res = await syncIssueBoardsNow();
      if (res?.error) toast.error(res.error);
      else {
        toast.success(res?.created ? `${res.created} new board(s) created.` : 'Boards are up to date.');
        load();
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

      {/* Search, filters, sorting */}
      <Card className="border-border bg-card/60 p-4 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-9 min-w-[240px] flex-1 items-center gap-2 rounded-md border border-input bg-background px-3">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search boards, projects, applications, device or executor..."
              className="h-full w-full bg-transparent text-xs outline-none"
            />
          </div>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-9 w-[170px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={project} onValueChange={setProject}>
            <SelectTrigger className="h-9 w-[170px] text-xs"><SelectValue placeholder="Project" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {options.projects.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={application} onValueChange={setApplication}>
            <SelectTrigger className="h-9 w-[170px] text-xs"><SelectValue placeholder="Application" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Applications</SelectItem>
              {options.applications.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            value={executionId}
            onChange={(e) => setExecutionId(e.target.value)}
            placeholder="Execution ID"
            className="h-9 w-[130px] text-xs"
          />
          <Select value={moduleType} onValueChange={setModuleType}>
            <SelectTrigger className="h-9 w-[180px] text-xs"><SelectValue placeholder="Module Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Module Types</SelectItem>
              <SelectItem value="catalog">{MODULE_TYPE_LABEL.catalog}</SelectItem>
              <SelectItem value="uploaded">{MODULE_TYPE_LABEL.uploaded}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="h-9 w-[140px] text-xs"><SelectValue placeholder="Platform" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Platforms</SelectItem>
              {options.platforms.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {BOARD_STATUSES.map((s) => <SelectItem key={s} value={s}>{BOARD_STATUS_LABEL[s]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={developer} onValueChange={setDeveloper}>
            <SelectTrigger className="h-9 w-[180px] text-xs"><SelectValue placeholder="Assigned Developer" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any Developer</SelectItem>
              {options.developers.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger className="h-9 w-[140px] text-xs"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any Severity</SelectItem>
              {SEVERITIES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="h-9 w-[130px] text-xs"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any Priority</SelectItem>
              {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p.toUpperCase()}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-[150px] text-xs" title="Executed from" />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-[150px] text-xs" title="Executed to" />
        </div>
      </Card>

      {/* Board cards */}
      {loading ? (
        <Card className="border-border bg-card/40 p-10 text-center text-sm text-muted-foreground backdrop-blur">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading boards…
        </Card>
      ) : boards.length === 0 ? (
        <Card className="border-border bg-card/40 p-10 text-center backdrop-blur">
          <KanbanSquare className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No boards match these filters.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Boards appear here automatically as soon as a Test Execution or AI Test Case Execution completes.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {boards.map((b) => (
            <Link key={b.id} href={`/app-factory/issue-boards/${b.id}`} className="group">
              <Card className="h-full border-border bg-card/60 p-4 backdrop-blur transition hover:border-primary/50 hover:bg-card">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-sm font-semibold leading-snug group-hover:text-primary">
                    {b.boardName}
                  </h3>
                  <Badge className={`${BOARD_STATUS_BADGE[b.status as keyof typeof BOARD_STATUS_BADGE] ?? ''} shrink-0 text-[10px]`}>
                    {BOARD_STATUS_LABEL[b.status as keyof typeof BOARD_STATUS_LABEL] ?? b.status}
                  </Badge>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                  <div className="truncate"><span className="text-muted-foreground">Project: </span>{b.projectName || '—'}</div>
                  <div className="truncate"><span className="text-muted-foreground">Application: </span>{b.applicationName || '—'}</div>
                  <div className="truncate"><span className="text-muted-foreground">Execution ID: </span>
                    <span className="font-mono">#{b.executionId}</span>
                  </div>
                  <div className="truncate"><span className="text-muted-foreground">Module: </span>
                    {MODULE_TYPE_LABEL[b.moduleType] ?? b.moduleType}
                  </div>
                  <div className="truncate capitalize"><span className="text-muted-foreground">Platform: </span>{b.platform || '—'}</div>
                  <div className="flex items-center gap-1 truncate">
                    <Smartphone className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate" title={b.deviceName}>{b.deviceName || '—'}</span>
                  </div>
                  <div className="flex items-center gap-1 truncate">
                    <User2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{b.executedByName || '—'}</span>
                  </div>
                  <div className="flex items-center gap-1 truncate">
                    <CalendarClock className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{formatDateTime(b.executedAt)}</span>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-4 gap-2 border-t border-border pt-3 text-center">
                  <div>
                    <div className="font-display text-base font-semibold tabular-nums">{b.totalCases}</div>
                    <div className="text-[10px] text-muted-foreground">Test Cases</div>
                  </div>
                  <div>
                    <div className="flex items-center justify-center gap-1 font-display text-base font-semibold tabular-nums text-emerald-500">
                      <CheckCircle2 className="h-3 w-3" />{b.passedCases}
                    </div>
                    <div className="text-[10px] text-muted-foreground">Passed</div>
                  </div>
                  <div>
                    <div className="flex items-center justify-center gap-1 font-display text-base font-semibold tabular-nums text-destructive">
                      <XCircle className="h-3 w-3" />{b.failedCases}
                    </div>
                    <div className="text-[10px] text-muted-foreground">Failed</div>
                  </div>
                  <div>
                    <div className="font-display text-base font-semibold tabular-nums text-primary">{b.totalIssues}</div>
                    <div className="text-[10px] text-muted-foreground">Issues</div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      <Card className="flex flex-wrap items-center justify-between gap-3 border-border bg-card/60 px-4 py-3 text-xs text-muted-foreground backdrop-blur">
        <div className="flex items-center gap-2">
          <span>Boards per page</span>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger className="h-8 w-[80px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((s) => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <span>{total} board(s) — full execution history preserved</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span>Page {page} of {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </Card>
    </div>
  );
}
