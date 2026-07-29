import Link from 'next/link';
import { Activity, ArrowRight, Briefcase, CheckCircle2, Gauge, ListChecks, TrendingUp } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { SeoProject } from '@/lib/mongodb/models/SeoProject';
import { SeoTask } from '@/lib/mongodb/models/SeoTask';
import { ActivityLog } from '@/lib/mongodb/models/ActivityLog';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { MetricCard, type MetricState } from '@/components/dashboard/metric-card';
import {
  ChartCard, DashboardPageHeader, DashboardSection, EmptyState,
} from '@/components/dashboard/section';
import { CategoryBarChart, DonutChart } from '@/components/dashboard/charts';
import { formatDate } from '@/lib/utils';

/** Score banding. Uses semantic state tokens rather than a raw palette value. */
function scoreColor(score: number | null) {
  if (score == null) return 'text-muted-foreground';
  if (score >= 80) return 'text-success';
  if (score >= 50) return 'text-warning';
  return 'text-destructive';
}

export default async function SeoDashboardPage() {
  const user = await getCurrentUser();
  await connectToDatabase();

  const projectDocs = await SeoProject.find({ userId: user?.id }).sort({ createdAt: -1 }).lean();
  const projects = projectDocs.map(serializeDoc);

  const [openTasks, completedTasks, pendingTasks, recentActivity] = await Promise.all([
    SeoTask.countDocuments({ userId: user?.id, status: { $ne: 'done' } }),
    SeoTask.countDocuments({ userId: user?.id, status: 'done' }),
    SeoTask.countDocuments({ userId: user?.id, status: 'todo' }),
    ActivityLog.find({ userId: user?.id, action: { $regex: '^seo\\.' } }).sort({ createdAt: -1 }).limit(8).lean(),
  ]);

  /**
   * Averages over ONLY the projects that actually carry the score in question.
   *
   * The previous expression divided a sum taken across all scored projects by the
   * count of projects having that one score, and `|| 0` swallowed the resulting
   * NaN — so a workspace with ASO scores but no SEO scores reported a confident
   * "0/100" SEO average that no project had. Averaging each score over its own
   * population returns null when there is nothing to average, which renders "—".
   */
  const seoScores = projects.map((p) => p.seoScore).filter((v): v is number => v != null);
  const asoScores = projects.map((p) => p.asoScore).filter((v): v is number => v != null);
  const avgSeoScore = seoScores.length > 0
    ? Math.round(seoScores.reduce((sum, v) => sum + v, 0) / seoScores.length)
    : null;
  const avgAsoScore = asoScores.length > 0
    ? Math.round(asoScores.reduce((sum, v) => sum + v, 0) / asoScores.length)
    : null;

  const totalTasks = openTasks + completedTasks;
  const optimizationProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : null;

  const stats: Array<{
    label: string; value: string | number; icon: typeof Briefcase; state?: MetricState; hint?: string;
  }> = [
    { label: 'Total Projects', value: projects.length, icon: Briefcase },
    {
      label: 'Avg SEO Score',
      value: avgSeoScore != null ? `${avgSeoScore}/100` : '—',
      icon: Gauge,
      // Band the score honestly; neutral when there is nothing to score.
      state: avgSeoScore == null ? 'default' : avgSeoScore >= 80 ? 'success' : avgSeoScore >= 50 ? 'warning' : 'critical',
      hint: seoScores.length > 0 ? `across ${seoScores.length} project(s)` : 'no scored projects yet',
    },
    {
      label: 'Avg ASO Score',
      value: avgAsoScore != null ? `${avgAsoScore}/100` : '—',
      icon: Gauge,
      state: avgAsoScore == null ? 'default' : avgAsoScore >= 80 ? 'success' : avgAsoScore >= 50 ? 'warning' : 'critical',
      hint: asoScores.length > 0 ? `across ${asoScores.length} project(s)` : 'no scored projects yet',
    },
    { label: 'Open Tasks', value: openTasks, icon: ListChecks },
    { label: 'Completed Tasks', value: completedTasks, icon: CheckCircle2, state: 'success' },
    { label: 'Pending Tasks', value: pendingTasks, icon: ListChecks },
    {
      label: 'Optimization Progress',
      value: optimizationProgress != null ? `${optimizationProgress}%` : '—',
      icon: TrendingUp,
      hint: totalTasks > 0 ? `${completedTasks} of ${totalTasks} tasks done` : 'no tasks yet',
    },
  ];

  /** Task status split — three real counters from the task collection. */
  const taskData = [
    { name: 'Completed', value: completedTasks, color: 'hsl(var(--success))' },
    { name: 'Pending', value: pendingTasks, color: 'hsl(var(--warning))' },
    // Open-but-started work: open tasks that are not sitting in "todo".
    { name: 'In progress', value: Math.max(0, openTasks - pendingTasks), color: 'hsl(var(--chart-1))' },
  ];

  /** Per-project SEO scores, ranked — only projects that actually have one. */
  const projectScoreData = projects
    .filter((p) => p.seoScore != null)
    .sort((a, b) => (b.seoScore ?? 0) - (a.seoScore ?? 0))
    .slice(0, 8)
    .map((p) => ({ name: p.name, value: p.seoScore as number }));

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6 lg:p-8">
      <DashboardPageHeader
        title="SEO & ASO"
        description="Growth intelligence across every project — zero paid APIs required."
        actions={(
          <Button asChild className="gap-1.5">
            <Link href="/seo/projects">New Project <ArrowRight className="h-4 w-4" /></Link>
          </Button>
        )}
      />

      <DashboardSection
        title="Scores & optimisation"
        description="Average scores and task progress across all projects."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <MetricCard key={s.label} label={s.label} value={s.value} icon={s.icon} state={s.state} hint={s.hint} />
          ))}
        </div>
      </DashboardSection>

      <DashboardSection
        title="Optimisation analytics"
        description="Task completion split, and how project SEO scores compare."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <ChartCard
            title="Project SEO scores"
            description="Top projects ranked by their current SEO score."
            summary={projectScoreData.map((d) => `${d.name}: ${d.value}`).join(', ')}
            className="lg:col-span-2"
          >
            <CategoryBarChart
              data={projectScoreData}
              layout="vertical"
              height={280}
              emptyMessage="No project has an SEO score yet. Run an audit to generate one."
            />
          </ChartCard>

          <ChartCard
            title="Task status"
            description="How optimisation tasks are distributed."
            summary={`Completed ${completedTasks}, pending ${pendingTasks}, open ${openTasks}.`}
          >
            <DonutChart
              data={taskData}
              centerValue={optimizationProgress != null ? `${optimizationProgress}%` : undefined}
              centerLabel="complete"
              emptyMessage="No tasks yet. Tasks appear here once an audit creates them."
            />
          </ChartCard>
        </div>
      </DashboardSection>

      <DashboardSection
        title="Project health"
        description="Per-project SEO and ASO standing."
        action={<Link href="/seo/projects" className="type-caption font-medium text-primary hover:underline">View all</Link>}
      >
        <Card className="overflow-hidden rounded-card border-border bg-card elevation-card">
          {projects.length === 0 ? (
            <EmptyState
              icon={Briefcase}
              title="No SEO/ASO projects yet"
              action={(
                <Link href="/seo/projects" className="type-caption inline-flex items-center gap-1 font-medium text-primary hover:underline">
                  Create your first project <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            />
          ) : (
            <ul className="divide-y divide-border">
              {projects.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/seo/projects/${p.id}`}
                    className="flex items-center gap-4 px-5 py-3.5 outline-none transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{p.name}</div>
                      <div className="type-caption truncate capitalize text-muted-foreground">
                        {p.projectType.replace(/_/g, ' ')} · {p.targetCountry}
                      </div>
                    </div>
                    {/* Progress reflects the SEO score only when one exists. */}
                    {p.seoScore != null && (
                      <div className="hidden w-28 shrink-0 sm:block">
                        <Progress value={p.seoScore} className="h-1.5" />
                      </div>
                    )}
                    <Badge variant="outline" className={`nums shrink-0 ${scoreColor(p.seoScore)}`}>
                      SEO {p.seoScore ?? '—'}
                    </Badge>
                    <Badge variant="outline" className={`nums shrink-0 ${scoreColor(p.asoScore)}`}>
                      ASO {p.asoScore ?? '—'}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </DashboardSection>

      <DashboardSection title="Recent activity" description="Latest SEO and ASO events.">
        <Card className="overflow-hidden rounded-card border-border bg-card elevation-card">
          {recentActivity.length === 0 ? (
            <EmptyState icon={Activity} title="No activity yet" className="py-8" />
          ) : (
            <ul className="divide-y divide-border">
              {recentActivity.map((a: any) => (
                <li key={String(a._id)} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <span className="truncate font-mono text-xs text-muted-foreground">{a.action}</span>
                  <span className="type-caption nums shrink-0 text-muted-foreground">{formatDate(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </DashboardSection>
    </div>
  );
}
