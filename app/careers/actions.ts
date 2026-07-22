'use server';

import { connectToDatabase } from '@/lib/mongodb/connect';
import { Job } from '@/lib/mongodb/models/Job';
import { RecruitmentSourceSettings } from '@/lib/mongodb/models/RecruitmentSourceSettings';
import { ingestResumeApplication } from '@/lib/hr/resume-intake';
import type { ApplicationSource, ApplicationStage } from '@/lib/types';

/** Public, unauthenticated — this is the Career Portal apply endpoint. Anyone with a
 * job's Apply URL (posted directly or shared via LinkedIn) can reach this. */
export async function submitCareerPortalApplication(formData: FormData) {
  const jobId = String(formData.get('jobId') ?? '');
  const source = (String(formData.get('source') ?? 'career_portal')) as ApplicationSource;
  const utmSource = String(formData.get('utmSource') ?? '') || undefined;
  const utmCampaign = String(formData.get('utmCampaign') ?? '') || undefined;
  const file = formData.get('resume') as File | null;

  if (!jobId) return { error: 'Missing job reference.' };
  if (!file || file.size === 0) return { error: 'Attach your resume (PDF or DOCX).' };

  await connectToDatabase();

  const job = await Job.findById(jobId).lean();
  if (!job || (job as any).status !== 'open') return { error: 'This position is no longer accepting applications.' };

  const settingsDoc = await RecruitmentSourceSettings.findOne({ userId: (job as any).userId }).lean();
  const careerPortal = (settingsDoc as any)?.careerPortal;
  if (careerPortal && careerPortal.enabled === false) return { error: 'This career portal is currently closed for applications.' };
  if (careerPortal && careerPortal.resumeUploadEnabled === false) return { error: 'Resume uploads are currently disabled for this portal.' };

  const maxSizeMb = careerPortal?.maxResumeSizeMb ?? 5;
  if (file.size > maxSizeMb * 1024 * 1024) return { error: `Resume exceeds the ${maxSizeMb}MB size limit.` };

  const lower = file.name.toLowerCase();
  const allowedTypes: string[] = careerPortal?.supportedResumeTypes ?? ['pdf', 'docx'];
  const ext = lower.endsWith('.pdf') ? 'pdf' : lower.endsWith('.docx') ? 'docx' : null;
  if (!ext || !allowedTypes.includes(ext)) return { error: `Unsupported resume type. Allowed: ${allowedTypes.join(', ')}.` };

  const buffer = Buffer.from(await file.arrayBuffer());
  const defaultStage = (careerPortal?.defaultApplicationStatus as ApplicationStage) || 'applied';

  const result = await ingestResumeApplication({
    userId: String((job as any).userId),
    buffer,
    fileName: file.name,
    source,
    sourceMeta: source === 'linkedin' ? { utmSource: utmSource ?? 'linkedin', utmCampaign } : null,
    jobId,
    defaultStage,
  });

  if (!result.ok) return { error: result.error };
  return { ok: true, duplicate: result.duplicate };
}
