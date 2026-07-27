'use client';

import { useState } from 'react';
import { FileDown, FileSpreadsheet, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { exportCsv, exportExcel, exportPdf } from '@/lib/qa/export';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const REPORTS = [
  { type: 'executive', title: 'Executive Report', subtitle: 'Project-level score summary across every workspace project.' },
  { type: 'seo_audit', title: 'SEO Audit Report', subtitle: 'Every finding from website SEO audits across all projects.' },
  { type: 'aso_audit', title: 'ASO Audit Report', subtitle: 'Every finding from App Store Optimization audits.' },
  { type: 'technical', title: 'Technical Report', subtitle: 'Technical, performance, and mobile findings only.' },
  { type: 'content', title: 'Content Report', subtitle: 'Every generated content asset with its quality review score.' },
  { type: 'growth', title: 'Growth Report', subtitle: 'Open optimization tasks with priority, impact, and plan horizon.' },
  { type: 'tasks', title: 'Task Report', subtitle: 'Every optimization task, its priority, and completion status.' },
];

export default function SeoReportsPage() {
  const [loading, setLoading] = useState<string | null>(null);

  async function fetchRows(type: string) {
    const res = await fetch(`/api/seo/reports?type=${type}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.rows as Record<string, unknown>[];
  }

  async function handleExport(type: string, title: string, format: 'csv' | 'excel' | 'pdf') {
    setLoading(`${type}-${format}`);
    try {
      const rows = await fetchRows(type);
      if (rows.length === 0) { toast.error('No data available for this report yet.'); return; }
      const filename = `seo-${type}-report`;
      if (format === 'csv') exportCsv(filename, rows);
      else if (format === 'excel') await exportExcel(filename, rows, title);
      else await exportPdf(filename, title, 'SEO & ASO', rows);
      toast.success(`${title} exported`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Export failed');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">Export real, live data — computed from your actual projects, audits, and tasks.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Card key={r.type} className="border-border bg-card/60 p-5 backdrop-blur">
            <h2 className="font-display text-base font-semibold">{r.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{r.subtitle}</p>
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant="outline" disabled={loading === `${r.type}-csv`} onClick={() => handleExport(r.type, r.title, 'csv')} className="gap-1.5"><FileDown className="h-3.5 w-3.5" /> CSV</Button>
              <Button size="sm" variant="outline" disabled={loading === `${r.type}-excel`} onClick={() => handleExport(r.type, r.title, 'excel')} className="gap-1.5"><FileSpreadsheet className="h-3.5 w-3.5" /> Excel</Button>
              <Button size="sm" variant="outline" disabled={loading === `${r.type}-pdf`} onClick={() => handleExport(r.type, r.title, 'pdf')} className="gap-1.5"><FileText className="h-3.5 w-3.5" /> PDF</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
