import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Project } from '@/lib/mongodb/models/Project';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Bot } from 'lucide-react';
import Link from 'next/link';

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  await connectToDatabase();

  const projectDocs = await Project.find({ userId: user?.id }).sort({ createdAt: -1 }).lean();
  const projects = projectDocs.map(serializeDoc);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">Every build across all AI modules.</p>
        </div>
        <Link href="/dashboard/app-factory" className="text-sm font-medium text-primary hover:underline">
          New build
        </Link>
      </div>

      <Card className="overflow-hidden border-border bg-card/60 backdrop-blur">
        {projects.length > 0 ? (
          <div className="divide-y divide-border">
            {projects.map((p) => (
              <Link key={p.id} href="/dashboard/app-factory" className="flex items-center gap-4 px-5 py-4 transition hover:bg-secondary/50">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary text-muted-foreground">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{p.referenceUrl}</div>
                </div>
                <Badge variant="outline" className="capitalize text-xs">{p.status}</Badge>
                <div className="hidden w-32 sm:block"><Progress value={p.progress} className="h-1.5" /></div>
                <span className="hidden text-xs text-muted-foreground md:block">
                  {new Date(p.createdAt).toLocaleDateString()}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Bot className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No projects yet.</p>
            <Link href="/dashboard/app-factory" className="text-sm font-medium text-primary hover:underline">
              Launch your first build →
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
