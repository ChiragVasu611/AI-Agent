import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { DesignProject } from '@/lib/mongodb/models/DesignProject';
import { DesignDocument } from '@/lib/mongodb/models/DesignDocument';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { getOrCreateDesignDocument, isValidScreens } from '@/lib/ai/design-document';

const MAX_VERSIONS = 20;

export async function GET(_req: Request, { params }: { params: { projectId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  const project = await DesignProject.findOne({ _id: params.projectId, userId: user.id }).lean();
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const doc = await getOrCreateDesignDocument(params.projectId);
  return NextResponse.json({ document: serializeDoc(doc) });
}

export async function PATCH(req: Request, { params }: { params: { projectId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  const project = await DesignProject.findOne({ _id: params.projectId, userId: user.id }).lean();
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  if (!isValidScreens(body.screens)) {
    return NextResponse.json({ error: 'Invalid screens payload' }, { status: 400 });
  }

  const existing = await DesignDocument.findOne({ projectId: params.projectId });
  const versionSnapshot = existing ? { screens: existing.screens, savedAt: new Date() } : null;

  const updated = await DesignDocument.findOneAndUpdate(
    { projectId: params.projectId },
    {
      $set: { screens: body.screens },
      ...(versionSnapshot ? { $push: { versions: { $each: [versionSnapshot], $slice: -MAX_VERSIONS } } } : {}),
    },
    { new: true, upsert: true },
  ).lean();

  if (!updated) return NextResponse.json({ error: 'Save failed' }, { status: 500 });

  return NextResponse.json({ document: serializeDoc(updated) });
}
