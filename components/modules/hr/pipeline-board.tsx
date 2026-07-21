'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { GripVertical, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { moveApplicationStage } from '@/app/hr/actions';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Application, ApplicationStage } from '@/lib/types';

const STAGES: { id: ApplicationStage; label: string }[] = [
  { id: 'applied', label: 'Applied' },
  { id: 'screening', label: 'AI Screening' },
  { id: 'shortlisted', label: 'Shortlisted' },
  { id: 'hr_interview', label: 'HR Interview' },
  { id: 'technical_interview', label: 'Technical Interview' },
  { id: 'final_interview', label: 'Final Interview' },
  { id: 'offer', label: 'Offer' },
  { id: 'joined', label: 'Joined' },
  { id: 'rejected', label: 'Rejected' },
];

const RECOMMENDATION_COLOR: Record<string, string> = {
  strong_hire: 'bg-success/15 text-success',
  hire: 'bg-primary/15 text-primary',
  consider: 'bg-amber-500/15 text-amber-600',
  reject: 'bg-destructive/15 text-destructive',
};

export function PipelineBoard({ jobId }: { jobId: string }) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragOverStage, setDragOverStage] = useState<ApplicationStage | null>(null);

  async function load() {
    const res = await fetch(`/api/hr/applications?jobId=${jobId}`);
    const data = await res.json();
    setApplications(data.applications ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function onDrop(stage: ApplicationStage, applicationId: string) {
    setDragOverStage(null);
    setApplications((prev) => prev.map((a) => (a.id === applicationId ? { ...a, stage } : a)));
    const res = await moveApplicationStage(applicationId, stage);
    if (res?.error) {
      toast.error(res.error);
      load();
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading pipeline…</div>;
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {STAGES.map((stage) => {
        const items = applications.filter((a) => a.stage === stage.id);
        return (
          <div
            key={stage.id}
            onDragOver={(e) => { e.preventDefault(); setDragOverStage(stage.id); }}
            onDragLeave={() => setDragOverStage((s) => (s === stage.id ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              const applicationId = e.dataTransfer.getData('text/plain');
              if (applicationId) onDrop(stage.id, applicationId);
            }}
            className={cn(
              'flex w-64 shrink-0 flex-col rounded-xl border bg-secondary/20 p-2 transition',
              dragOverStage === stage.id ? 'border-primary/50 bg-primary/5' : 'border-border',
            )}
          >
            <div className="flex items-center justify-between px-1.5 py-1">
              <span className="text-xs font-semibold">{stage.label}</span>
              <Badge variant="outline" className="text-[10px]">{items.length}</Badge>
            </div>
            <div className="min-h-[80px] space-y-2 py-1">
              {items.map((app) => (
                <div
                  key={app.id}
                  draggable
                  onDragStart={(e: React.DragEvent) => e.dataTransfer.setData('text/plain', app.id)}
                  className="animate-in fade-in cursor-grab rounded-lg border border-border bg-card p-2.5 duration-200 active:cursor-grabbing"
                >
                  <div className="flex items-start justify-between gap-1">
                    <Link href={`/hr/candidates/${app.candidateId}`} className="min-w-0 flex-1 truncate text-xs font-medium hover:text-primary">
                      {app.candidate?.name ?? 'Unknown candidate'}
                    </Link>
                    <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </div>
                  {app.matchScore && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Sparkles className="h-3 w-3 text-primary" />
                      <span className="text-[11px] tabular-nums text-muted-foreground">{app.matchScore.overall}% match</span>
                    </div>
                  )}
                  {app.recommendation && (
                    <Badge className={cn('mt-1.5 text-[10px] capitalize', RECOMMENDATION_COLOR[app.recommendation])}>
                      {app.recommendation.replace('_', ' ')}
                    </Badge>
                  )}
                  {(stage.id === 'hr_interview' || stage.id === 'technical_interview' || stage.id === 'final_interview') && (
                    <Link
                      href={`/hr/interviews/${app.id}`}
                      className="mt-1.5 block text-center text-[10px] font-medium text-primary hover:underline"
                    >
                      Open Interview →
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
