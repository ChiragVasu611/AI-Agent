'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Job } from '@/lib/mongodb/models/Job';
import { Candidate } from '@/lib/mongodb/models/Candidate';
import { Application } from '@/lib/mongodb/models/Application';
import { InterviewSession } from '@/lib/mongodb/models/InterviewSession';
import { Notification } from '@/lib/mongodb/models/Notification';
import { ActivityLog } from '@/lib/mongodb/models/ActivityLog';
import { extractTextFromFile, parseResumeText, hashText } from '@/lib/hr/resume-parser';
import { computeMatch } from '@/lib/hr/matching';
import { generateInterviewQuestions } from '@/lib/hr/questions';
import { computeOverallScore, generateInterviewSummary, recommendationForInterview } from '@/lib/hr/evaluation';
import { generateOfferLetter } from '@/lib/hr/offer-letter';
import { handleChatbotMessage } from '@/lib/hr/chatbot';
import { hasPermission } from '@/lib/auth/permissions';
import type {
  ApplicationStage, InterviewRatings, InterviewStage,
} from '@/lib/types';

export async function updateJobStatus(jobId: string, status: 'open' | 'closed' | 'draft') {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };
  if (!hasPermission(user.permissions, 'recruitment.manage')) return { error: 'Forbidden: your role does not have recruitment.manage permission.' };
  await connectToDatabase();
  await Job.findOneAndUpdate({ _id: jobId, userId: user.id }, { status });
  revalidatePath('/hr/jobs');
  return { ok: true };
}

export async function deleteJob(jobId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };
  if (!hasPermission(user.permissions, 'recruitment.manage')) return { error: 'Forbidden: your role does not have recruitment.manage permission.' };
  await connectToDatabase();
  await Job.deleteOne({ _id: jobId, userId: user.id });
  revalidatePath('/hr/jobs');
  return { ok: true };
}

export async function uploadResumes(jobId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };
  if (!hasPermission(user.permissions, 'recruitment.manage')) return { error: 'Forbidden: your role does not have recruitment.manage permission.' };

  await connectToDatabase();
  const job = await Job.findOne({ _id: jobId, userId: user.id }).lean();
  if (!job) return { error: 'Job not found' };

  const files = formData.getAll('resumes') as File[];
  if (files.length === 0) return { error: 'No files provided.' };

  const results: Array<{ fileName: string; candidateId?: string; error?: string }> = [];

  for (const file of files) {
    try {
      const lower = file.name.toLowerCase();
      if (!lower.endsWith('.pdf') && !lower.endsWith('.docx')) {
        results.push({ fileName: file.name, error: 'Unsupported file type (PDF/DOCX only).' });
        continue;
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const text = await extractTextFromFile(buffer, file.name);
      const parsed = parseResumeText(text);
      const textHash = await hashText(text);

      const existingByHash = await Candidate.findOne({ userId: user.id, resumeTextHash: textHash });
      const existingByEmail = parsed.email
        ? await Candidate.findOne({ userId: user.id, email: parsed.email })
        : null;
      const isDuplicate = Boolean(existingByHash);
      const existing = existingByHash ?? existingByEmail;

      const candidateData = {
        userId: user.id,
        name: parsed.name,
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
        resumeFileName: file.name,
        resumeText: text,
        resumeTextHash: textHash,
      };

      const candidate = existing
        ? await Candidate.findByIdAndUpdate(existing._id, candidateData, { new: true })
        : await Candidate.create(candidateData);

      const match = computeMatch(candidate as any, job as any, { isDuplicate });

      await Application.findOneAndUpdate(
        { jobId, candidateId: candidate!._id },
        {
          userId: user.id,
          jobId,
          candidateId: candidate!._id,
          stage: 'screening',
          matchScore: match.matchScore,
          aiInsights: match.aiInsights,
          flags: match.flags,
          recommendation: match.recommendation,
        },
        { upsert: true, new: true },
      );

      await Notification.create({
        userId: user.id, type: 'info', title: 'Resume Uploaded', message: `${candidate!.name} applied for ${(job as any).title}.`,
      });

      results.push({ fileName: file.name, candidateId: String(candidate!._id) });
    } catch (e) {
      results.push({ fileName: file.name, error: String((e as Error).message ?? e) });
    }
  }

  await ActivityLog.create({
    userId: user.id, action: 'hr.resume.upload', entity: 'job', entityId: jobId, meta: { count: files.length },
  });

  revalidatePath(`/hr/jobs/${jobId}`);
  revalidatePath('/hr/candidates');
  revalidatePath('/hr');
  return { results };
}

const STAGE_NOTIFICATION: Partial<Record<ApplicationStage, string>> = {
  shortlisted: 'Candidate Shortlisted',
  offer: 'Offer Sent',
  joined: 'Candidate Joined',
};

