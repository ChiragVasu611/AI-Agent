import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Candidate } from '@/lib/mongodb/models/Candidate';
import { Application } from '@/lib/mongodb/models/Application';
import { Job } from '@/lib/mongodb/models/Job';
import { InterviewSession } from '@/lib/mongodb/models/InterviewSession';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  const doc = await Candidate.findOne({ _id: params.id, userId: user.id }).lean();
  if (!doc) return NextResponse.json({ candidate: null }, { status: 404 });

  const applications = await Application.find({ candidateId: params.id, userId: user.id }).sort({ createdAt: -1 }).lean();
  const jobIds = applications.map((a: any) => a.jobId);
  const jobs = await Job.find({ _id: { $in: jobIds } }).lean();
  const jobById = new Map(jobs.map((j: any) => [String(j._id), serializeDoc(j)]));

  const applicationIds = applications.map((a: any) => a._id);
  const interviews = await InterviewSession.find({ applicationId: { $in: applicationIds } }).sort({ createdAt: -1 }).lean();

  const applicationsWithJob = applications.map((a: any) => ({ ...serializeDoc(a), job: jobById.get(String(a.jobId)) }));

  return NextResponse.json({
    candidate: serializeDoc(doc),
    applications: applicationsWithJob,
    interviews: interviews.map(serializeDoc),
  });
}
