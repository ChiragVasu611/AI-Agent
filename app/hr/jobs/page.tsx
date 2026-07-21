'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Briefcase, Search } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { CreateJobDialog } from '@/components/modules/hr/create-job-dialog';
import type { Job } from '@/lib/types';

const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'bg-destructive/15 text-destructive',
  high: 'bg-amber-500/15 text-amber-600',
  medium: 'bg-secondary text-muted-foreground',
  low: 'bg-secondary text-muted-foreground',
};

export default function JobsPage() {
  const [jobs, setJobs] = useState<(Job & { applicantCount: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ limit: '50', ...(search ? { search } : {}) });
    fetch(`/api/hr/jobs?${params}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setJobs(data.jobs ?? []); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [search, refreshKey]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage open positions and their hiring pipelines.</p>
        </div>
        <CreateJobDialog onCreated={() => setRefreshKey((k) => k + 1)} />
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search jobs, departments, skills…" className="pl-9" />
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
        </div>
      ) : jobs.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-2 border-dashed border-border bg-card/40 px-6 py-16 text-center backdrop-blur">
          <Briefcase className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No jobs yet. Create your first job posting to start hiring.</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((job) => (
            <Link key={job.id} href={`/hr/jobs/${job.id}`}>
              <Card className="h-full border-border bg-card/60 p-5 backdrop-blur transition hover:border-primary/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Briefcase className="h-5 w-5" />
                  </div>
                  <div className="flex gap-1">
                    <Badge className={PRIORITY_COLOR[job.priority]}>{job.priority}</Badge>
                    <Badge variant={job.status === 'open' ? 'default' : 'secondary'} className="capitalize">{job.status}</Badge>
                  </div>
                </div>
                <h3 className="mt-3 font-display text-base font-semibold">{job.title}</h3>
                <p className="text-xs text-muted-foreground">{job.department} · {job.employmentType.replace('_', ' ')} · {job.workMode}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {job.requiredSkills.slice(0, 3).map((s) => (
                    <Badge key={s} variant="outline" className="text-[10px] font-normal">{s}</Badge>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{job.applicantCount} applicant{job.applicantCount === 1 ? '' : 's'}</span>
                  <span>{job.openings} opening{job.openings === 1 ? '' : 's'}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
