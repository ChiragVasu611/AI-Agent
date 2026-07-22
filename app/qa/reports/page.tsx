'use client';

import { useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card } from '@/components/ui/card';

const COLORS = ['hsl(var(--primary))', '#EF4444', '#F59E0B', '#10B981', '#8B5CF6', '#0EA5E9'];

const tooltipStyle = { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 };

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-border bg-card/60 p-5 backdrop-blur">
      <h2 className="mb-3 font-display text-sm font-semibold">{title}</h2>
      {children}
    </Card>
  );
}

export default function QaReportsPage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch('/api/qa/reports').then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <div className="p-8 text-center text-sm text-muted-foreground">Loading reports…</div>;

  const empty = (arr: any[]) => !arr || arr.length === 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Trends across every test run. PDF/Excel/CSV export and the five formal report types (Executive, QA,
          Developer, Security, Performance) are planned for a later phase — this view already reflects real data.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Pass vs Fail">
          {empty(data.passVsFail) || data.passVsFail.every((d: any) => d.value === 0) ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No completed runs yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={data.passVsFail} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80}>
                  {data.passVsFail.map((_: any, i: number) => <Cell key={i} fill={i === 0 ? '#10B981' : '#EF4444'} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Bug Trends">
          {empty(data.bugTrends) ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No bugs recorded yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.bugTrends}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="count" stroke={COLORS[0]} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Execution Time Trends">
          {empty(data.execTimeTrends) ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No completed runs yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.execTimeTrends}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="seconds" stroke={COLORS[3]} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Crash Trends">
          {empty(data.crashTrends) ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No crashes/ANRs recorded yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.crashTrends}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="count" stroke="#EF4444" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Device Usage">
          {empty(data.deviceUsage) ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No runs recorded yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.deviceUsage}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="device" tick={{ fontSize: 9 }} interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill={COLORS[4]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Security Findings">
          {data.securitySeverity.every((d: any) => d.count === 0) ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No security findings yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.securitySeverity}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="severity" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="#EF4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <Card className="border-border bg-card/60 p-5 backdrop-blur">
        <h2 className="font-display text-sm font-semibold">API Performance</h2>
        <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
          <div><div className="text-muted-foreground">API test runs</div><div className="font-display text-xl font-semibold">{data.apiHealth.totalApiRuns}</div></div>
          <div><div className="text-muted-foreground">API bugs found</div><div className="font-display text-xl font-semibold">{data.apiHealth.apiBugsFound}</div></div>
        </div>
      </Card>
    </div>
  );
}
