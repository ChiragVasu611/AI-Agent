import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { SeoTask } from '@/lib/mongodb/models/SeoTask';
import { SeoProject } from '@/lib/mongodb/models/SeoProject';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const SEVERITY_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-500 border-red-500/30',
  high: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
  medium: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  low: 'bg-primary/10 text-primary border-primary/25',
};

function TaskList({ tasks, projectById, emptyText }: { tasks: any[]; projectById: Map<string, string>; emptyText: string }) {
  if (tasks.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <div className="space-y-2">
      {tasks.map((t) => (
        <div key={t.id} className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
          <Badge className={`${SEVERITY_STYLES[t.priority]} shrink-0 text-[10px]`}>{t.priority}</Badge>
          <div className="min-w-0 flex-1">
            <div className="font-medium">{t.title}</div>
            <div className="text-xs text-muted-foreground">{t.estimatedImpact}</div>
            <Link href={`/seo/projects/${t.projectId}`} className="text-xs text-primary hover:underline">{projectById.get(t.projectId) ?? 'Project'}</Link>
          </div>
          <Badge variant="outline" className="shrink-0 text-[10px]">{t.estimatedTime}</Badge>
        </div>
      ))}
    </div>
  );
}

export default async function SeoGrowthPage() {
  const user = await getCurrentUser();
  await connectToDatabase();

  const projects = (await SeoProject.find({ userId: user?.id }, 'name').lean()).map(serializeDoc);
  const projectById = new Map(projects.map((p) => [p.id, p.name]));

  const openTasks = (await SeoTask.find({ userId: user?.id, status: { $ne: 'done' } }).lean())
    .map(serializeDoc)
    .sort((a: any, b: any) => SEVERITY_ORDER[b.priority] - SEVERITY_ORDER[a.priority]);

  const topPriority = openTasks.slice(0, 10);
  const quickWins = openTasks.filter((t: any) => t.category === 'quick_win');
  const longTerm = openTasks.filter((t: any) => t.category === 'long_term');
  const weekly = openTasks.filter((t: any) => t.planHorizon === 'weekly');
  const thirtyDay = openTasks.filter((t: any) => t.planHorizon === '30_day');
  const ninetyDay = openTasks.filter((t: any) => t.planHorizon === '90_day');

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">AI Growth Coach</h1>
        <p className="mt-1 text-sm text-muted-foreground">Prioritized, phased action plan generated from every audit across your projects.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border bg-card/60 p-6 backdrop-blur">
          <h2 className="mb-3 font-display text-lg font-semibold">Top 10 High Priority Tasks</h2>
          <TaskList tasks={topPriority} projectById={projectById} emptyText="No open tasks — run an audit to generate a plan." />
        </Card>
        <Card className="border-border bg-card/60 p-6 backdrop-blur">
          <h2 className="mb-3 font-display text-lg font-semibold">Quick Wins</h2>
          <TaskList tasks={quickWins} projectById={projectById} emptyText="No quick wins identified right now." />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-border bg-card/60 p-6 backdrop-blur">
          <h2 className="mb-3 font-display text-lg font-semibold">Weekly Action Plan</h2>
          <TaskList tasks={weekly} projectById={projectById} emptyText="Nothing urgent this week." />
        </Card>
        <Card className="border-border bg-card/60 p-6 backdrop-blur">
          <h2 className="mb-3 font-display text-lg font-semibold">30-Day Plan</h2>
          <TaskList tasks={thirtyDay} projectById={projectById} emptyText="No 30-day items yet." />
        </Card>
        <Card className="border-border bg-card/60 p-6 backdrop-blur">
          <h2 className="mb-3 font-display text-lg font-semibold">90-Day Plan</h2>
          <TaskList tasks={ninetyDay} projectById={projectById} emptyText="No 90-day items yet." />
        </Card>
      </div>

      <Card className="border-border bg-card/60 p-6 backdrop-blur">
        <h2 className="mb-3 font-display text-lg font-semibold">Long Term Improvements</h2>
        <TaskList tasks={longTerm} projectById={projectById} emptyText="No long-term improvements queued." />
      </Card>
    </div>
  );
}
