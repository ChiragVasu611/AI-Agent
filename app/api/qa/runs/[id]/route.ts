import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaProject } from '@/lib/mongodb/models/QaProject';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  const doc = await QaTestRun.findOne({ _id: params.id, userId: user.id }).lean();
  if (!doc) return NextResponse.json({ run: null }, { status: 404 });

  const project = await QaProject.findById((doc as any).projectId).lean();

  return NextResponse.json({ run: { ...serializeDoc(doc), project: project ? serializeDoc(project) : null } });
}
