import Link from 'next/link';
import { Types } from 'mongoose';
import {
  Activity, ArrowRight, Briefcase, CheckCircle2, FileSearch, Send, UserCheck, Users, XCircle,
} from 'lucide-react';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Job } from '@/lib/mongodb/models/Job';
import { Application } from '@/lib/mongodb/models/Application';
import { ActivityLog } from '@/lib/mongodb/models/ActivityLog';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MetricCard, type MetricState } from '@/components/dashboard/metric-card';
import { StatusBadge } from '@/components/dashboard/status-badge';
import {
  ChartCard, DashboardPageHeader, DashboardSection, EmptyState,
} from '@/components/dashboard/section';
import { CategoryBarChart, DonutChart } from '@/components/dashboard/charts';
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

  /**
   * Recruitment summary.
   *
   * "Active Jobs" was removed because it rendered the SAME `totalOpenPositions`
   * value as "Total Open Positions" — two cards asserting one number read as two
   * independent metrics. No query changed; one duplicate label is gone.
   */
  const STATS: Array<{ label: string; value: number; icon: typeof Briefcase; state?: MetricState }> = [
    { label: 'Open Positions', value: totalOpenPositions, icon: Briefcase },
    { label: 'Total Applicants', value: totalApplicants, icon: Users },
    { label: 'AI Screened', value: screenedCandidates, icon: FileSearch },
    { label: 'Interviews Scheduled', value: interviewsScheduled, icon: UserCheck },
    { label: 'Offers Sent', value: offersSent, icon: Send },
    { label: 'Joined', value: joinedCandidates, icon: CheckCircle2, state: 'success' },
    { label: 'Rejected', value: rejectedCandidates, icon: XCircle },
  ];

  /**
   * Candidate funnel, ordered by real recruitment stage. Every value comes from
   * the stage aggregation already performed above — nothing is interpolated.
   */
  const FUNNEL_ORDER: Array<{ stage: string; label: string }> = [
    { stage: 'applied', label: 'Applied' },
    { stage: 'screening', label: 'Screening' },
    { stage: 'shortlisted', label: 'Shortlisted' },
    { stage: 'hr_interview', label: 'HR Interview' },
    { stage: 'technical_interview', label: 'Technical' },
    { stage: 'final_interview', label: 'Final' },
    { stage: 'offer', label: 'Offer' },
    { stage: 'joined', label: 'Joined' },
  ];
  const byStage = new Map(stageBreakdown.map((d) => [d.stage, d.count]));
  const funnelData = FUNNEL_ORDER.map((s, i) => ({
    name: s.label,
    value: byStage.get(s.stage) ?? 0,
    color: `hsl(var(--chart-${(i % 6) + 1}))`,
  }));

  /** Outcome split — only the two terminal stages, both real counters. */
  const outcomeData = [
    { name: 'Joined', value: joinedCandidates, color: 'hsl(var(--success))' },
    { name: 'Rejected', value: rejectedCandidates, color: 'hsl(var(--destructive))' },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <DashboardPageHeader
        title="AI HR Assistant"
        description="Recruitment, resume screening, interview assistance, and an HR copilot in one workflow."
        actions={(
          <>
            <HrNotificationsBell />
            <Button asChild variant="outline" className="gap-1.5">
              <Link href="/hr/jobs">Jobs <ArrowRight className="h-3.5 w-3.5" /></Link>
            </Button>
            <Button asChild variant="outline" className="gap-1.5">
              <Link href="/hr/candidates">Candidates <ArrowRight className="h-3.5 w-3.5" /></Link>
            </Button>
          </>
        )}
      />

      <DashboardSection
        title="Recruitment summary"
        description="Live counts across every job and candidate in your organisation."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map((s) => (
            <MetricCard key={s.label} label={s.label} value={s.value} icon={s.icon} state={s.state} />
          ))}
        </div>
      </DashboardSection>

      {/* Hiring pipeline gets the most space — it is the primary HR question. */}
      <DashboardSection
        title="Hiring pipeline"
        description="Where candidates currently sit, and how terminal outcomes split."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <ChartCard
            title="Candidate funnel by stage"
            description="Applications at each recruitment stage, in pipeline order."
            summary={funnelData.map((d) => `${d.name}: ${d.value}`).join(', ')}
            className="lg:col-span-2"
          >
            <CategoryBarChart
              data={funnelData}
              layout="vertical"
              height={280}
              emptyMessage="No applications yet. The funnel fills in as candidates apply."
            />
          </ChartCard>

          <ChartCard
            title="Outcome split"
            description="Candidates who joined versus those rejected."
            summary={`Joined ${joinedCandidates}, rejected ${rejectedCandidates}.`}
          >
            <DonutChart
              data={outcomeData}
              centerValue={joinedCandidates + rejectedCandidates}
              centerLabel="decided"
              emptyMessage="No hiring decisions recorded yet."
            />
          </ChartCard>
        </div>
      </DashboardSection>

      <div className="grid gap-4 lg:grid-cols-3">
        <DashboardSection
          title="Pipeline breakdown"
          description="Applications by stage across all open jobs."
          className="lg:col-span-2"
        >
          <Card className="rounded-card border-border bg-card p-5 elevation-card">
            {/* Existing StageChart kept as-is — same component, same data prop. */}
            <StageChart data={stageBreakdown} />
          </Card>
        </DashboardSection>

        <DashboardSection title="Recent activity" description="Latest recruitment events.">
          <Card className="rounded-card border-border bg-card p-5 elevation-card">
            {activity.length === 0 ? (
              <EmptyState icon={Activity} title="No recruitment activity yet" className="py-6" />
            ) : (
              <ol className="space-y-3">
                {activity.map((a: any) => (
                  <li key={a.id} className="flex items-start gap-2.5 text-sm">
                    <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <div className="min-w-0">
                      <p className="truncate capitalize text-foreground">{a.action.replace('hr.', '').replace(/[._]/g, ' ')}</p>
                      <p className="type-caption nums text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </DashboardSection>
      </div>

      <DashboardSection
        title="Recent jobs"
        description="The five most recently created job openings."
        action={<Link href="/hr/jobs" className="type-caption font-medium text-primary hover:underline">View all</Link>}
      >
        <Card className="overflow-hidden rounded-card border-border bg-card elevation-card">
          {recentJobs.length === 0 ? (
            <EmptyState
              icon={Briefcase}
              title="No jobs created yet"
              action={<Link href="/hr/jobs" className="type-caption font-medium text-primary hover:underline">Create your first job</Link>}
            />
          ) : (
            <ul className="divide-y divide-border">
              {recentJobs.map((j: any) => (
                <li key={j.id}>
                  <Link
                    href={`/hr/jobs/${j.id}`}
                    className="flex items-center gap-3 px-5 py-3.5 outline-none transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-secondary text-muted-foreground ring-1 ring-inset ring-border">
                      <Briefcase className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{j.title}</div>
                      <div className="type-caption truncate capitalize text-muted-foreground">
                        {j.department} · {j.employmentType.replace('_', ' ')}
                      </div>
                    </div>
                    <StatusBadge status={j.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </DashboardSection>

      <ChatbotPanel />
    </div>
  );
}
