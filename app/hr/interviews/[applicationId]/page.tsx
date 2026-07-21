import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Application } from '@/lib/mongodb/models/Application';
import { Candidate } from '@/lib/mongodb/models/Candidate';
import { Job } from '@/lib/mongodb/models/Job';
import { InterviewSession } from '@/lib/mongodb/models/InterviewSession';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { generateInterviewQuestions } from '@/lib/hr/questions';
import { InterviewRoom } from '@/components/modules/hr/interview-room';
import type { ApplicationStage } from '@/lib/types';

const INTERVIEW_STAGES: ApplicationStage[] = ['hr_interview', 'technical_interview', 'final_interview'];

export default async function InterviewPage({ params }: { params: { applicationId: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  await connectToDatabase();
  const application = await Application.findOne({ _id: params.applicationId, userId: user.id }).lean();
  if (!application) notFound();

  const [candidate, job] = await Promise.all([
    Candidate.findById((application as any).candidateId).lean(),
    Job.findById((application as any).jobId).lean(),
  ]);
  if (!candidate || !job) notFound();

  let session: Record<string, any> | null = await InterviewSession.findOne({ applicationId: params.applicationId, userId: user.id })
    .sort({ createdAt: -1 })
    .lean();

  if (!session) {
    const stage: ApplicationStage = INTERVIEW_STAGES.includes((application as any).stage)
      ? (application as any).stage
      : 'hr_interview';
    const questions = generateInterviewQuestions(job as any, candidate as any);
    const created = await InterviewSession.create({
      userId: user.id,
      applicationId: params.applicationId,
      stage,
      scheduledAt: new Date(),
      status: 'scheduled',
      questions,
    });
    session = created.toObject();
  }

  return (
    <InterviewRoom
      session={serializeDoc(session!) as any}
      candidate={serializeDoc(candidate) as any}
      job={serializeDoc(job) as any}
    />
  );
}
