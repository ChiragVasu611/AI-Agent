import Link from 'next/link';
import { ArrowRight, Briefcase, CheckCircle2, Gauge, ListChecks, TrendingUp } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { SeoProject } from '@/lib/mongodb/models/SeoProject';
import { SeoTask } from '@/lib/mongodb/models/SeoTask';
import { ActivityLog } from '@/lib/mongodb/models/ActivityLog';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { formatDate } from '@/lib/utils';

function scoreColor(score: number | null) {
  if (score == null) return 'text-muted-foreground';
  if (score >= 80) return 'text-success';
  if (score >= 50) return 'text-amber-500';
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

  const scored = projects.filter((p) => p.seoScore != null || p.asoScore != null);
  const avgSeoScore = scored.length > 0
    ? Math.round(scored.reduce((sum, p) => sum + (p.seoScore ?? 0), 0) / scored.filter((p) => p.seoScore != null).length || 0)
    : null;
  const avgAsoScore = scored.filter((p) => p.asoScore != null).length > 0
    ? Math.round(scored.reduce((sum, p) => sum + (p.asoScore ?? 0), 0) / scored.filter((p) => p.asoScore != null).length)
    : null;

  const totalTasks = openTasks + completedTasks;
  const optimizationProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : null;

  const stats = [
    { label: 'Total Projects', value: projects.length, icon: Briefcase },
    { label: 'Avg SEO Score', value: avgSeoScore != null ? `${avgSeoScore}/100` : '—', icon: Gauge },
    { label: 'Avg ASO Score', value: avgAsoScore != null ? `${avgAsoScore}/100` : '—', icon: Gauge },
    { label: 'Open Tasks', value: openTasks, icon: ListChecks },
    { label: 'Completed Tasks', value: completedTasks, icon: CheckCircle2 },
    { label: 'Pending Tasks', value: pendingTasks, icon: ListChecks },
    { label: 'Optimization Progress', value: optimizationProgress != null ? `${optimizationProgress}%` : '—', icon: TrendingUp },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">SEO & ASO</h1>
          <p className="mt-1 text-sm text-muted-foreground">Growth intelligence across every project — zero paid APIs required.</p>
        </div>
        <Link href="/seo/projects" className="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          New Project <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {stats.map((s) => (
          <Card key={s.label} className="border-border bg-card/60 p-5 backdrop-blur">
            <s.icon className="h-4 w-4 text-muted-foreground" />
            <div className="mt-2 font-display text-2xl font-semibold">{s.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{s.label}</div>
          </Card>
        ))}
      </div>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold tracking-tight">Project Health</h2>
          <Link href="/seo/projects" className="text-sm text-primary hover:underline">View all</Link>
        </div>
        <Card className="overflow-hidden border-border bg-card/60 backdrop-blur">
          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-5 py-12 text-center">
              <Briefcase className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No SEO/ASO projects yet.</p>
              <Link href="/seo/projects" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Create your first project <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {projects.slice(0, 6).map((p) => (
                <Link key={p.id} href={`/seo/projects/${p.id}`} className="flex items-center gap-4 px-5 py-4 transition hover:bg-secondary/50">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="text-xs capitalize text-muted-foreground">{p.projectType.replace(/_/g, ' ')} · {p.targetCountry}</div>
                  </div>
                  <div className="hidden w-32 sm:block">
                    <Progress value={p.seoScore ?? 0} className="h-1.5" />
                  </div>
                  <Badge variant="outline" className={scoreColor(p.seoScore)}>SEO {p.seoScore ?? '—'}</Badge>
                  <Badge variant="outline" className={scoreColor(p.asoScore)}>ASO {p.asoScore ?? '—'}</Badge>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </section>

      <section>
        <h2 className="mb-4 font-display text-xl font-semibold tracking-tight">Recent Activity</h2>
        <Card className="overflow-hidden border-border bg-card/60 backdrop-blur">
          {recentActivity.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">No activity yet.</div>
          ) : (
            <div className="divide-y divide-border">
              {recentActivity.map((a: any) => (
                <div key={String(a._id)} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{a.action}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(a.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
