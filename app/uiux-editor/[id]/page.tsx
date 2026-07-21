import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { DesignProject } from '@/lib/mongodb/models/DesignProject';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { getOrCreateDesignDocument } from '@/lib/ai/design-document';
import { DesignEditor } from '@/components/modules/uiux/editor/design-editor';
import type { DesignDocument as DesignDocumentType, DesignProject as DesignProjectType } from '@/lib/types';

export default async function DesignEditorPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  await connectToDatabase();
  const projectDoc = await DesignProject.findOne({ _id: params.id, userId: user.id }).lean();
  if (!projectDoc) notFound();

  const documentDoc = await getOrCreateDesignDocument(params.id);

  const project = serializeDoc(projectDoc) as DesignProjectType;
  const document = serializeDoc(documentDoc) as DesignDocumentType;

  return (
    <DesignEditor
      projectId={project.id}
      projectName={project.name}
      initialScreens={document.screens}
      initialVersions={document.versions}
    />
  );
}
