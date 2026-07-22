import { notFound } from 'next/navigation';
import { Briefcase, MapPin } from 'lucide-react';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Job } from '@/lib/mongodb/models/Job';
import { RecruitmentSourceSettings } from '@/lib/mongodb/models/RecruitmentSourceSettings';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { Badge } from '@/components/ui/badge';
import { ApplyForm } from './apply-form';
import type { Job as JobType, RecruitmentSourceSettings as SettingsType } from '@/lib/types';

const LINKEDIN_MARKERS = ['linkedin', 'li'];

export default async function CareerPortalApplyPage({
  params, searchParams,
}: {
  params: { jobId: string };
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  await connectToDatabase();
  const doc = await Job.findById(params.jobId).lean();
  if (!doc) notFound();
  const job = serializeDoc(doc) as JobType;

  const settingsDoc = await RecruitmentSourceSettings.findOne({ userId: job.userId }).lean();
  const settings = settingsDoc ? (serializeDoc(settingsDoc) as SettingsType) : null;
  const careerPortal = settings?.careerPortal;

  if (careerPortal && (careerPortal.enabled === false || careerPortal.resumeUploadEnabled === false)) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">This career portal is not currently accepting applications.</p>
      </div>
    );
  }
  if (job.status !== 'open') {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">This position is no longer accepting applications.</p>
      </div>
    );
  }

  const utmSourceParam = String(searchParams.utm_source ?? searchParams.src ?? '').toLowerCase();
  const isLinkedin = LINKEDIN_MARKERS.includes(utmSourceParam);
  const utmCampaign = String(searchParams.utm_campaign ?? '') || undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6 py-12 lg:p-8">
      <div className="flex items-center gap-3">
        {careerPortal?.companyLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={careerPortal.companyLogoUrl} alt={careerPortal.companyName} className="h-10 w-10 rounded-lg object-cover" />
        ) : null}
        <span className="font-display text-sm font-semibold text-muted-foreground">
          {careerPortal?.companyName || 'Careers'}
        </span>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl font-semibold tracking-tight">{job.title}</h1>
          {isLinkedin && <Badge variant="outline" className="text-xs">via LinkedIn</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" /> {job.department}</span>
          <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {job.workMode}</span>
        </div>
      </div>

      <div className="whitespace-pre-wrap text-sm text-muted-foreground">{job.description || 'No description provided.'}</div>

      <ApplyForm
        jobId={job.id}
        source={isLinkedin ? 'linkedin' : 'career_portal'}
        utmSource={utmSourceParam || undefined}
        utmCampaign={utmCampaign}
      />
    </div>
  );
}
