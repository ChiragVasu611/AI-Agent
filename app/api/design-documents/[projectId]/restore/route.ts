import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { DesignProject } from '@/lib/mongodb/models/DesignProject';
import { DesignDocument } from '@/lib/mongodb/models/DesignDocument';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function POST(req: Request, { params }: { params: { projectId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  const project = await DesignProject.findOne({ _id: params.projectId, userId: user.id }).lean();
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const index = Number(body.index);

  const doc = await DesignDocument.findOne({ projectId: params.projectId });
  if (!doc || !doc.versions?.[index]) {
    return NextResponse.json({ error: 'Version not found' }, { status: 404 });
  }

  const versionSnapshot = { screens: doc.screens, savedAt: new Date() };
  const restoredScreens = doc.versions[index].screens;

  doc.screens = restoredScreens;
  doc.versions.push(versionSnapshot);
  if (doc.versions.length > 20) doc.versions = doc.versions.slice(-20);
  await doc.save();

  return NextResponse.json({ document: serializeDoc(doc.toObject()) });
}