export async function moveApplicationStage(applicationId: string, stage: ApplicationStage) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };
  if (!hasPermission(user.permissions, 'recruitment.manage')) return { error: 'Forbidden: your role does not have recruitment.manage permission.' };

  await connectToDatabase();
  const app = await Application.findOneAndUpdate(
    { _id: applicationId, userId: user.id },
    { stage },
    { new: true },
  );
  if (!app) return { error: 'Application not found' };

  const notifTitle = STAGE_NOTIFICATION[stage];
  if (notifTitle) {
    const candidate = await Candidate.findById(app.candidateId).lean();
    await Notification.create({
      userId: user.id, type: 'info', title: notifTitle, message: `${(candidate as any)?.name ?? 'Candidate'} moved to ${stage.replace('_', ' ')}.`,
    });
  }

  await ActivityLog.create({
    userId: user.id, action: 'hr.application.stage_change', entity: 'application', entityId: applicationId, meta: { stage },
  });

  revalidatePath(`/hr/jobs/${String(app.jobId)}`);
  revalidatePath('/hr');
  return { ok: true };
}

export async function updateCandidateNotes(candidateId: string, notes: string) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };
  if (!hasPermission(user.permissions, 'employee.update')) return { error: 'Forbidden: your role does not have employee.update permission.' };
  await connectToDatabase();
  await Candidate.findOneAndUpdate({ _id: candidateId, userId: user.id }, { notes });
  revalidatePath(`/hr/candidates/${candidateId}`);
  return { ok: true };
}

export async function updateApplicationNotes(applicationId: string, notes: string) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };
  if (!hasPermission(user.permissions, 'employee.update')) return { error: 'Forbidden: your role does not have employee.update permission.' };
  await connectToDatabase();
  await Application.findOneAndUpdate({ _id: applicationId, userId: user.id }, { notes });
  return { ok: true };
}

export async function scheduleInterview(applicationId: string, stage: InterviewStage, scheduledAt: string, interviewer: string) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };
  if (!hasPermission(user.permissions, 'recruitment.manage')) return { error: 'Forbidden: your role does not have recruitment.manage permission.' };

  await connectToDatabase();
  const app = await Application.findOne({ _id: applicationId, userId: user.id }).lean();
  if (!app) return { error: 'Application not found' };

  const job = await Job.findById((app as any).jobId).lean();
  const candidate = await Candidate.findById((app as any).candidateId).lean();
  if (!job || !candidate) return { error: 'Job or candidate missing' };

  const questions = generateInterviewQuestions(job as any, candidate as any);

  const session = await InterviewSession.create({
    userId: user.id,
    applicationId,
    stage,
    interviewer,
    scheduledAt: new Date(scheduledAt),
    status: 'scheduled',
    questions,
  });

  await Notification.create({
    userId: user.id, type: 'info', title: 'Interview Reminder', message: `Interview with ${(candidate as any).name} scheduled.`,
  });

  await Application.findByIdAndUpdate(applicationId, { stage });

  revalidatePath(`/hr/jobs/${String((app as any).jobId)}`);
  return { sessionId: String(session._id) };
}

export async function submitInterviewFeedback(sessionId: string, ratings: InterviewRatings, liveNotes: string, durationSeconds: number) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };
  if (!hasPermission(user.permissions, 'recruitment.manage')) return { error: 'Forbidden: your role does not have recruitment.manage permission.' };

  await connectToDatabase();
  const session = await InterviewSession.findOne({ _id: sessionId, userId: user.id });
  if (!session) return { error: 'Interview session not found' };

  const app = await Application.findById(session.applicationId).lean();
  const candidate = app ? await Candidate.findById((app as any).candidateId).lean() : null;
  const job = app ? await Job.findById((app as any).jobId).lean() : null;

  const overallScore = computeOverallScore(ratings);
  const recommendation = recommendationForInterview(overallScore);
  const summary = generateInterviewSummary(
    (candidate as any)?.name ?? 'The candidate',
    (job as any)?.title ?? 'the role',
    ratings,
    overallScore,
    recommendation,
    liveNotes,
  );

  session.ratings = ratings as any;
  session.liveNotes = liveNotes;
  session.durationSeconds = durationSeconds;
  session.overallScore = overallScore;
  session.recommendation = recommendation;
  session.summary = summary;
  session.status = 'completed';
  await session.save();

  await Notification.create({
    userId: user.id, type: 'info', title: 'Interview Completed', message: `${(candidate as any)?.name ?? 'Candidate'} — ${recommendation?.replace('_', ' ')}.`,
  });

  if (app) revalidatePath(`/hr/jobs/${String((app as any).jobId)}`);
  return { ok: true, overallScore, recommendation, summary };
}

export async function generateOfferForApplication(applicationId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };

  await connectToDatabase();
  const app = await Application.findOne({ _id: applicationId, userId: user.id }).lean();
  if (!app) return { error: 'Application not found' };

  const job = await Job.findById((app as any).jobId).lean();
  const candidate = await Candidate.findById((app as any).candidateId).lean();
  if (!job || !candidate) return { error: 'Job or candidate missing' };

  const letter = generateOfferLetter({
    candidateName: (candidate as any).name,
    jobTitle: (job as any).title,
    department: (job as any).department,
    salaryMin: (job as any).salaryMin,
    salaryMax: (job as any).salaryMax,
    salaryCurrency: (job as any).salaryCurrency,
  });

  return { letter };
}

export async function chatbotMessage(message: string) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };
  const result = await handleChatbotMessage(user.id, message);
  revalidatePath('/hr');
  return result;
}
