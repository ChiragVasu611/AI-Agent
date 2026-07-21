import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Application } from '@/lib/mongodb/models/Application';
import { Candidate } from '@/lib/mongodb/models/Candidate';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const url = new URL(req.url);
  const jobId = url.searchParams.get('jobId');
  const stage = url.searchParams.get('stage');
  const search = url.searchParams.get('search');
  const sort = url.searchParams.get('sort') ?? '-createdAt';

  await connectToDatabase();

  const query: Record<string, unknown> = { userId: user.id };
  if (jobId) query.jobId = jobId;
  if (stage) query.stage = stage;

  const docs = await Application.find(query).sort(sort).lean();
  const candidateIds = docs.map((d: any) => d.candidateId);
  const candidates = await Candidate.find({
    _id: { $in: candidateIds },
    ...(search ? { $or: [{ name: { $regex: search, $options: 'i' } }, { skills: { $regex: search, $options: 'i' } }] } : {}),
  }).lean();
  const candidateById = new Map(candidates.map((c: any) => [String(c._id), serializeDoc(c)]));

  const applications = docs
    .map((d: any) => ({ ...serializeDoc(d), candidate: candidateById.get(String(d.candidateId)) }))
    .filter((a) => !search || a.candidate);

  return NextResponse.json({ applications });
}
