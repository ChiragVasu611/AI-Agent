import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { DesignProject } from '@/lib/mongodb/models/DesignProject';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  const doc = await DesignProject.findOne({ _id: params.id, userId: user.id }).lean();
  if (!doc) return NextResponse.json({ project: null }, { status: 404 });

  return NextResponse.json({ project: serializeDoc(doc) });
}
