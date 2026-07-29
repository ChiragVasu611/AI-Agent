'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Cpu, Gauge, Hourglass,
  Layers, Loader2, Plus, ShieldAlert, Timer, Trash2, XCircle, Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MetricCard, MetricCardSkeleton, type MetricState } from '@/components/dashboard/metric-card';
import { StatusBadge } from '@/components/dashboard/status-badge';
import {
  ChartCard, DashboardPageHeader, DashboardSection, EmptyState, HealthIndicator,
} from '@/components/dashboard/section';
import { CategoryBarChart, DonutChart } from '@/components/dashboard/charts';

interface QaStats {
  totalRuns: number; runningRuns: number; queuedRuns: number; passedRuns: number; failedRuns: number;
  successRate: number; avgExecSeconds: number | null; fastestSeconds: number | null; slowestSeconds: number | null;
  etaSeconds: number | null; totalBugs: number; critical: number; high: number; medium: number; low: number;
  crashCount: number; anrCount: number; securityCount: number; avgPerformanceScore: number | null;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

export default function QaDashboardPage() {
  const [stats, setStats] = useState<QaStats | null>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [devicesConfigured, setDevicesConfigured] = useState(false);
  const [deviceCount, setDeviceCount] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /**
   * Real API health. Previously this panel was a hard-coded "Operational" badge
   * that claimed the API was up even while it was failing. It now reflects the
   * actual outcome of the dashboard's own polling: the API answered, or it did
   * not. `null` = not yet determined (first load).
   */
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);

