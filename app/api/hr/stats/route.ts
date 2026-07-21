import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Job } from '@/lib/mongodb/models/Job';
import { Application } from '@/lib/mongodb/models/Application';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();

  const [
    totalOpenPositions, activeJobs, totalApplicants, screenedCandidates,
    interviewsScheduled, offersSent, joinedCandidates, rejectedCandidates,
  ] = await Promise.all([
    Job.countDocuments({ userId: user.id, status: 'open' }),
    Job.countDocuments({ userId: user.id, status: 'open' }),
    Application.countDocuments({ userId: user.id }),
    Application.countDocuments({ userId: user.id, matchScore: { $ne: null } }),
    Application.countDocuments({ userId: user.id, stage: { $in: ['hr_interview', 'technical_interview', 'final_interview'] } }),
    Application.countDocuments({ userId: user.id, stage: 'offer' }),
    Application.countDocuments({ userId: user.id, stage: 'joined' }),
    Application.countDocuments({ userId: user.id, stage: 'rejected' }),
  ]);

  const stageBreakdown = await Application.aggregate([
    { $match: { userId: new Types.ObjectId(user.id) } },
    { $group: { _id: '$stage', count: { $sum: 1 } } },
  ]);

  return NextResponse.json({
    stats: {
      totalOpenPositions,
      activeJobs,
      totalApplicants,
      screenedCandidates,
      interviewsScheduled,
      offersSent,
      joinedCandidates,
      rejectedCandidates,
    },
    stageBreakdown: stageBreakdown.map((s: any) => ({ stage: s._id, count: s.count })),
  });
}
