'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity, AlertTriangle, Bug, CheckCircle2, Clock, Cpu, Gauge, Hourglass,
  Layers, Plus, ShieldAlert, Timer, Users, XCircle, Zap,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [statsRes, runsRes, devicesRes] = await Promise.all([
        fetch('/api/qa/stats').then((r) => r.json()),
        fetch('/api/qa/runs?limit=8').then((r) => r.json()),
        fetch('/api/qa/devices').then((r) => r.json()),
      ]);
      if (cancelled) return;
      setStats(statsRes);
      setRuns(runsRes.runs ?? []);
      setDevicesConfigured(devicesRes.configured ?? false);
    }
    load();
    const interval = setInterval(load, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const s = stats;

  const primaryCards = [
    { label: 'Total Test Runs', value: s?.totalRuns ?? '—', icon: Layers },
    { label: 'Running', value: s?.runningRuns ?? '—', icon: Activity },
    { label: 'Queued', value: s?.queuedRuns ?? '—', icon: Hourglass },
    { label: 'Passed', value: s?.passedRuns ?? '—', icon: CheckCircle2 },
    { label: 'Failed', value: s?.failedRuns ?? '—', icon: XCircle },
    { label: 'Success Rate', value: s ? `${s.successRate}%` : '—', icon: Gauge },
  ];

  const timingCards = [
    { label: 'Avg Execution Time', value: formatDuration(s?.avgExecSeconds ?? null), icon: Clock },
    { label: 'Fastest Execution', value: formatDuration(s?.fastestSeconds ?? null), icon: Zap },
    { label: 'Slowest Execution', value: formatDuration(s?.slowestSeconds ?? null), icon: Timer },
    { label: 'ETA (Running Test)', value: s?.etaSeconds != null ? formatDuration(s.etaSeconds) : '—', icon: Hourglass },
  ];

  const bugCards = [
    { label: 'Total Bugs Found', value: s?.totalBugs ?? '—', icon: Bug },
    { label: 'Critical', value: s?.critical ?? '—', icon: AlertTriangle, color: 'text-destructive' },
    { label: 'High', value: s?.high ?? '—', icon: AlertTriangle, color: 'text-amber-600' },
    { label: 'Medium', value: s?.medium ?? '—', icon: AlertTriangle, color: 'text-yellow-500' },
    { label: 'Low', value: s?.low ?? '—', icon: AlertTriangle, color: 'text-muted-foreground' },
  ];

  const healthCards = [
    { label: 'Crash Count', value: s?.crashCount ?? '—', icon: XCircle },
    { label: 'ANR Count', value: s?.anrCount ?? '—', icon: AlertTriangle },
    { label: 'Security Issues', value: s?.securityCount ?? '—', icon: ShieldAlert },
    { label: 'Performance Score', value: s?.avgPerformanceScore != null ? `${s.avgPerformanceScore}/100` : '—', icon: Cpu },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">QA Command Center</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Real-time test execution, AI bug detection, and quality analytics across every app under test.
          </p>
        </div>
        <Link href="/qa/test-execution">
          <Button className="gap-2"><Plus className="h-4 w-4" /> New Test Run</Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {primaryCards.map((c) => (
          <Card key={c.label} className="border-border bg-card/60 p-5 backdrop-blur">
            <c.icon className="h-5 w-5 text-primary" />
            <div className="mt-3 font-display text-2xl font-semibold">{c.value}</div>
            <div className="text-xs text-muted-foreground">{c.label}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {timingCards.map((c) => (
          <Card key={c.label} className="border-border bg-card/60 p-5 backdrop-blur">
            <c.icon className="h-5 w-5 text-primary" />
            <div className="mt-3 font-display text-2xl font-semibold">{c.value}</div>
            <div className="text-xs text-muted-foreground">{c.label}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {bugCards.map((c) => (
          <Card key={c.label} className="border-border bg-card/60 p-5 backdrop-blur">
            <c.icon className={`h-5 w-5 ${c.color ?? 'text-primary'}`} />
            <div className="mt-3 font-display text-2xl font-semibold">{c.value}</div>
            <div className="text-xs text-muted-foreground">{c.label}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {healthCards.map((c) => (
          <Card key={c.label} className="border-border bg-card/60 p-5 backdrop-blur">
            <c.icon className="h-5 w-5 text-primary" />
            <div className="mt-3 font-display text-2xl font-semibold">{c.value}</div>
            <div className="text-xs text-muted-foreground">{c.label}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-border bg-card/60 p-5 backdrop-blur">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">API Health</span>
            <Badge className="bg-success/15 text-success hover:bg-success/15">Operational</Badge>
          </div>
        </Card>
        <Card className="border-border bg-card/60 p-5 backdrop-blur">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Device Status</span>
            <Badge variant={devicesConfigured ? 'default' : 'secondary'}>
              {devicesConfigured ? 'Connected' : 'Not configured'}
            </Badge>
          </div>
        </Card>
        <Card className="border-border bg-card/60 p-5 backdrop-blur">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-medium"><Users className="h-4 w-4" /> Active Users</span>
            <span className="font-display text-lg font-semibold">1</span>
          </div>
        </Card>
      </div>

      <Card className="border-border bg-card/60 p-6 backdrop-blur">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Recent Test Runs</h2>
          <Link href="/qa/test-execution" className="text-sm text-primary hover:underline">View all</Link>
        </div>
        {runs.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No test runs yet. Start your first run to see live execution here.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {runs.map((r) => (
              <Link
                key={r.id}
                href={`/qa/runs/${r.id}`}
                className="flex items-center gap-3 py-3 transition hover:bg-secondary/50"
              >
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary text-muted-foreground">
                  <Layers className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.project?.name ?? 'Unknown app'}</div>
                  <div className="truncate text-xs text-muted-foreground">{r.modules?.length ?? 0} module(s) · {new Date(r.createdAt).toLocaleString()}</div>
                </div>
                {r.status === 'running' && <span className="text-xs text-muted-foreground">{r.progress}%</span>}
                <Badge
                  variant="outline"
                  className="text-xs capitalize"
                >
                  {r.status}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
