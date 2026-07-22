import { connectToDatabase } from '@/lib/mongodb/connect';
import { Job } from '@/lib/mongodb/models/Job';
import { Candidate } from '@/lib/mongodb/models/Candidate';
import { Application } from '@/lib/mongodb/models/Application';
import { Notification } from '@/lib/mongodb/models/Notification';
import { ActivityLog } from '@/lib/mongodb/models/ActivityLog';
import { extractTextFromFile, parseResumeText, hashText } from '@/lib/hr/resume-parser';
import { computeMatch } from '@/lib/hr/matching';
import type { ApplicationSource, ApplicationSourceMeta, ApplicationStage } from '@/lib/types';

const GENERAL_POOL_JOB_TITLE = 'General Applications';

export interface IngestResumeInput {
  userId: string;
  buffer: Buffer;
  fileName: string;
  source: ApplicationSource;
  sourceMeta?: ApplicationSourceMeta | null;
  /** Target job for this application. If omitted, the candidate lands in a per-user
   * "General Applications" pool job (auto-created), so HR can re-route them to a real
   * opening — Application.jobId is a required field, so every intake needs a job. */
  jobId?: string | null;
  defaultStage?: ApplicationStage;
}

export type IngestResumeResult =
  | { ok: true; candidateId: string; applicationId: string; jobId: string; duplicate: boolean }
  | { ok: false; error: string };

async function getOrCreateGeneralPoolJob(userId: string) {
  const existing = await Job.findOne({ userId, title: GENERAL_POOL_JOB_TITLE }).lean();
  if (existing) return existing;
  return Job.create({
    userId,
    title: GENERAL_POOL_JOB_TITLE,
    department: 'General',
    employmentType: 'full_time',
    workMode: 'remote',
    experienceMinYears: 0,
    experienceMaxYears: 0,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: 'USD',
    requiredSkills: [],
    preferredSkills: [],
    description: 'Auto-created holding pool for candidates who applied without a specific job selected (recruitment email, WhatsApp, or a general career portal application). Re-assign or shortlist from here.',
    responsibilities: '',
    qualifications: '',
    benefits: '',
    hiringManager: 'Unassigned',
    openings: 0,
    priority: 'low',
    closingDate: null,
    status: 'open',
  });
}

export async function ingestResumeApplication(input: IngestResumeInput): Promise<IngestResumeResult> {
  const lowerName = input.fileName.toLowerCase();
  if (!lowerName.endsWith('.pdf') && !lowerName.endsWith('.docx')) {
    return { ok: false, error: 'Unsupported resume type (PDF/DOCX only).' };
  }

  await connectToDatabase();

  const job = input.jobId
    ? await Job.findOne({ _id: input.jobId, userId: input.userId }).lean()
    : await getOrCreateGeneralPoolJob(input.userId);
  if (!job) return { ok: false, error: 'Target job not found.' };

  const text = await extractTextFromFile(input.buffer, input.fileName);
  const parsed = parseResumeText(text);
  const textHash = await hashText(text);

  const existingByHash = await Candidate.findOne({ userId: input.userId, resumeTextHash: textHash });
  const existingByEmail = parsed.email
    ? await Candidate.findOne({ userId: input.userId, email: parsed.email })
    : null;
  const isDuplicate = Boolean(existingByHash);
  const existing = existingByHash ?? existingByEmail;

  const candidateData = {
    userId: input.userId,
    name: parsed.name || 'Unknown Candidate',
    email: parsed.email,
    phone: parsed.phone,
    address: parsed.address,
    skills: parsed.skills,
    experience: parsed.experience,
    totalExperienceYears: parsed.totalExperienceYears,
    education: parsed.education,
    certifications: parsed.certifications,
    languages: parsed.languages,
    projects: parsed.projects,
    companiesWorked: parsed.companiesWorked,
    resumeFileName: input.fileName,
    resumeText: text,
    resumeTextHash: textHash,
  };

  const candidate = existing
    ? await Candidate.findByIdAndUpdate(existing._id, candidateData, { new: true })
    : await Candidate.create(candidateData);

  const match = computeMatch(candidate as any, job as any, { isDuplicate });

  const application = await Application.findOneAndUpdate(
    { jobId: (job as any)._id, candidateId: candidate!._id },
    {
      userId: input.userId,
      jobId: (job as any)._id,
      candidateId: candidate!._id,
      stage: input.defaultStage ?? 'applied',
      matchScore: match.matchScore,
      aiInsights: match.aiInsights,
      flags: match.flags,
      recommendation: match.recommendation,
      source: input.source,
      sourceMeta: input.sourceMeta ?? null,
    },
    { upsert: true, new: true },
  );

  const sourceLabel = { career_portal: 'Career Portal', linkedin: 'LinkedIn', email: 'Recruitment Email', whatsapp: 'WhatsApp', manual: 'Manual' }[input.source];
  await Notification.create({
    userId: input.userId,
    type: 'info',
    title: 'New Application Received',
    message: `${candidate!.name} applied for ${(job as any).title} via ${sourceLabel}.`,
  });

  await ActivityLog.create({
    userId: input.userId,
    action: 'hr.application.auto_intake',
    entity: 'application',
    entityId: String(application!._id),
    meta: { source: input.source, jobId: String((job as any)._id), candidateId: String(candidate!._id) },
  });

  return {
    ok: true,
    candidateId: String(candidate!._id),
    applicationId: String(application!._id),
    jobId: String((job as any)._id),
    duplicate: isDuplicate,
  };
}
