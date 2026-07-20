import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Project } from '@/lib/mongodb/models/Project';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const limit = Number(new URL(req.url).searchParams.get('limit') ?? '8');

  await connectToDatabase();
  const docs = await Project.find({ userId: user.id }).sort({ createdAt: -1 }).limit(limit).lean();

  return NextResponse.json({ projects: docs.map(serializeDoc) });
}
