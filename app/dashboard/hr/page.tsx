import Link from 'next/link';
import { Types } from 'mongoose';
import {
  ArrowRight, Boxes, Briefcase, CheckCircle2, ClipboardCheck, FileSearch, Send, UserCheck, Users, XCircle,
} from 'lucide-react';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Job } from '@/lib/mongodb/models/Job';
import { Application } from '@/lib/mongodb/models/Application';
import { ActivityLog } from '@/lib/mongodb/models/ActivityLog';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StageChart } from '@/components/modules/hr/stage-chart';
import { ChatbotPanel } from '@/components/modules/hr/chatbot-panel';
import { HrNotificationsBell } from '@/components/modules/hr/notifications-bell';

export default async function HrDashboardPage() {
  const user = await getCurrentUser();
  await connectToDatabase();

  const [
    totalOpenPositions, totalApplicants, screenedCandidates, interviewsScheduled,
    offersSent, joinedCandidates, rejectedCandidates,
  ] = await Promise.all([
    Job.countDocuments({ userId: user?.id, status: 'open' }),
    Application.countDocuments({ userId: user?.id }),
    Application.countDocuments({ userId: user?.id, matchScore: { $ne: null } }),
    Application.countDocuments({ userId: user?.id, stage: { $in: ['hr_interview', 'technical_interview', 'final_interview'] } }),
    Application.countDocuments({ userId: user?.id, stage: 'offer' }),
    Application.countDocuments({ userId: user?.id, stage: 'joined' }),
    Application.countDocuments({ userId: user?.id, stage: 'rejected' }),
  ]);

  const stageBreakdownRaw = user
    ? await Application.aggregate([
      { $match: { userId: new Types.ObjectId(user.id) } },
      { $group: { _id: '$stage', count: { $sum: 1 } } },
    ])
    : [];
  const stageBreakdown = stageBreakdownRaw.map((s: any) => ({ stage: s._id as string, count: s.count as number }));

  const recentJobsDocs = await Job.find({ userId: user?.id }).sort({ createdAt: -1 }).limit(5).lean();
  const recentJobs = recentJobsDocs.map(serializeDoc);

  const activityDocs = await ActivityLog.find({ userId: user?.id, action: { $regex: '^hr\\.' } }).sort({ createdAt: -1 }).limit(8).lean();
  const activity = activityDocs.map(serializeDoc);

  const STATS = [
    { label: 'Total Open Positions', value: totalOpenPositions, icon: Briefcase },
    { label: 'Active Jobs', value: totalOpenPositions, icon: ClipboardCheck },
    { label: 'Total Applicants', value: totalApplicants, icon: Users },
    { label: 'AI Screened Candidates', value: screenedCandidates, icon: FileSearch },
    { label: 'Interviews Scheduled', value: interviewsScheduled, icon: UserCheck },
    { label: 'Offers Sent', value: offersSent, icon: Send },
    { label: 'Joined Candidates', value: joinedCandidates, icon: CheckCircle2 },
    { label: 'Rejected Candidates', value: rejectedCandidates, icon: XCircle },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
              <Boxes className="h-5 w-5" />
            </div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">AI HR Assistant</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Recruitment, resume screening, interview assistance, and an HR copilot in one workflow.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <HrNotificationsBell />
          <Link href="/dashboard/hr/jobs" className="inline-flex items-center gap-1 rounded-lg border border-border bg-card/60 px-3 py-2 text-sm font-medium transition hover:border-primary/40">
            Jobs <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link href="/dashboard/hr/candidates" className="inline-flex items-center gap-1 rounded-lg border border-border bg-card/60 px-3 py-2 text-sm font-medium transition hover:border-primary/40">
            Candidates <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((s) => (
          <Card key={s.label} className="relative overflow-hidden border-border bg-card/60 p-5 backdrop-blur">
            <s.icon className="h-5 w-5 text-primary" />
            <div className="mt-3 font-display text-3xl font-semibold">{s.value}</div>
            <div className="text-sm text-muted-foreground">{s.label}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-border bg-card/60 p-6 backdrop-blur lg:col-span-2">
          <h2 className="font-display text-lg font-semibold">Pipeline Breakdown</h2>
          <p className="mt-1 text-xs text-muted-foreground">Applications by stage across all open jobs.</p>
          <div className="mt-4">
            <StageChart data={stageBreakdown} />
          </div>
        </Card>

        <Card className="border-border bg-card/60 p-6 backdrop-blur">
          <h2 className="mb-3 font-display text-lg font-semibold">Recent Activity</h2>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recruitment activity yet.</p>
          ) : (
            <div className="space-y-3">
              {activity.map((a: any) => (
                <div key={a.id} className="flex items-start gap-2 text-sm">
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <div>
                    <p className="text-foreground/90">{a.action.replace('hr.', '').replace(/[._]/g, ' ')}</p>
                    <p className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="border-border bg-card/60 p-6 backdrop-blur">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Recent Jobs</h2>
          <Link href="/dashboard/hr/jobs" className="text-sm text-primary hover:underline">View all</Link>
        </div>
        {recentJobs.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No jobs created yet. <Link href="/dashboard/hr/jobs" className="text-primary hover:underline">Create your first job</Link>.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {recentJobs.map((j: any) => (
              <Link key={j.id} href={`/dashboard/hr/jobs/${j.id}`} className="flex items-center gap-3 py-3 transition hover:bg-secondary/50">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary text-muted-foreground">
                  <Briefcase className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{j.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{j.department} · {j.employmentType.replace('_', ' ')}</div>
                </div>
                <Badge variant={j.status === 'open' ? 'default' : 'secondary'} className="text-xs capitalize">{j.status}</Badge>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <ChatbotPanel />
    </div>
  );
}
