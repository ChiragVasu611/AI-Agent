import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, LayoutTemplate, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { DesignProject } from '@/lib/mongodb/models/DesignProject';
import { DesignAgentRun } from '@/lib/mongodb/models/DesignAgentRun';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { Card } from '@/components/ui/card';
import { DesignDetailView } from '@/components/modules/uiux/design-detail-view';
import type { DesignAgentRun as DesignAgentRunType, DesignProject as DesignProjectType } from '@/lib/types';

export default async function DesignProjectPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  await connectToDatabase();
  const projectDoc = await DesignProject.findOne({ _id: params.id, userId: user.id }).lean();
  if (!projectDoc) notFound();

  const runDocs = await DesignAgentRun.find({ projectId: params.id }).sort({ createdAt: 1 }).lean();

  const project = serializeDoc(projectDoc) as DesignProjectType;
  const runs = runDocs.map(serializeDoc) as DesignAgentRunType[];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/uiux" className="text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
          <Layers className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h1 className="font-display text-xl font-semibold tracking-tight">{project.name}</h1>
          <p className="text-xs text-muted-foreground">Generated design details and agent output</p>
        </div>
        <Link href={`/uiux-editor/${project.id}`}>
          <Button className="gap-2">
            <LayoutTemplate className="h-4 w-4" /> Open Design Editor
          </Button>
        </Link>
      </div>

      <Card className="border-border bg-card/60 p-6 backdrop-blur">
        <DesignDetailView project={project} runs={runs} />
      </Card>
    </div>
  );
}
