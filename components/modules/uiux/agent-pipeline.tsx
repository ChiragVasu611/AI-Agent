'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Accessibility, CheckCircle2, Clock, FileOutput, Layers, LayoutTemplate, Loader2,
  Palette, PenTool, ScanSearch, Sparkles, Tablet, Workflow, XCircle,
  type LucideIcon,
} from 'lucide-react';
import { DESIGN_AGENTS, type DesignAgentId } from '@/lib/ai/design-agents';
import type { DesignAgentRun } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';

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
            <Link href={`/dashboard/uiux/${projectId}?tab=${agent.id}`} className={className}>
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

export function DesignRightPanel({ projectId }: { projectId: string | null }) {
  const [project, setProject] = useState<{
    status: string; progress: number; score: number | null;
    summary: string | null; createdAt: string;
  } | null>(null);

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      return;
    }
    let cancelled = false;

    async function load() {
      const res = await fetch(`/api/design-projects/${projectId}`);
      const data = await res.json();
      if (!cancelled) setProject(data.project as typeof project);
    }
    load();
    const interval = setInterval(load, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId]);

  const ready = project?.status === 'completed';

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

      <div className="rounded-2xl border border-border bg-card/60 p-5">
        <div className="flex items-center justify-between">
          <span className="font-display text-sm font-semibold">Accessibility Score</span>
          <Accessibility className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="mt-2 font-display text-3xl font-semibold">
          {project?.score != null ? `${project.score}/100` : '—'}
        </div>
      </div>

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

function ViewButton({
  label, icon: Icon, projectId, tab,
}: { label: string; icon: LucideIcon; projectId: string | null; tab: DesignAgentId }) {
  const disabled = !projectId;
  return (
    <Link
      href={disabled ? '#' : `/dashboard/uiux/${projectId}?tab=${tab}`}
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
