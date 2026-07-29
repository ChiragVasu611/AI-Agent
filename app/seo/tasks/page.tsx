import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { SeoTask } from '@/lib/mongodb/models/SeoTask';
import { SeoProject } from '@/lib/mongodb/models/SeoProject';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-500 border-red-500/30',
  high: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
  medium: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  low: 'bg-primary/10 text-primary border-primary/25',
};

export default async function SeoTasksPage({ searchParams }: { searchParams: { status?: string; priority?: string; project?: string } }) {
  const user = await getCurrentUser();
  await connectToDatabase();

  const projects = (await SeoProject.find({ userId: user?.id }, 'name').lean()).map(serializeDoc);
  const query: Record<string, unknown> = { userId: user?.id };
  if (searchParams.status) query.status = searchParams.status;
  if (searchParams.priority) query.priority = searchParams.priority;
  if (searchParams.project) query.projectId = searchParams.project;

  const tasks = (await SeoTask.find(query).sort({ priority: 1, createdAt: -1 }).limit(300).lean()).map(serializeDoc);
  const projectById = new Map(projects.map((p) => [p.id, p.name]));

  const todo = tasks.filter((t: any) => t.status === 'todo').length;
  const inProgress = tasks.filter((t: any) => t.status === 'in_progress').length;
  const done = tasks.filter((t: any) => t.status === 'done').length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Task Manager</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every optimization task auto-generated from your audits, across all projects.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-border bg-card/60 p-5 backdrop-blur"><div className="font-display text-2xl font-semibold">{todo}</div><div className="mt-1 text-xs text-muted-foreground">To Do</div></Card>
        <Card className="border-border bg-card/60 p-5 backdrop-blur"><div className="font-display text-2xl font-semibold">{inProgress}</div><div className="mt-1 text-xs text-muted-foreground">In Progress</div></Card>
        <Card className="border-border bg-card/60 p-5 backdrop-blur"><div className="font-display text-2xl font-semibold">{done}</div><div className="mt-1 text-xs text-muted-foreground">Done</div></Card>
      </div>

      <Card className="border-border bg-card/60 p-4 backdrop-blur">
        <form method="get" className="flex flex-wrap gap-3">
          <select name="project" defaultValue={searchParams.project ?? ''} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">All Projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select name="status" defaultValue={searchParams.status ?? ''} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">All Statuses</option>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
          </select>
          <select name="priority" defaultValue={searchParams.priority ?? ''} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">All Priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Filter</button>
        </form>
      </Card>

      <Card className="border-border bg-card/60 backdrop-blur">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead><TableHead>Project</TableHead><TableHead>Priority</TableHead>
              <TableHead>Category</TableHead><TableHead>Est. Time</TableHead><TableHead>Status</TableHead><TableHead>Progress</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">No tasks match these filters.</TableCell></TableRow>
            ) : tasks.map((t: any) => (
              <TableRow key={t.id}>
                <TableCell><div className="text-sm font-medium">{t.title}</div></TableCell>
                <TableCell><Link href={`/seo/projects/${t.projectId}`} className="text-xs text-primary hover:underline">{projectById.get(t.projectId) ?? '—'}</Link></TableCell>
                <TableCell><Badge className={`${SEVERITY_STYLES[t.priority]} text-[10px]`}>{t.priority}</Badge></TableCell>
                <TableCell className="text-xs capitalize">{t.category.replace(/_/g, ' ')}</TableCell>
                <TableCell className="text-xs">{t.estimatedTime}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px] capitalize">{t.status.replace(/_/g, ' ')}</Badge></TableCell>
                <TableCell className="text-xs">{t.completionPercent}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
