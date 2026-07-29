'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDownAZ, Check, Filter, KanbanSquare, Loader2, Search } from 'lucide-react';
import { BoardCard } from '@/components/modules/app-factory/issue-boards/board-card';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  BOARD_STATUSES, BOARD_STATUS_LABEL, MODULE_TYPE_LABEL, PRIORITIES, SEVERITIES,
} from '@/lib/issue-boards/constants';
import { BOARD_TABS, statusesForTab, type BoardTab } from '@/lib/issue-boards/board-display';
import { cn } from '@/lib/utils';

const SORTS = [
  { value: 'latest', label: 'Latest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'most_issues', label: 'Most Issues' },
  { value: 'recently_updated', label: 'Recently Updated' },
];

const PAGE_SIZES = [12, 24, 48];

interface FilterOptions {
  projects: string[];
  applications: string[];
  platforms: string[];
  developers: string[];
}

const EMPTY_OPTIONS: FilterOptions = { projects: [], applications: [], platforms: [], developers: [] };

/**
 * Board browsing UI shared by the App Factory and QA Workspace AI Issue
 * Boards pages: quick-filter tabs, search + filter + sort, the card grid,
 * and pagination. Each host page keeps its own header/widgets and just
 * renders this underneath.
 */
export function BoardsBrowser({
  basePath, pageSize: initialPageSize = 12, refreshSignal = 0,
}: { basePath: string; pageSize?: number; refreshSignal?: number }) {
  const [boards, setBoards] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<FilterOptions>(EMPTY_OPTIONS);

  const [tab, setTab] = useState<BoardTab>('all');
  const [search, setSearch] = useState('');
  const [project, setProject] = useState('all');
  const [application, setApplication] = useState('all');
  const [executionId, setExecutionId] = useState('');
  const [moduleType, setModuleType] = useState('all');
  const [platform, setPlatform] = useState('all');
  const [detailedStatus, setDetailedStatus] = useState('all');
  const [developer, setDeveloper] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [priority, setPriority] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState('latest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const activeFilterCount = [
    project !== 'all', application !== 'all', executionId !== '', moduleType !== 'all',
    platform !== 'all', detailedStatus !== 'all', developer !== 'all', severity !== 'all',
    priority !== 'all', dateFrom !== '', dateTo !== '',
  ].filter(Boolean).length;

  const load = useCallback(() => {
    void refreshSignal; // not read — its only role is to force a refetch when bumped
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort });
    if (search) params.set('search', search);
    if (project !== 'all') params.set('project', project);
    if (application !== 'all') params.set('application', application);
    if (executionId) params.set('executionId', executionId);
    if (moduleType !== 'all') params.set('moduleType', moduleType);
    if (platform !== 'all') params.set('platform', platform);
    if (developer !== 'all') params.set('developer', developer);
    if (severity !== 'all') params.set('severity', severity);
    if (priority !== 'all') params.set('priority', priority);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    // The detailed Status filter narrows within the active quick-filter tab —
    // if both are set, intersect them rather than letting one silently win.
    const tabStatuses = statusesForTab(tab);
    let effectiveStatuses: string[];
    if (detailedStatus === 'all') {
      effectiveStatuses = tabStatuses;
    } else if (tabStatuses.length === 0 || tabStatuses.includes(detailedStatus as (typeof tabStatuses)[number])) {
      effectiveStatuses = [detailedStatus];
    } else {
      effectiveStatuses = ['__none__']; // tab and detailed status contradict — show nothing rather than guess
    }
    if (effectiveStatuses.length > 0) params.set('status', effectiveStatuses.join(','));

    fetch(`/api/app-factory/issue-boards?${params.toString()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        setBoards(data.boards ?? []);
        setTotal(data.total ?? 0);
        if (data.filterOptions) setOptions(data.filterOptions);
      })
      .finally(() => setLoading(false));
  }, [tab, search, project, application, executionId, moduleType, platform, detailedStatus, developer, severity, priority, dateFrom, dateTo, sort, page, pageSize, refreshSignal]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { setPage(1); }, [
    tab, search, project, application, executionId, moduleType, platform, detailedStatus,
    developer, severity, priority, dateFrom, dateTo, sort, pageSize,
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const activeSort = SORTS.find((s) => s.value === sort) ?? SORTS[0];

  return (
    <div className="space-y-4">
      {/* Toolbar: Search, Active Filter tabs, Filter, Sort — one row, in this order, wraps cleanly on smaller screens */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-9 min-w-0 flex-1 basis-64 items-center gap-2 rounded-md border border-input bg-background px-3">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search boards, projects, applications, device or executor..."
            className="h-full w-full bg-transparent text-xs outline-none"
          />
        </div>

        <div className="max-w-full shrink-0 overflow-x-auto rounded-lg border border-border bg-secondary/40 p-1 scrollbar-thin">
          <div className="inline-flex items-center gap-1">
            {BOARD_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition',
                  tab === t.key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5">
              <Filter className="h-3.5 w-3.5" /> Filter
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-0.5 h-4 min-w-4 px-1 text-[10px]">{activeFilterCount}</Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[320px] space-y-2.5">
            <Select value={project} onValueChange={setProject}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Project" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {options.projects.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={application} onValueChange={setApplication}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Application" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Applications</SelectItem>
                {options.applications.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              value={executionId}
              onChange={(e) => setExecutionId(e.target.value)}
              placeholder="Execution ID"
              className="h-9 text-xs"
            />
            <Select value={moduleType} onValueChange={setModuleType}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Module Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Module Types</SelectItem>
                <SelectItem value="catalog">{MODULE_TYPE_LABEL.catalog}</SelectItem>
                <SelectItem value="uploaded">{MODULE_TYPE_LABEL.uploaded}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Platform" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Platforms</SelectItem>
                {options.platforms.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={detailedStatus} onValueChange={setDetailedStatus}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {BOARD_STATUSES.map((s) => <SelectItem key={s} value={s}>{BOARD_STATUS_LABEL[s]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={developer} onValueChange={setDeveloper}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Assigned Developer" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any Developer</SelectItem>
                {options.developers.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Severity" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any Severity</SelectItem>
                  {SEVERITIES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Priority" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any Priority</SelectItem>
                  {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p.toUpperCase()}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 text-xs" title="Executed from" />
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 text-xs" title="Executed to" />
            </div>
            {activeFilterCount > 0 && (
              <Button
                variant="ghost" size="sm" className="h-8 w-full text-xs text-muted-foreground"
                onClick={() => {
                  setProject('all'); setApplication('all'); setExecutionId(''); setModuleType('all');
                  setPlatform('all'); setDetailedStatus('all'); setDeveloper('all'); setSeverity('all');
                  setPriority('all'); setDateFrom(''); setDateTo('');
                }}
              >
                Clear filters
              </Button>
            )}
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5">
              <ArrowDownAZ className="h-3.5 w-3.5" /> Sort
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {SORTS.map((s) => (
              <DropdownMenuItem key={s.value} onClick={() => setSort(s.value)} className="justify-between gap-2">
                {s.label}
                {activeSort.value === s.value && <Check className="h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="text-xs text-muted-foreground">
        {loading ? 'Loading…' : `Showing ${boards.length} of ${total} board${total === 1 ? '' : 's'}`}
      </p>

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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {boards.map((b) => (
            <BoardCard key={b.id} board={b} href={`${basePath}/${b.id}`} />
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
