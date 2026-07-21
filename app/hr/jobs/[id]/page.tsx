import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Briefcase, Calendar, DollarSign, MapPin, Users } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Job } from '@/lib/mongodb/models/Job';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { UploadResumesDialog } from '@/components/modules/hr/upload-resumes-dialog';
import { PipelineBoard } from '@/components/modules/hr/pipeline-board';
import type { Job as JobType } from '@/lib/types';

export default async function JobDetailPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  await connectToDatabase();
  const doc = await Job.findOne({ _id: params.id, userId: user.id }).lean();
  if (!doc) notFound();
  const job = serializeDoc(doc) as JobType;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <div className="flex items-start gap-3">
        <Link href="/hr/jobs" className="mt-1 text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight">{job.title}</h1>
            <Badge variant={job.status === 'open' ? 'default' : 'secondary'} className="capitalize">{job.status}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" /> {job.department}</span>
            <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {job.workMode}</span>
            {(job.salaryMin || job.salaryMax) && (
              <span className="inline-flex items-center gap-1">
                <DollarSign className="h-3.5 w-3.5" /> {job.salaryCurrency} {job.salaryMin?.toLocaleString()}{job.salaryMax ? ` - ${job.salaryMax.toLocaleString()}` : ''}
              </span>
            )}
            {job.closingDate && (
              <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Closes {new Date(job.closingDate).toLocaleDateString()}</span>
            )}
            <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {job.openings} opening{job.openings === 1 ? '' : 's'}</span>
          </div>
        </div>
        <UploadResumesDialog jobId={job.id} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="border-border bg-card/60 p-5 backdrop-blur lg:col-span-2">
          <h2 className="mb-2 font-display text-sm font-semibold">Description</h2>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{job.description || 'No description provided.'}</p>

          {job.responsibilities && (
            <>
              <h2 className="mb-2 mt-4 font-display text-sm font-semibold">Responsibilities</h2>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{job.responsibilities}</p>
            </>
          )}
          {job.qualifications && (
            <>
              <h2 className="mb-2 mt-4 font-display text-sm font-semibold">Qualifications</h2>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{job.qualifications}</p>
            </>
          )}
          {job.benefits && (
            <>
              <h2 className="mb-2 mt-4 font-display text-sm font-semibold">Benefits</h2>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{job.benefits}</p>
            </>
          )}
        </Card>

        <Card className="border-border bg-card/60 p-5 backdrop-blur">
          <h2 className="mb-3 font-display text-sm font-semibold">Details</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Hiring Manager</span><span className="font-medium">{job.hiringManager}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Employment Type</span><span className="font-medium capitalize">{job.employmentType.replace('_', ' ')}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Experience</span><span className="font-medium">{job.experienceMinYears}-{job.experienceMaxYears} yrs</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Priority</span><span className="font-medium capitalize">{job.priority}</span></div>
          </div>
          <div className="mt-3">
            <div className="mb-1.5 text-xs text-muted-foreground">Required Skills</div>
            <div className="flex flex-wrap gap-1">
              {job.requiredSkills.map((s) => <Badge key={s} variant="outline" className="text-[10px] font-normal">{s}</Badge>)}
            </div>
          </div>
          {job.preferredSkills.length > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 text-xs text-muted-foreground">Preferred Skills</div>
              <div className="flex flex-wrap gap-1">
                {job.preferredSkills.map((s) => <Badge key={s} variant="secondary" className="text-[10px] font-normal">{s}</Badge>)}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card className="border-border bg-card/40 p-5 backdrop-blur">
        <h2 className="mb-3 font-display text-lg font-semibold">Hiring Pipeline</h2>
        <PipelineBoard jobId={job.id} />
      </Card>
    </div>
  );
}
