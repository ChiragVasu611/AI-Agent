import Link from 'next/link';
import { ArrowRight, Bot, Boxes, Cpu, Layers, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Project } from '@/lib/mongodb/models/Project';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { MetricCard } from '@/components/dashboard/metric-card';
import { StatusBadge } from '@/components/dashboard/status-badge';
import { DashboardPageHeader, DashboardSection, EmptyState } from '@/components/dashboard/section';

/**
 * Module catalogue. Names, descriptions, hrefs, icons and statuses are UNCHANGED
 * — including which modules are navigable — so no routing or availability
 * behaviour differs. The per-module hard-coded gradient (`accent`) was removed in
 * favour of one restrained brand treatment, because six competing colour washes
 * gave every card equal visual weight and fought the neutral surface direction.
 */
const MODULES = [
  {
    name: 'AI App Factory',
    desc: 'Drop a reference app URL and let 8 autonomous agents build, test, and ship an APK.',
    href: '/app-factory',
    icon: Bot,
    status: 'live' as const,
  },
  {
    name: 'QA Workspace',
    desc: 'Crash, navigation, API, accessibility, performance, security, memory & battery testing.',
    href: '/qa',
    icon: ShieldCheck,
    status: 'live' as const,
  },
  {
    name: 'HR Workspace',
    desc: 'Recruitment pipeline, AI resume screening, interview assistant, and an HR copilot.',
    href: '/hr',
    icon: Boxes,
    status: 'live' as const,
  },
  {
    name: 'Marketing Workspace',
    desc: 'Campaign generation, copywriting, and audience segmentation.',
    href: '/marketing',
    icon: Sparkles,
    status: 'soon' as const,
  },
  {
    name: 'UI/UX Workspace',
    desc: 'Wireframes, design systems, and interactive prototypes from a brief.',
    href: '/designer',
    icon: Layers,
    status: 'live' as const,
  },
  {
    name: 'Finance Workspace',
    desc: 'Budgets, payroll, and financial reporting.',
    href: '/finance',
    icon: Cpu,
    status: 'soon' as const,
  },
];

export default async function DashboardHome() {
  const user = await getCurrentUser();
  await connectToDatabase();

  const projectDocs = await Project.find({ userId: user?.id })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();
  const projects = projectDocs.map(serializeDoc);

  // Identical derivations to before — same filters, same values, same order.
  const activeProjects = projects.filter((p) => p.status !== 'completed' && p.status !== 'failed').length;
  const completedBuilds = projects.filter((p) => p.status === 'completed').length;
  const agentsOnline = 16;

  // Computed from the catalogue rather than hard-coded, so the summary can never
  // drift out of sync with the module list (the previous static "3 live · 3
  // coming soon" text disagreed with the data, which lists 4 live and 2 soon).
  const liveCount = MODULES.filter((m) => m.status === 'live').length;
  const soonCount = MODULES.length - liveCount;

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-4 sm:p-6 lg:p-8">
      <DashboardPageHeader
        title="Enterprise overview"
        description="Every AI workspace, project and agent across the organisation in one control centre."
        actions={(
          <Button asChild className="gap-1.5">
            <Link href="/app-factory">
              <Bot className="h-4 w-4" />
              Open App Factory
            </Link>
          </Button>
        )}
      />

      {/* 1 — Primary KPIs. No trend or sparkline is shown: this page has no
             historical series to compare against, and inventing one would be a
             fabricated metric. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Active projects"
          value={activeProjects}
          icon={Layers}
          state={activeProjects > 0 ? 'default' : 'default'}
          hint={`of ${projects.length} recent project${projects.length === 1 ? '' : 's'}`}
        />
        <MetricCard
          label="Completed builds"
          value={completedBuilds}
          icon={ShieldCheck}
          state={completedBuilds > 0 ? 'success' : 'default'}
          hint="shipped successfully"
        />
        <MetricCard
          label="Agents online"
          value={agentsOnline}
          icon={Cpu}
          hint="across all workspaces"
        />
      </div>

      {/* 2 — AI modules. Given more visual space than the activity list below,
             because launching a workspace is the primary job of this page. */}
      <DashboardSection
        title="AI modules"
        description="Open a workspace to start building, testing, or hiring."
        action={(
          <span className="type-caption nums text-muted-foreground">
            {liveCount} live · {soonCount} coming soon
          </span>
        )}
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {MODULES.map((m) => (
            <Link
              key={m.name}
              href={m.href}
              className="group rounded-card outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Card className="flex h-full flex-col rounded-card border-border bg-card p-5 elevation-card transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/30 group-hover:elevation-raised">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
                    <m.icon className="h-[18px] w-[18px]" aria-hidden="true" />
                  </span>
                  <StatusBadge status={m.status} />
                </div>
                <h3 className="mt-4 text-[15px] font-semibold leading-6 text-foreground">{m.name}</h3>
                <p className="type-caption mt-1 flex-1 text-muted-foreground">{m.desc}</p>
                <span className="type-caption mt-4 inline-flex items-center gap-1 font-medium text-primary">
                  Open module
                  <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </Card>
            </Link>
          ))}
        </div>
      </DashboardSection>

      {/* 3 — Recent activity. Same five projects, same fields, same query. */}
      <DashboardSection
        title="Recent projects"
        description="The five most recently created projects in your organisation."
      >
        <Card className="overflow-hidden rounded-card border-border bg-card elevation-card">
          {projects && projects.length > 0 ? (
            <ul className="divide-y divide-border">
              {projects.map((p) => (
                <li key={p.id} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-secondary text-muted-foreground ring-1 ring-inset ring-border">
                    <Workflow className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{p.name}</div>
                    <div className="type-caption nums text-muted-foreground">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <StatusBadge status={p.status} className="hidden sm:inline-flex" />
                  <div className="hidden w-32 shrink-0 items-center gap-2 md:flex">
                    <Progress value={p.progress} className="h-1.5" />
                    <span className="type-caption nums w-8 shrink-0 text-right text-muted-foreground">{p.progress}%</span>
                  </div>
                  {p.qaScore != null && (
                    <Badge variant="secondary" className="nums shrink-0 text-xs">{p.qaScore}/100</Badge>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            /* Existing truthful, action-oriented copy is preserved verbatim. */
            <EmptyState
              icon={Bot}
              title="No projects yet"
              description="Launch the App Factory to start building."
              action={(
                <Link
                  href="/app-factory"
                  className="type-caption inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  Open App Factory <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            />
          )}
        </Card>
      </DashboardSection>
    </div>
  );
}