  async function onDeleteRun(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm('Permanently delete this test run and all of its execution data (results, screenshots, logs, bugs)? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/qa/runs/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to delete test run');
        return;
      }
      setRuns((prev) => prev.filter((r) => r.id !== id));
      toast.success('Test run permanently deleted');
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    // Same three endpoints and the same 3000ms polling interval as before.
    async function load() {
      try {
        const [statsRes, runsRes, devicesRes] = await Promise.all([
          fetch('/api/qa/stats').then((r) => r.json()),
          fetch('/api/qa/runs?limit=8').then((r) => r.json()),
          fetch('/api/qa/devices').then((r) => r.json()),
        ]);
        if (cancelled) return;
        setStats(statsRes);
        setRuns(runsRes.runs ?? []);
        setDevicesConfigured(devicesRes.configured ?? false);
        // Real device count, straight from the devices endpoint.
        setDeviceCount(
          Array.isArray(devicesRes.devices)
            ? devicesRes.devices.filter((d: any) => d.status === 'online').length
            : null,
        );
        setApiReachable(true);
      } catch {
        // A failed poll is itself the health signal — don't claim "Operational".
        if (!cancelled) setApiReachable(false);
      }
    }
    load();
    const interval = setInterval(load, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const s = stats;

  const primaryCards: Array<{
    label: string; value: string | number; icon: typeof Layers; state?: MetricState;
  }> = [
    { label: 'Total Test Runs', value: s?.totalRuns ?? '—', icon: Layers },
    { label: 'Running', value: s?.runningRuns ?? '—', icon: Activity, state: s?.runningRuns ? 'default' : undefined },
    { label: 'Queued', value: s?.queuedRuns ?? '—', icon: Hourglass },
    { label: 'Passed', value: s?.passedRuns ?? '—', icon: CheckCircle2, state: 'success' },
    { label: 'Failed', value: s?.failedRuns ?? '—', icon: XCircle, state: s?.failedRuns ? 'critical' : undefined },
    { label: 'Success Rate', value: s ? `${s.successRate}%` : '—', icon: Gauge },
  ];

  const timingCards = [
    { label: 'Avg Execution Time', value: formatDuration(s?.avgExecSeconds ?? null), icon: Clock },
    { label: 'Fastest Execution', value: formatDuration(s?.fastestSeconds ?? null), icon: Zap },
    { label: 'Slowest Execution', value: formatDuration(s?.slowestSeconds ?? null), icon: Timer },
    { label: 'ETA (Running Test)', value: s?.etaSeconds != null ? formatDuration(s.etaSeconds) : '—', icon: Hourglass },
  ];

  const healthCards = [
    { label: 'Crash Count', value: s?.crashCount ?? '—', icon: XCircle },
    { label: 'ANR Count', value: s?.anrCount ?? '—', icon: AlertTriangle },
    { label: 'Security Issues', value: s?.securityCount ?? '—', icon: ShieldAlert },
    { label: 'Performance Score', value: s?.avgPerformanceScore != null ? `${s.avgPerformanceScore}/100` : '—', icon: Cpu },
  ];

  /**
   * Severity distribution, from the same four real counters the cards used.
   * Colours are semantic tokens instead of the previous hard-coded
   * `text-amber-600` / `text-yellow-500` Tailwind palette values.
   */
  const severityData = s
    ? [
      { name: 'Critical', value: s.critical, color: 'hsl(var(--destructive))' },
      { name: 'High', value: s.high, color: 'hsl(var(--chart-6))' },
      { name: 'Medium', value: s.medium, color: 'hsl(var(--warning))' },
      { name: 'Low', value: s.low, color: 'hsl(var(--info))' },
    ]
    : [];

  /** Run outcome mix — every value is a real counter from /api/qa/stats. */
  const outcomeData = s
    ? [
      { name: 'Passed', value: s.passedRuns, color: 'hsl(var(--success))' },
      { name: 'Failed', value: s.failedRuns, color: 'hsl(var(--destructive))' },
      { name: 'Running', value: s.runningRuns, color: 'hsl(var(--chart-1))' },
      { name: 'Queued', value: s.queuedRuns, color: 'hsl(var(--muted-foreground))' },
    ]
    : [];

  const loading = s == null;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <DashboardPageHeader
        title="QA Command Center"
        description="Real-time test execution, AI bug detection, and quality analytics across every app under test."
        meta={s?.runningRuns ? <StatusBadge status="running" label={`${s.runningRuns} run(s) in progress`} /> : undefined}
        actions={(
          <Button asChild className="gap-2">
            <Link href="/qa/test-execution"><Plus className="h-4 w-4" /> New Test Run</Link>
          </Button>
        )}
      />

      {/* Execution overview — live counters. */}
      <DashboardSection
        title="Execution overview"
        description="Current run volume and outcomes. Updates every few seconds while runs are active."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => <MetricCardSkeleton key={i} />)
            : primaryCards.map((c) => (
              <MetricCard key={c.label} label={c.label} value={c.value} icon={c.icon} state={c.state} />
            ))}
        </div>
      </DashboardSection>

      {/* Execution performance — timing metrics, all real or em-dash. */}
      <DashboardSection
        title="Execution performance"
        description="How long runs take. Values appear once at least one run has completed."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
            : timingCards.map((c) => (
              <MetricCard key={c.label} label={c.label} value={c.value} icon={c.icon} />
            ))}
        </div>
      </DashboardSection>

      {/* Stability & security signals — same four real counters as before. */}
      <DashboardSection
        title="Stability & security"
        description="Crash, ANR, security and performance signals captured during execution."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
            : healthCards.map((c) => (
              <MetricCard
                key={c.label}
                label={c.label}
                value={c.value}
                icon={c.icon}
                // Only the three fault counters escalate; the score is neutral.
                state={c.label !== 'Performance Score' && typeof c.value === 'number' && c.value > 0
                  ? 'critical'
                  : 'default'}
              />
            ))}
        </div>
      </DashboardSection>

      {/* Quality outcomes — two charts built only from real counters. */}
      <DashboardSection
        title="Quality outcomes"
        description="Where runs land, and how the bugs found break down by severity."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Run outcome distribution"
            description="Every recorded run by its final (or current) state."
            summary={s
              ? `Passed ${s.passedRuns}, failed ${s.failedRuns}, running ${s.runningRuns}, queued ${s.queuedRuns}.`
              : undefined}
          >
            <DonutChart
              data={outcomeData}
              emptyMessage="No runs recorded yet. Start a test run to see the outcome mix."
              centerValue={s ? `${s.successRate}%` : undefined}
              centerLabel="pass rate"
            />
          </ChartCard>

          <ChartCard
            title="Bugs by severity"
            description="All bugs detected across runs, grouped by severity."
            summary={s
              ? `Critical ${s.critical}, high ${s.high}, medium ${s.medium}, low ${s.low}; ${s.totalBugs} total.`
              : undefined}
          >
            <CategoryBarChart
              data={severityData}
              layout="vertical"
              emptyMessage="No bugs detected yet. Severity appears here once a run files findings."
            />
          </ChartCard>
        </div>
      </DashboardSection>

      {/* Infrastructure health — separated from analytics, and now honest. */}
      <DashboardSection
        title="Infrastructure health"
        description="Live status of the services and devices this workspace depends on."
      >
        <Card className="rounded-card border-border bg-card p-5 elevation-card">
          <div className="grid gap-4 sm:grid-cols-2">
            <HealthIndicator
              label="QA API"
              // Derived from the dashboard's own polling result, not asserted.
              state={apiReachable == null ? 'unknown' : apiReachable ? 'healthy' : 'down'}
              detail={apiReachable == null ? 'Checking…' : apiReachable ? 'Responding' : 'Unreachable'}
            />
            <HealthIndicator
              label="Connected devices"
              state={!devicesConfigured ? 'unknown' : (deviceCount ?? 0) > 0 ? 'healthy' : 'degraded'}
              detail={
                !devicesConfigured
                  ? 'Not configured'
                  : deviceCount == null
                    ? 'Unknown'
                    : `${deviceCount} online`
              }
            />
          </div>
        </Card>
      </DashboardSection>

      <DashboardSection
        title="Recent test runs"
        description="The eight most recent executions. Click a run to open its live report."
        action={<Link href="/qa/test-execution" className="type-caption font-medium text-primary hover:underline">View all</Link>}
      >
        <Card className="overflow-hidden rounded-card border-border bg-card elevation-card">
          {runs.length === 0 ? (
            /* Existing truthful copy preserved. */
            <EmptyState
              icon={Layers}
              title="No test runs yet"
              description="Start your first run to see live execution here."
              action={(
                <Button asChild size="sm" className="gap-1.5">
                  <Link href="/qa/test-execution"><Plus className="h-3.5 w-3.5" /> New Test Run</Link>
                </Button>
              )}
            />
          ) : (
            <ul className="divide-y divide-border">
              {runs.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface">
                  <Link href={`/qa/runs/${r.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-control outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-secondary text-muted-foreground ring-1 ring-inset ring-border">
                      <Layers className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{r.project?.name ?? 'Unknown app'}</div>
                      <div className="type-caption nums truncate text-muted-foreground">
                        {r.modules?.length ?? 0} module(s) · {new Date(r.createdAt).toLocaleString()}
                      </div>
                    </div>
                    {r.status === 'running' && (
                      <span className="type-caption nums shrink-0 text-muted-foreground">{r.progress}%</span>
                    )}
                    <StatusBadge status={r.status} />
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete test run"
                    title="Delete test run permanently"
                    disabled={deletingId === r.id}
                    onClick={(e) => onDeleteRun(e, r.id)}
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    {deletingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </DashboardSection>
    </div>
  );
}
