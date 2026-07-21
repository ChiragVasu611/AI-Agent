import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Job } from '@/lib/mongodb/models/Job';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  const doc = await Job.findOne({ _id: params.id, userId: user.id }).lean();
  if (!doc) return NextResponse.json({ job: null }, { status: 404 });

  return NextResponse.json({ job: serializeDoc(doc) });
}
