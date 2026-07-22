'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Accessibility, CheckCircle2, Clock, FileOutput, Layers, LayoutTemplate, Loader2,
  Palette, PenTool, ScanSearch, Sparkles, Tablet, Wand2, Workflow, XCircle,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { DESIGN_AGENTS, type DesignAgentId } from '@/lib/ai/design-agents';
import { improveDesign } from '@/app/designer/actions';
import type { DesignAgentRun, DesignReviewIssue } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const ICONS: Record<DesignAgentId, LucideIcon> = {
  research: ScanSearch,
  strategy: Workflow,
  wireframe: LayoutTemplate,
  uidesign: PenTool,
  designsystem: Palette,
  responsive: Tablet,
  accessibility: Accessibility,
  handoff: FileOutput,
};

function statusColor(status: DesignAgentRun['status']) {
  switch (status) {
    case 'completed': return 'text-success';
    case 'running': return 'text-primary';
    case 'failed': return 'text-destructive';
    default: return 'text-muted-foreground';
  }
}

function StatusIcon({ status }: { status: DesignAgentRun['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 text-destructive" />;
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

export function DesignAgentPipeline({ projectId, active }: { projectId: string | null; active: boolean }) {
  const [runs, setRuns] = useState<DesignAgentRun[]>([]);

  useEffect(() => {
    if (!projectId) {
      setRuns([]);
      return;
    }

    let cancelled = false;

    async function load() {
      const res = await fetch(`/api/design-agent-runs?projectId=${projectId}`);
      const data = await res.json();
      if (!cancelled && data.runs) setRuns(data.runs as DesignAgentRun[]);
    }

    load();
    const interval = setInterval(load, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId]);

  const runByAgent = new Map<DesignAgentId, DesignAgentRun>();
  runs.forEach((r) => runByAgent.set(r.agent, r));

  return (
    <div className="space-y-2">
      {DESIGN_AGENTS.map((agent, i) => {
        const run = runByAgent.get(agent.id);
        const Icon = ICONS[agent.id] ?? Layers;
        const status = run?.status ?? 'pending';
        const progress = run?.progress ?? 0;
        const viewable = status === 'completed' && projectId;
        const content = (
          <>
            <div className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', statusColor(status))}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{agent.name}</span>
                <StatusIcon status={status} />
              </div>
              <p className="truncate text-xs text-muted-foreground">{agent.description}</p>
              {status !== 'pending' && (
                <div className="mt-2 flex items-center gap-2">
                  <Progress value={progress} className="h-1 flex-1" />
                  <span className="text-[11px] tabular-nums text-muted-foreground">{progress}%</span>
                </div>
              )}
            </div>
            <Badge variant="outline" className="hidden text-[10px] font-normal text-muted-foreground sm:block">
              {agent.model.split('/').pop()}
            </Badge>
          </>
        );
        const className = cn(
          'flex items-center gap-3 rounded-xl border px-3 py-3 transition',
          status === 'running' ? 'border-primary/40 bg-primary/5' : 'border-border bg-card/40',
          viewable && 'cursor-pointer hover:border-primary/40 hover:bg-primary/5',
        );
        return viewable ? (
          <motion.div
            key={agent.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
          >
            <Link href={`/designer/${projectId}?tab=${agent.id}`} className={className}>
              {content}
            </Link>
          </motion.div>
        ) : (
          <motion.div
            key={agent.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className={className}
          >
            {content}
          </motion.div>
        );
      })}

      {!active && !projectId && (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          Generate a design to watch all 8 agents execute in real time.
        </div>
      )}
    </div>
  );
}

interface RightPanelProject {
  status: string; progress: number; score: number | null;
  uxScore: number | null; uiScore: number | null; accessibilityScore: number | null;
  consistencyScore: number | null; responsiveScore: number | null;
  reviewIssues: DesignReviewIssue[]; aiEnhanced: boolean;
  summary: string | null; createdAt: string;
}

export function DesignRightPanel({ projectId }: { projectId: string | null }) {
  const [project, setProject] = useState<RightPanelProject | null>(null);
  const [improving, setImproving] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      return;
    }
    let cancelled = false;

    async function load() {
      const res = await fetch(`/api/design-projects/${projectId}`);
      const data = await res.json();
      if (!cancelled) setProject(data.project as RightPanelProject);
    }
    load();
    const interval = setInterval(load, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId]);

  const ready = project?.status === 'completed';

  async function onImprove() {
    if (!projectId) return;
    setImproving(true);
    const res = await improveDesign(projectId);
    setImproving(false);
    if ((res as any)?.error) return toast.error((res as any).error);
    if (res.fixedCount === 0) return toast.info(res.message ?? 'No automatically-fixable issues were found.');
    toast.success(`Applied ${res.fixedCount} automatic fix(es).`);
    const refreshed = await fetch(`/api/design-projects/${projectId}`).then((r) => r.json());
    setProject(refreshed.project as RightPanelProject);
  }

  return (
    <div className="space-y-4">
      <div className={cn('rounded-2xl border p-5 transition', ready ? 'border-success/40 bg-success/5 glow' : 'border-border bg-card/60')}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className={cn('h-5 w-5', ready ? 'text-success' : 'text-muted-foreground')} />
            <span className="font-display text-sm font-semibold">Design Ready</span>
          </div>
          <Badge variant={ready ? 'default' : 'secondary'} className={ready ? 'bg-success text-background' : ''}>
            {ready ? 'Ready' : 'Pending'}
          </Badge>
        </div>
        <div className="mt-3">
          <Progress value={project?.progress ?? 0} className="h-1.5" />
          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
            <span className="capitalize">{project?.status ?? 'idle'}</span>
            <span>{project?.progress ?? 0}%</span>
          </div>
        </div>
      </div>

      {ready && (
        <div className="rounded-2xl border border-border bg-card/60 p-5">
          <div className="flex items-center justify-between">
            <span className="font-display text-sm font-semibold">AI Design Review</span>
            <Badge variant="outline" className="text-[10px]">{project?.aiEnhanced ? 'AI-enhanced' : 'Deterministic engine'}</Badge>
          </div>
          <div className="mt-2 font-display text-3xl font-semibold">
            {project?.score != null ? `${project.score}/100` : '—'}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">overall</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <ScoreRow label="UX" value={project?.uxScore} />
            <ScoreRow label="UI" value={project?.uiScore} />
            <ScoreRow label="Accessibility" value={project?.accessibilityScore} />
            <ScoreRow label="Consistency" value={project?.consistencyScore} />
            <ScoreRow label="Responsive" value={project?.responsiveScore} />
          </div>

          {project && project.reviewIssues.length > 0 && (
            <div className="mt-3 max-h-40 space-y-1.5 overflow-y-auto border-t border-border pt-3">
              {project.reviewIssues.slice(0, 8).map((issue, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="outline" className="mt-0.5 shrink-0 text-[9px] capitalize">{issue.severity}</Badge>
                  <span>{issue.message}</span>
                </div>
              ))}
              {project.reviewIssues.length > 8 && (
                <p className="text-[11px] text-muted-foreground">+{project.reviewIssues.length - 8} more</p>
              )}
            </div>
          )}

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={improving}
            onClick={onImprove}
            className="mt-3 w-full gap-2"
          >
            {improving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Improve Design
          </Button>
        </div>
      )}

      {project?.summary && (
        <div className="rounded-2xl border border-border bg-card/60 p-5 text-sm text-muted-foreground">
          {project.summary}
        </div>
      )}

      <Link
        href={projectId ? `/uiux-editor/${projectId}` : '#'}
        aria-disabled={!projectId}
        className={cn(
          'flex items-center justify-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3.5 text-sm font-semibold text-primary transition',
          projectId ? 'hover:bg-primary/15' : 'pointer-events-none cursor-not-allowed opacity-40',
        )}
      >
        <LayoutTemplate className="h-4 w-4" />
        Open Design Editor
      </Link>

      <div className="rounded-2xl border border-border bg-card/60 p-5">
        <div className="mb-3 font-display text-sm font-semibold">Agent Output</div>
        <div className="grid grid-cols-2 gap-2">
          <ViewButton label="Wireframes" icon={LayoutTemplate} projectId={projectId} tab="wireframe" />
          <ViewButton label="UI Design" icon={PenTool} projectId={projectId} tab="uidesign" />
          <ViewButton label="Design System" icon={Palette} projectId={projectId} tab="designsystem" />
          <ViewButton label="Handoff" icon={FileOutput} projectId={projectId} tab="handoff" />
        </div>
      </div>
    </div>
  );
}

function ScoreRow({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-secondary/30 px-2.5 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value != null ? value : '—'}</span>
    </div>
  );
}

function ViewButton({
  label, icon: Icon, projectId, tab,
}: { label: string; icon: LucideIcon; projectId: string | null; tab: DesignAgentId }) {
  const disabled = !projectId;
  return (
    <Link
      href={disabled ? '#' : `/designer/${projectId}?tab=${tab}`}
      aria-disabled={disabled}
      className={cn(
        'flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2.5 text-xs font-medium transition',
        disabled ? 'pointer-events-none cursor-not-allowed opacity-40' : 'hover:border-primary/40 hover:bg-primary/5',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}
