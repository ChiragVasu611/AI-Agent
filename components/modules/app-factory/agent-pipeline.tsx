'use client';

import { useEffect, useMemo, useState } from 'react';
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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

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
  const [openAgent, setOpenAgent] = useState<AgentId | null>(null);

  useEffect(() => {
    if (!projectId) {
      setRuns([]);
      return;
    }

    let cancelled = false;

    async function load() {
      const res = await fetch(`/api/agent-runs?projectId=${projectId}`, { cache: 'no-store' });
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

  const selectedRun = openAgent ? runByAgent.get(openAgent) : undefined;
  const selectedSpec = openAgent ? AGENTS.find((a) => a.id === openAgent) : undefined;

  return (
    <div className="space-y-2">
      {AGENTS.map((agent, i) => {
        const run = runByAgent.get(agent.id);
        const Icon = ICONS[agent.id] ?? Cpu;
        const status = run?.status ?? 'pending';
        const progress = run?.progress ?? 0;
        const hasDetails = !!run?.output;
        return (
          <motion.button
            type="button"
            key={agent.id}
            disabled={!hasDetails}
            onClick={() => hasDetails && setOpenAgent(agent.id)}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className={cn(
              'flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition',
              status === 'running' ? 'border-primary/40 bg-primary/5' : 'border-border bg-card/40',
              hasDetails ? 'cursor-pointer hover:border-primary/40 hover:bg-primary/5' : 'cursor-default',
            )}
          >
            <div className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', statusColor(status))}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {agent.name}
                  {hasDetails && <span className="ml-2 text-[10px] font-normal text-primary">View details →</span>}
                </span>
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
          </motion.button>
        );
      })}

      {!active && !projectId && (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          Run a build to watch all 8 agents execute in real time.
        </div>
      )}

      <AgentDetailDialog
        open={!!openAgent}
        onClose={() => setOpenAgent(null)}
        agentId={openAgent}
        title={selectedSpec?.name ?? ''}
        run={selectedRun}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Agent detail dialog — shows the complete output of any agent.       */
/* ------------------------------------------------------------------ */

function AgentDetailDialog({
  open, onClose, agentId, title, run,
}: {
  open: boolean;
  onClose: () => void;
  agentId: AgentId | null;
  title: string;
  run: AgentRun | undefined;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {title}
            {run && (
              <Badge variant="outline" className="text-[10px] font-normal capitalize">{run.status}</Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {run?.model ? `Model: ${run.model}` : 'Complete agent output'}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[65vh] pr-3">
          {run?.output ? (
            <AgentOutput agentId={agentId} output={run.output as Record<string, any>} logs={run.logs} />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">No output captured for this agent yet.</p>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}

function Chips({ items }: { items: (string | number)[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it, i) => (
        <Badge key={i} variant="secondary" className="text-[11px] font-normal">{String(it)}</Badge>
      ))}
    </div>
  );
}

function KeyVals({ obj }: { obj: Record<string, any> }) {
  return (
    <div className="grid gap-1.5 text-sm sm:grid-cols-2">
      {Object.entries(obj).map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-2 rounded-md bg-secondary/40 px-2.5 py-1.5">
          <span className="text-xs text-muted-foreground">{k}</span>
          <span className="truncate font-medium">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
        </div>
      ))}
    </div>
  );
}

function Raw({ label, data }: { label: string; data: unknown }) {
  return (
    <details className="mt-2 rounded-lg border border-border bg-secondary/20">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">{label}</summary>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 pb-3 text-[11px] leading-relaxed">
        {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );
}

function AgentOutput({ agentId, output, logs }: { agentId: AgentId | null; output: Record<string, any>; logs: string | null }) {
  switch (agentId) {
    case 'analyzer':
      return (
        <div>
          <Section title="App">
            <KeyVals obj={{
              Name: output.appName, Package: output.packageName, Developer: output.developer,
              Category: output.category, Rating: output.rating, Downloads: output.downloads,
            }} />
          </Section>
          {output.description && <Section title="Description"><p className="text-sm">{output.description}</p></Section>}
          {Array.isArray(output.features) && (
            <Section title={`Features (${output.features.length})`}>
              <div className="space-y-1.5">
                {output.features.map((f: any, i: number) => (
                  <div key={i} className="rounded-md border border-border px-3 py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{f.name}</span>
                      {f.priority && <Badge variant="outline" className="text-[10px]">{f.priority}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{f.description}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}
          {Array.isArray(output.navigation) && <Section title="Navigation"><Chips items={output.navigation} /></Section>}
          {Array.isArray(output.permissions) && <Section title="Permissions"><Chips items={output.permissions} /></Section>}
          {Array.isArray(output.businessFlow) && (
            <Section title="Business flow">
              <ol className="list-decimal space-y-1 pl-5 text-sm">{output.businessFlow.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>
            </Section>
          )}
          {output.colorPalette && <Section title="Color palette"><PaletteView palette={output.colorPalette} /></Section>}
          {output.aiInsights && <Raw label="AI insights" data={output.aiInsights} />}
          {logs && <Raw label="Logs" data={logs} />}
        </div>
      );

    case 'planner':
      return (
        <div>
          {Array.isArray(output.featureList) && <Section title="Feature list"><Chips items={output.featureList} /></Section>}
          {output.techStack && <Section title="Tech stack"><KeyVals obj={output.techStack} /></Section>}
          {Array.isArray(output.folderStructure) && <Section title="Folder structure"><pre className="rounded-md bg-secondary/40 p-3 text-xs">{output.folderStructure.join('\n')}</pre></Section>}
          {Array.isArray(output.databaseSchema) && (
            <Section title="Database schema">
              <div className="space-y-1.5">
                {output.databaseSchema.map((t: any, i: number) => (
                  <div key={i} className="rounded-md border border-border px-3 py-2 text-sm">
                    <span className="font-medium">{t.table}</span>
                    <div className="mt-1"><Chips items={t.fields ?? []} /></div>
                  </div>
                ))}
              </div>
            </Section>
          )}
          {Array.isArray(output.apiDesign) && (
            <Section title="API design">
              <div className="space-y-1 text-sm">
                {output.apiDesign.map((e: any, i: number) => (
                  <div key={i} className="flex items-center gap-2"><Badge variant="outline" className="text-[10px]">{e.method}</Badge><code className="text-xs">{e.path}</code><span className="text-xs text-muted-foreground">{e.description}</span></div>
                ))}
              </div>
            </Section>
          )}
          {Array.isArray(output.timeline) && (
            <Section title="Timeline">
              {output.timeline.map((t: any, i: number) => (
                <div key={i} className="flex justify-between text-sm"><span>{t.phase}</span><span className="text-muted-foreground">{t.duration}</span></div>
              ))}
            </Section>
          )}
          {output.aiInsights && <Raw label="AI insights" data={output.aiInsights} />}
        </div>
      );

    case 'designer':
      return (
        <div>
          {output.colorPalette && <Section title="Color palette"><PaletteView palette={output.colorPalette} /></Section>}
          {output.typography && <Section title="Typography"><KeyVals obj={output.typography} /></Section>}
          {Array.isArray(output.components) && <Section title="Components"><Chips items={output.components} /></Section>}
          {Array.isArray(output.screens) && (
            <Section title={`Screens (${output.screens.length})`}>
              <div className="space-y-1.5">
                {output.screens.map((s: any, i: number) => (
                  <div key={i} className="rounded-md border border-border px-3 py-2 text-sm">
                    <span className="font-medium">{s.title ?? s.name}</span>
                    <p className="text-xs text-muted-foreground">{s.layout}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      );

    case 'coder':
      return (
        <div>
          <Section title="Summary">
            <KeyVals obj={{ Files: output.fileCount, 'Lines of code': output.linesOfCode, Languages: (output.languages ?? []).join(', ') }} />
          </Section>
          {Array.isArray(output.files) && (
            <Section title={`Generated files (${output.files.length})`}>
              <div className="space-y-2">
                {output.files.map((f: any, i: number) => (
                  <details key={i} className="rounded-md border border-border">
                    <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm">
                      <code className="text-xs">{f.path}</code>
                      <span className="text-[10px] text-muted-foreground">{f.lines} lines · {f.language}</span>
                    </summary>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-border px-3 py-2 text-[11px] leading-relaxed">{f.content}</pre>
                  </details>
                ))}
              </div>
            </Section>
          )}
        </div>
      );

    case 'builder':
      return (
        <div>
          <Section title="Build">
            <KeyVals obj={{
              Status: output.status, Version: output.version, Package: output.package,
              'Build time': output.buildTimeMs ? `${Math.round(output.buildTimeMs / 1000)}s` : 'n/a',
              Files: output.fileCount,
            }} />
          </Section>
          {output.artifacts && <Section title="Artifacts"><KeyVals obj={output.artifacts} /></Section>}
          {output.logs && <Raw label="Build logs" data={output.logs} />}
        </div>
      );

    case 'emulator':
      return (
        <div>
          <Section title="Emulator run">
            <KeyVals obj={{
              Status: output.status, Device: output.serial ?? 'none', Booted: String(!!output.booted),
              Installed: String(!!output.installed), Launched: String(!!output.launched), Package: output.package ?? 'n/a',
            }} />
          </Section>
          {output.summary && <p className="text-sm">{output.summary}</p>}
          {logs && <Raw label="adb / emulator logs" data={logs} />}
        </div>
      );

    case 'qa':
      return (
        <div>
          <Section title="QA summary">
            <KeyVals obj={{
              Score: `${output.score}/100`,
              Total: output.summary?.total, Passed: output.summary?.passed, Failed: output.summary?.failed,
            }} />
          </Section>
          {output.categories && (
            <Section title="By category">
              <div className="grid gap-1.5 sm:grid-cols-2">
                {Object.entries(output.categories).map(([cat, v]: [string, any]) => (
                  <div key={cat} className="flex items-center justify-between rounded-md bg-secondary/40 px-2.5 py-1.5 text-sm">
                    <span>{cat}</span><span className="text-muted-foreground">{v.passed}/{v.total}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
          {Array.isArray(output.testCases) && (
            <Section title={`Test cases (${output.testCases.length})`}>
              <div className="space-y-1.5">
                {output.testCases.map((tc: any) => (
                  <div key={tc.id} className="rounded-md border border-border px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{tc.id} · {tc.title}</span>
                      <Badge variant="outline" className={cn('text-[10px]', tc.status === 'passed' ? 'text-success' : 'text-destructive')}>{tc.status}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Badge variant="secondary" className="text-[10px]">{tc.category}</Badge>
                      <Badge variant="secondary" className="text-[10px]">severity: {tc.severity}</Badge>
                    </div>
                    {Array.isArray(tc.steps) && <ol className="mt-1 list-decimal pl-5 text-xs text-muted-foreground">{tc.steps.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>}
                    <p className="mt-1 text-xs"><span className="text-muted-foreground">Expected: </span>{tc.expected}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      );

    case 'bugfix':
      return (
        <div>
          <Section title="Result">
            <KeyVals obj={{ Fixed: String(!!output.fixed), Iterations: output.iterations, Patches: (output.patches ?? []).length }} />
          </Section>
          {output.note && <p className="text-sm">{output.note}</p>}
          {Array.isArray(output.patches) && output.patches.length > 0 && (
            <Section title="Patches">
              <div className="space-y-1.5">
                {output.patches.map((p: any, i: number) => (
                  <div key={i} className="rounded-md border border-border px-3 py-2 text-sm">
                    <div className="flex items-center justify-between"><span className="font-medium">{p.title}</span><Badge variant="outline" className="text-[10px]">{p.status}</Badge></div>
                    <code className="text-xs text-muted-foreground">{p.file}</code>
                    <p className="text-xs">{p.change}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      );

    default:
      return <Raw label="Output" data={output} />;
  }
}

function PaletteView({ palette }: { palette: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(palette).map(([name, hex]) => (
        <div key={name} className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
          <span className="h-4 w-4 rounded" style={{ background: hex }} />
          <span className="text-muted-foreground">{name}</span>
          <code>{hex}</code>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Right panel — build status, QA score and downloads (all dynamic).   */
/* ------------------------------------------------------------------ */

export function RightPanel({ projectId }: { projectId: string | null }) {
  const [project, setProject] = useState<{
    status: string; progress: number; qaScore: number | null;
    apkUrl: string | null; aabUrl: string | null; sourceUrl: string | null;
    docsUrl: string | null; version: string; createdAt: string;
    buildTimeMs: number | null; fileCount: number | null;
    testCasesTotal: number | null; testCasesPassed: number | null; emulatorStatus: string | null;
  } | null>(null);

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      return;
    }
    let cancelled = false;

    async function load() {
      const res = await fetch(`/api/projects/${projectId}`, { cache: 'no-store' });
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
  const buildTime = useMemo(() => {
    if (!project?.buildTimeMs) return '—';
    const s = Math.round(project.buildTimeMs / 1000);
    return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
  }, [project?.buildTimeMs]);

  return (
    <div className="space-y-4">
      {/* APK Ready card */}
      <div className={cn('rounded-2xl border p-5 transition', ready ? 'border-success/40 bg-success/5 glow' : 'border-border bg-card/60')}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className={cn('h-5 w-5', ready ? 'text-success' : 'text-muted-foreground')} />
            <span className="font-display text-sm font-semibold">APK {project?.apkUrl ? 'Ready' : (ready ? 'Source Only' : 'Building')}</span>
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
        {project?.testCasesTotal != null && (
          <div className="mt-1 text-xs text-muted-foreground">
            {project.testCasesPassed}/{project.testCasesTotal} test cases passed
          </div>
        )}
      </div>

      {/* Build meta */}
      <div className="rounded-2xl border border-border bg-card/60 p-5 space-y-2 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Version</span><span className="font-medium">{project?.version ?? '0.1.0'}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Build Time</span><span className="font-medium">{buildTime}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Files</span><span className="font-medium">{project?.fileCount ?? '—'}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Emulator</span><span className="font-medium capitalize">{project?.emulatorStatus ?? '—'}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span className="font-medium">{project ? new Date(project.createdAt).toLocaleDateString() : '—'}</span></div>
      </div>

      {/* Downloads */}
      <div className="rounded-2xl border border-border bg-card/60 p-5">
        <div className="mb-3 font-display text-sm font-semibold">Downloads</div>
        <div className="grid grid-cols-2 gap-2">
          <DownloadButton label="APK" icon={Download} href={project?.apkUrl} disabled={!project?.apkUrl} />
          <DownloadButton label="Source" icon={FileText} href={project?.sourceUrl} disabled={!project?.sourceUrl} />
          <DownloadButton label="Docs" icon={FileText} href={project?.docsUrl} disabled={!ready} />
          <DownloadButton label="AAB" icon={Package} href={project?.aabUrl} disabled={!project?.aabUrl} />
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
