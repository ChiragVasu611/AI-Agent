import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { SeoProject } from '@/lib/mongodb/models/SeoProject';
import { SeoAudit } from '@/lib/mongodb/models/SeoAudit';
import { SeoKeyword } from '@/lib/mongodb/models/SeoKeyword';
import { SeoTask } from '@/lib/mongodb/models/SeoTask';
import { SeoContent } from '@/lib/mongodb/models/SeoContent';
import { SeoCompetitor } from '@/lib/mongodb/models/SeoCompetitor';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { ProjectWorkspace } from '@/components/seo/project-workspace';

export default async function SeoProjectDetailPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  await connectToDatabase();

  const projectDoc = await SeoProject.findOne({ _id: params.id, userId: user?.id }).lean();
  if (!projectDoc) notFound();

  const [websiteAudit, asoAudit, keywords, tasks, content, competitors] = await Promise.all([
    SeoAudit.findOne({ projectId: params.id, type: 'website' }).sort({ createdAt: -1 }).lean(),
    SeoAudit.findOne({ projectId: params.id, type: 'aso' }).sort({ createdAt: -1 }).lean(),
    SeoKeyword.find({ projectId: params.id }).sort({ relevance: -1 }).lean(),
    SeoTask.find({ projectId: params.id }).sort({ priority: 1, createdAt: -1 }).lean(),
    SeoContent.find({ projectId: params.id }).sort({ createdAt: -1 }).lean(),
    SeoCompetitor.find({ projectId: params.id }).sort({ createdAt: -1 }).lean(),
  ]);

  return (
    <ProjectWorkspace
      project={serializeDoc(projectDoc)}
      websiteAudit={websiteAudit ? serializeDoc(websiteAudit) : null}
      asoAudit={asoAudit ? serializeDoc(asoAudit) : null}
      keywords={keywords.map(serializeDoc)}
      tasks={tasks.map(serializeDoc)}
      content={content.map(serializeDoc)}
      competitors={competitors.map(serializeDoc)}
    />
  );
}
