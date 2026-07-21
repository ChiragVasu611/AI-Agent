import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Candidate } from '@/lib/mongodb/models/Candidate';
import { Application } from '@/lib/mongodb/models/Application';
import { Job } from '@/lib/mongodb/models/Job';
import { InterviewSession } from '@/lib/mongodb/models/InterviewSession';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { CandidateProfileClient } from './candidate-profile-client';

export default async function CandidateProfilePage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  await connectToDatabase();
  const doc = await Candidate.findOne({ _id: params.id, userId: user.id }).lean();
  if (!doc) notFound();

  const applicationDocs = await Application.find({ candidateId: params.id, userId: user.id }).sort({ createdAt: -1 }).lean();
  const jobIds = applicationDocs.map((a: any) => a.jobId);
  const jobDocs = await Job.find({ _id: { $in: jobIds } }).lean();
  const jobById = new Map(jobDocs.map((j: any) => [String(j._id), serializeDoc(j)]));

  const applications = applicationDocs.map((a: any) => ({ ...serializeDoc(a), job: jobById.get(String(a.jobId)) }));

  const applicationIds = applicationDocs.map((a: any) => a._id);
  const interviewDocs = await InterviewSession.find({ applicationId: { $in: applicationIds } }).sort({ createdAt: -1 }).lean();

  return (
    <CandidateProfileClient
      candidate={serializeDoc(doc) as any}
      applications={applications as any}
      interviews={interviewDocs.map(serializeDoc) as any}
    />
  );
}
