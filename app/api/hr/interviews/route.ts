import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { InterviewSession } from '@/lib/mongodb/models/InterviewSession';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const url = new URL(req.url);
  const applicationId = url.searchParams.get('applicationId');

  await connectToDatabase();
  const query: Record<string, unknown> = { userId: user.id };
  if (applicationId) query.applicationId = applicationId;

  const docs = await InterviewSession.find(query).sort({ createdAt: -1 }).lean();
  return NextResponse.json({ interviews: docs.map(serializeDoc) });
}
