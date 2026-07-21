'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const STAGE_LABEL: Record<string, string> = {
  applied: 'Applied',
  screening: 'Screening',
  shortlisted: 'Shortlisted',
  hr_interview: 'HR Interview',
  technical_interview: 'Technical',
  final_interview: 'Final',
  offer: 'Offer',
  joined: 'Joined',
  rejected: 'Rejected',
};

const STAGE_ORDER = Object.keys(STAGE_LABEL);

export function StageChart({ data }: { data: Array<{ stage: string; count: number }> }) {
  const byStage = new Map(data.map((d) => [d.stage, d.count]));
  const chartData = STAGE_ORDER.map((stage) => ({ name: STAGE_LABEL[stage], count: byStage.get(stage) ?? 0 }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={50} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip
          contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
        />
        <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
