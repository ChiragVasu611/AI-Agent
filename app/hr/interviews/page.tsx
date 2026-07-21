import Link from 'next/link';
import { redirect } from 'next/navigation';
import { UserCheck } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { InterviewSession } from '@/lib/mongodb/models/InterviewSession';
import { Application } from '@/lib/mongodb/models/Application';
import { Candidate } from '@/lib/mongodb/models/Candidate';
import { Job } from '@/lib/mongodb/models/Job';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default async function AllInterviewsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  await connectToDatabase();
  const sessions = await InterviewSession.find({ userId: user.id }).sort({ scheduledAt: -1 }).lean();

  const applicationIds = sessions.map((s: any) => s.applicationId);
  const applications = await Application.find({ _id: { $in: applicationIds } }).lean();
  const appById = new Map(applications.map((a: any) => [String(a._id), a]));

  const candidateIds = applications.map((a: any) => a.candidateId);
  const jobIds = applications.map((a: any) => a.jobId);
  const [candidates, jobs] = await Promise.all([
    Candidate.find({ _id: { $in: candidateIds } }).lean(),
    Job.find({ _id: { $in: jobIds } }).lean(),
  ]);
  const candidateById = new Map(candidates.map((c: any) => [String(c._id), c]));
  const jobById = new Map(jobs.map((j: any) => [String(j._id), j]));

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
          <UserCheck className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Interview Assistant</h1>
          <p className="text-sm text-muted-foreground">Every interview session scheduled across all jobs.</p>
        </div>
      </div>

      <Card className="border-border bg-card/60 backdrop-blur">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <UserCheck className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No interviews yet. Move a candidate into an interview stage from a job&apos;s pipeline to schedule one.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sessions.map((session: any) => {
              const app = appById.get(String(session.applicationId));
              const candidate = app ? candidateById.get(String(app.candidateId)) : null;
              const job = app ? jobById.get(String(app.jobId)) : null;
              return (
                <Link
                  key={session._id}
                  href={`/hr/interviews/${session.applicationId}`}
                  className="flex items-center gap-4 px-5 py-4 transition hover:bg-secondary/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{candidate?.name ?? 'Unknown candidate'}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {job?.title ?? 'Unknown job'} · {session.stage.replace('_', ' ')}
                    </div>
                  </div>
                  {session.overallScore != null && (
                    <span className="text-xs tabular-nums text-muted-foreground">{session.overallScore}/10</span>
                  )}
                  <Badge variant={session.status === 'completed' ? 'secondary' : 'outline'} className="text-xs capitalize">
                    {session.status}
                  </Badge>
                </Link>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
