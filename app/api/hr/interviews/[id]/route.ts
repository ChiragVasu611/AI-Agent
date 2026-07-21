import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { InterviewSession } from '@/lib/mongodb/models/InterviewSession';
import { Application } from '@/lib/mongodb/models/Application';
import { Candidate } from '@/lib/mongodb/models/Candidate';
import { Job } from '@/lib/mongodb/models/Job';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  const session = await InterviewSession.findOne({ _id: params.id, userId: user.id }).lean();
  if (!session) return NextResponse.json({ interview: null }, { status: 404 });

  const app = await Application.findById((session as any).applicationId).lean();
  const candidate = app ? await Candidate.findById((app as any).candidateId).lean() : null;
  const job = app ? await Job.findById((app as any).jobId).lean() : null;

  return NextResponse.json({
    interview: serializeDoc(session),
    application: app ? serializeDoc(app) : null,
    candidate: candidate ? serializeDoc(candidate) : null,
    job: job ? serializeDoc(job) : null,
  });
}
