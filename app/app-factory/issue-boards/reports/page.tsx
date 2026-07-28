'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BarChart3, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { exportCsv, exportExcel, exportPdf } from '@/lib/qa/export';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { CATEGORY_LABEL, PRIORITY_LABEL } from '@/lib/issue-boards/constants';

type ReportKey = 'summary' | 'developer' | 'resolution' | 'reopened' | 'module';

const REPORTS: Array<{ key: ReportKey; label: string; description: string }> = [
  { key: 'summary', label: 'Issue Summary', description: 'Totals by column, severity, priority and issue category.' },
  { key: 'developer', label: 'Developer Performance', description: 'Assignment load, closure rate and average resolution time.' },
  { key: 'resolution', label: 'Resolution Report', description: 'Every closed issue with the time it took to resolve.' },
  { key: 'reopened', label: 'Reopened Report', description: 'Issues QA reopened after a fix failed retest.' },
  { key: 'module', label: 'Module-wise Report', description: 'Issue distribution across application modules.' },
];

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('en-US') : '—';
}

export default function IssueBoardReportsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ReportKey>('summary');
  const [boardId, setBoardId] = useState('all');
  const [project, setProject] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (boardId !== 'all') params.set('boardId', boardId);
    if (project !== 'all') params.set('project', project);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    fetch(`/api/app-factory/issue-boards/reports?${params.toString()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [boardId, project, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const boards: any[] = useMemo(() => data?.boards ?? [], [data]);
  const projects = useMemo(
    () => Array.from(new Set(boards.map((b) => b.projectName).filter(Boolean))).sort(),
    [boards],
  );

  /** One flat row-set per report — the shape both the table and the exports use. */
  const rows: Record<string, unknown>[] = useMemo(() => {
    if (!data) return [];
    switch (report) {
      case 'summary': {
        const s = data.issueSummary;
        return [
          { Metric: 'Total Issues', Value: s.totalIssues },
          { Metric: 'New', Value: s.new },
          { Metric: 'Assigned', Value: s.assigned },
          { Metric: 'In Progress', Value: s.inProgress },
          { Metric: 'Ready for QA', Value: s.readyForQa },
          { Metric: 'Reopened', Value: s.reopened },
          { Metric: 'Closed', Value: s.closed },
          ...s.bySeverity.map((r: any) => ({ Metric: `Severity — ${r.severity}`, Value: r.count })),
          ...s.byPriority.map((r: any) => ({ Metric: `Priority — ${PRIORITY_LABEL[r.priority] ?? r.priority}`, Value: r.count })),
          ...s.byCategory.map((r: any) => ({ Metric: `Category — ${CATEGORY_LABEL[r.category] ?? r.category}`, Value: r.count })),
        ];
      }
      case 'developer':
        return data.developerPerformance.map((d: any) => ({
          Developer: d.developer,
          Assigned: d.assigned,
          'In Progress': d.inProgress,
          'Ready for QA': d.readyForQa,
          Closed: d.closed,
          Reopened: d.reopened,
          Critical: d.critical,
          'Closure Rate %': d.closureRate,
          'Avg Resolution (h)': d.avgResolutionHours ?? '—',
        }));
      case 'resolution':
        return data.resolution.map((r: any) => ({
          'Issue ID': r.issueKey,
          Title: r.title,
          Severity: r.severity,
          Priority: r.priority,
          Developer: r.developer,
          Project: r.project,
          'Execution ID': `#${r.executionId}`,
          Detected: formatDate(r.createdAt),
          Closed: formatDate(r.closedAt),
          'Resolution (h)': r.resolutionHours ?? '—',
          Reopens: r.reopenCount,
        }));
      case 'reopened':
        return data.reopened.map((r: any) => ({
          'Issue ID': r.issueKey,
          Title: r.title,
          Status: r.status,
          Severity: r.severity,
          Developer: r.developer,
          Project: r.project,
          Application: r.application,
          'Execution ID': `#${r.executionId}`,
          Module: r.module || '—',
          'Reopen Count': r.reopenCount,
        }));
      case 'module':
        return data.moduleWise.map((m: any) => ({
          Module: m.module,
          'Total Issues': m.totalIssues,
          Critical: m.critical,
          High: m.high,
          Open: m.open,
          Closed: m.closed,
          Reopened: m.reopened,
        }));
      default:
        return [];
    }
  }, [data, report]);

  const active = REPORTS.find((r) => r.key === report)!;
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

  function handleExport(format: 'csv' | 'excel' | 'pdf') {
    if (rows.length === 0) { toast.error('Nothing to export for this report.'); return; }
    const slug = `ai-issue-boards-${report}`;
    if (format === 'csv') exportCsv(`${slug}.csv`, rows);
    else if (format === 'excel') exportExcel(`${slug}.xlsx`, rows, active.label);
    else exportPdf(`${slug}.pdf`, `AI Issue Boards — ${active.label}`, active.description, rows);
    toast.success(`${active.label} exported (${rows.length} row(s))`);
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link href="/app-factory/issue-boards">
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Back to boards">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
              <BarChart3 className="h-6 w-6 text-primary" /> Issue Board Reports
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{active.description}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleExport('csv')}><Download className="h-3.5 w-3.5" /> CSV</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleExport('excel')}><Download className="h-3.5 w-3.5" /> Excel</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleExport('pdf')}><Download className="h-3.5 w-3.5" /> PDF</Button>
        </div>
      </div>

      <Card className="border-border bg-card/60 p-4 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={report} onValueChange={(v) => setReport(v as ReportKey)}>
            <SelectTrigger className="h-9 w-[220px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {REPORTS.map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={project} onValueChange={(v) => { setProject(v); setBoardId('all'); }}>
            <SelectTrigger className="h-9 w-[180px] text-xs"><SelectValue placeholder="Project" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={boardId} onValueChange={setBoardId}>
            <SelectTrigger className="h-9 w-[280px] text-xs"><SelectValue placeholder="Board" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Boards</SelectItem>
              {boards.map((b) => <SelectItem key={b.id} value={b.id}>{b.boardName}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-[150px] text-xs" title="From" />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-[150px] text-xs" title="To" />
        </div>
      </Card>

      <Card className="overflow-hidden border-border bg-card/60 backdrop-blur">
        <div className="max-h-[65vh] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                {headers.map((h) => <TableHead key={h} className="whitespace-nowrap text-xs">{h}</TableHead>)}
                {headers.length === 0 && <TableHead>Report</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={Math.max(headers.length, 1)} className="py-10 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Building report…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={Math.max(headers.length, 1)} className="py-10 text-center text-sm text-muted-foreground">
                    No data for this report yet.
                  </TableCell>
                </TableRow>
              ) : rows.map((row, i) => (
                <TableRow key={i}>
                  {headers.map((h) => (
                    <TableCell key={h} className="whitespace-nowrap text-xs">{String(row[h] ?? '—')}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
