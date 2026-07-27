import { Bot, Boxes, FileSearch, Layers, Users } from 'lucide-react';
import { requireWorkspace } from '@/lib/auth/require-workspace';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { User } from '@/lib/mongodb/models/User';
import { Project } from '@/lib/mongodb/models/Project';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaBug } from '@/lib/mongodb/models/QaBug';
import { Job } from '@/lib/mongodb/models/Job';
import { Candidate } from '@/lib/mongodb/models/Candidate';
import { Application } from '@/lib/mongodb/models/Application';
import { DesignProject } from '@/lib/mongodb/models/DesignProject';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

async function countBy(model: any, field: string) {
  const rows = await model.aggregate([{ $group: { _id: `$${field}`, count: { $sum: 1 } } }]);
  return new Map<string, number>(rows.map((r: any) => [String(r._id ?? 'unknown'), r.count]));
}

export default async function AdminReportsPage() {
  await requireWorkspace('admin.manage');
  await connectToDatabase();

  const [
    totalUsers,
    usersByRole,
    totalProjects,
    projectsByStatus,
    totalQaRuns,
    qaRunsByStatus,
    totalBugs,
    bugsBySeverity,
    totalJobs,
    totalCandidates,
    applicationsByStage,
    totalDesignProjects,
  ] = await Promise.all([
    User.countDocuments({}),
    countBy(User, 'role'),
    Project.countDocuments({}),
    countBy(Project, 'status'),
    QaTestRun.countDocuments({}),
    countBy(QaTestRun, 'status'),
    QaBug.countDocuments({}),
    countBy(QaBug, 'severity'),
    Job.countDocuments({}),
    Candidate.countDocuments({}),
    countBy(Application, 'stage'),
    DesignProject.countDocuments({}),
  ]);

  const sections = [
    {
      key: 'app_factory',
      label: 'AI App Factory',
      icon: Bot,
      total: totalProjects,
      totalLabel: 'Total Projects',
      breakdown: Array.from(projectsByStatus.entries()),
    },
    {
      key: 'qa',
      label: 'QA Workspace',
      icon: FileSearch,
      total: totalQaRuns,
      totalLabel: 'Total Test Runs',
      breakdown: Array.from(qaRunsByStatus.entries()),
      secondary: { label: 'Bugs Found', total: totalBugs, breakdown: Array.from(bugsBySeverity.entries()) },
    },
    {
      key: 'hr',
      label: 'HR Workspace',
      icon: Boxes,
      total: totalJobs,
      totalLabel: 'Open/Total Jobs',
      breakdown: [['Candidates', totalCandidates] as [string, number], ...(Array.from(applicationsByStage.entries()) as [string, number][])],
    },
    {
      key: 'designer',
      label: 'UI/UX Workspace',
      icon: Layers,
      total: totalDesignProjects,
      totalLabel: 'Design Projects',
      breakdown: [] as [string, number][],
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live cross-workspace usage, computed directly from the database — not a cached snapshot.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border bg-card/60 p-5 backdrop-blur">
          <div className="flex items-center gap-2 text-muted-foreground"><Users className="h-4 w-4" /> Total Users</div>
          <div className="mt-2 font-display text-3xl font-semibold">{totalUsers}</div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {Array.from(usersByRole.entries()).map(([role, count]) => (
              <Badge key={role} variant="secondary" className="text-[10px] capitalize">{role.replace(/_/g, ' ')}: {count}</Badge>
            ))}
          </div>
        </Card>
        {sections.map((s) => (
          <Card key={s.key} className="border-border bg-card/60 p-5 backdrop-blur">
            <div className="flex items-center gap-2 text-muted-foreground"><s.icon className="h-4 w-4" /> {s.totalLabel}</div>
            <div className="mt-2 font-display text-3xl font-semibold">{s.total}</div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {s.breakdown.length === 0 ? (
                <span className="text-xs text-muted-foreground">No data yet.</span>
              ) : (
                s.breakdown.map(([label, count]) => (
                  <Badge key={label} variant="secondary" className="text-[10px] capitalize">{String(label).replace(/_/g, ' ')}: {count}</Badge>
                ))
              )}
            </div>
          </Card>
        ))}
      </div>

      <Card className="border-border bg-card/60 p-6 backdrop-blur">
        <h2 className="font-display text-lg font-semibold">QA Bugs by Severity</h2>
        <p className="mt-1 text-sm text-muted-foreground">{totalBugs} total bug{totalBugs === 1 ? '' : 's'} logged across all QA runs.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {Array.from(bugsBySeverity.entries()).length === 0 ? (
            <span className="text-sm text-muted-foreground">No bugs recorded yet.</span>
          ) : (
            Array.from(bugsBySeverity.entries()).map(([sev, count]) => (
              <Badge key={sev} variant="outline" className="text-xs capitalize">{sev}: {count}</Badge>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
