'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Bug, CheckCircle2, Clock, Code2, Cpu, Download, FileText, Hammer, Loader2,
  Package, PenTool, ScanSearch, ShieldCheck, Smartphone, Sparkles, XCircle,
  type LucideIcon,
} from 'lucide-react';
import { AGENTS, type AgentId } from '@/lib/ai/agents';
import type { AgentRun } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';

const ICONS: Record<AgentId, LucideIcon> = {
  analyzer: ScanSearch,
  planner: Cpu,
  designer: PenTool,
  coder: Code2,
  builder: Hammer,
  emulator: Smartphone,
  qa: ShieldCheck,
  bugfix: Bug,
};

function statusColor(status: AgentRun['status']) {
  switch (status) {
    case 'completed': return 'text-success';
    case 'running': return 'text-primary';
    case 'failed': return 'text-destructive';
    default: return 'text-muted-foreground';
  }
}

function StatusIcon({ status }: { status: AgentRun['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 text-destructive" />;
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

export function AgentPipeline({ projectId, active }: { projectId: string | null; active: boolean }) {
  const [runs, setRuns] = useState<AgentRun[]>([]);

  useEffect(() => {
    if (!projectId) {
      setRuns([]);
      return;
    }

    let cancelled = false;

    async function load() {
      const res = await fetch(`/api/agent-runs?projectId=${projectId}`);
      const data = await res.json();
      if (!cancelled && data.runs) setRuns(data.runs as AgentRun[]);
    }

    load();
    const interval = setInterval(load, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId]);

  const runByAgent = new Map<AgentId, AgentRun>();
  runs.forEach((r) => runByAgent.set(r.agent, r));

  return (
    <div className="space-y-2">
      {AGENTS.map((agent, i) => {
        const run = runByAgent.get(agent.id);
        const Icon = ICONS[agent.id] ?? Cpu;
        const status = run?.status ?? 'pending';
        const progress = run?.progress ?? 0;
        return (
          <motion.div
            key={agent.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className={cn(
              'flex items-center gap-3 rounded-xl border px-3 py-3 transition',
              status === 'running' ? 'border-primary/40 bg-primary/5' : 'border-border bg-card/40',
            )}
          >
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
          </motion.div>
        );
      })}

      {!active && !projectId && (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          Run a build to watch all 8 agents execute in real time.
        </div>
      )}
    </div>
  );
}

export function RightPanel({
  projectId,
}: {
  projectId: string | null;
}) {
  const [project, setProject] = useState<{
    status: string; progress: number; qaScore: number | null;
    apkUrl: string | null; aabUrl: string | null; sourceUrl: string | null;
    docsUrl: string | null; previewUrl: string | null; version: string; createdAt: string;
  } | null>(null);

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      return;
    }
    let cancelled = false;

    async function load() {
      const res = await fetch(`/api/projects/${projectId}`);
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
      {/* Emulator — live web preview of the generated app in a phone frame */}
      <div className="rounded-2xl border border-border bg-card/60 p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-primary" />
            <span className="font-display text-sm font-semibold">Emulator</span>
          </div>
          {project?.previewUrl && (
            <a href={project.previewUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
              Open ↗
            </a>
          )}
        </div>
        <div className="mx-auto w-full max-w-[240px]">
          <div className="relative aspect-[9/19] overflow-hidden rounded-[2rem] border-[6px] border-foreground/80 bg-background shadow-lg">
            {project?.previewUrl ? (
              <iframe
                key={project.previewUrl}
                src={project.previewUrl}
                title="App emulator"
                className="h-full w-full border-0"
                sandbox="allow-scripts allow-same-origin"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
                <Smartphone className="h-6 w-6" />
                {project && project.status !== 'completed' && project.status !== 'failed'
                  ? 'Building the app… the emulator starts once the build finishes.'
                  : 'Run a build to launch the app in the emulator.'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* APK Ready card */}
      <div className={cn('rounded-2xl border p-5 transition', ready ? 'border-success/40 bg-success/5 glow' : 'border-border bg-card/60')}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className={cn('h-5 w-5', ready ? 'text-success' : 'text-muted-foreground')} />
            <span className="font-display text-sm font-semibold">APK Ready</span>
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

      {/* QA Score */}
      <div className="rounded-2xl border border-border bg-card/60 p-5">
        <div className="flex items-center justify-between">
          <span className="font-display text-sm font-semibold">QA Score</span>
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="mt-2 font-display text-3xl font-semibold">
          {project?.qaScore != null ? `${project.qaScore}/100` : '—'}
        </div>
      </div>

      {/* Build meta */}
      <div className="rounded-2xl border border-border bg-card/60 p-5 space-y-2 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Version</span><span className="font-medium">{project?.version ?? '0.1.0'}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Build Time</span><span className="font-medium">{project ? '~5m 40s' : '—'}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span className="font-medium">{project ? new Date(project.createdAt).toLocaleDateString() : '—'}</span></div>
      </div>

      {/* Downloads */}
      <div className="rounded-2xl border border-border bg-card/60 p-5">
        <div className="mb-3 font-display text-sm font-semibold">Downloads</div>
        <div className="grid grid-cols-2 gap-2">
          <DownloadButton label="APK" icon={Download} href={project?.apkUrl} disabled={!project?.apkUrl} />
          <DownloadButton label="Source" icon={FileText} href={project?.sourceUrl} disabled={!project?.sourceUrl} />
        </div>
      </div>
    </div>
  );
}

function DownloadButton({
  label, icon: Icon, href, disabled,
}: { label: string; icon: LucideIcon; href: string | null | undefined; disabled?: boolean }) {
  return (
    <a
      href={disabled ? undefined : href ?? '#'}
      className={cn(
        'flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2.5 text-xs font-medium transition',
        disabled ? 'cursor-not-allowed opacity-40' : 'hover:border-primary/40 hover:bg-primary/5',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </a>
  );
}
