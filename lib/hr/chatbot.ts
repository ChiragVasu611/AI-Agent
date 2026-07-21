/**
 * Rule-based HR Copilot. No external AI API — intents are matched with
 * regex/keywords and each handler performs a real MongoDB read or write, so
 * the chatbot genuinely acts inside the platform rather than only replying with text.
 */
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Job } from '@/lib/mongodb/models/Job';
import { Candidate } from '@/lib/mongodb/models/Candidate';
import { Application } from '@/lib/mongodb/models/Application';
import { InterviewSession } from '@/lib/mongodb/models/InterviewSession';
import { Notification } from '@/lib/mongodb/models/Notification';
import { generateInterviewQuestions } from './questions';
import { generateOfferLetter } from './offer-letter';

export interface ChatbotResult {
  reply: string;
  action: string;
  data?: unknown;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

async function listTodaysInterviews(userId: string): Promise<ChatbotResult> {
  const sessions = await InterviewSession.find({
    userId, scheduledAt: { $gte: startOfToday(), $lte: endOfToday() },
  }).sort({ scheduledAt: 1 }).lean();

  if (sessions.length === 0) return { reply: "There are no interviews scheduled for today.", action: 'list_interviews', data: [] };

  const appIds = sessions.map((s: any) => s.applicationId);
  const apps = await Application.find({ _id: { $in: appIds } }).lean();
  const candidateIds = apps.map((a: any) => a.candidateId);
  const candidates = await Candidate.find({ _id: { $in: candidateIds } }).lean();
  const candidateById = new Map(candidates.map((c: any) => [String(c._id), c]));
  const appById = new Map(apps.map((a: any) => [String(a._id), a]));

  const lines = sessions.map((s: any) => {
    const app = appById.get(String(s.applicationId));
    const cand = app ? candidateById.get(String(app.candidateId)) : null;
    const time = s.scheduledAt ? new Date(s.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'unscheduled time';
    return `• ${cand?.name ?? 'Unknown candidate'} — ${s.stage.replace('_', ' ')} at ${time}`;
  });

  return { reply: `You have ${sessions.length} interview(s) today:\n${lines.join('\n')}`, action: 'list_interviews', data: sessions };
}

async function listPendingCandidates(userId: string): Promise<ChatbotResult> {
  const apps = await Application.find({
    userId, stage: { $nin: ['joined', 'rejected', 'offer'] },
  }).sort({ createdAt: -1 }).limit(10).lean();

  if (apps.length === 0) return { reply: 'There are no pending candidates in the pipeline right now.', action: 'list_pending', data: [] };

  const candidates = await Candidate.find({ _id: { $in: apps.map((a: any) => a.candidateId) } }).lean();
  const candidateById = new Map(candidates.map((c: any) => [String(c._id), c]));
  const lines = apps.map((a: any) => `• ${candidateById.get(String(a.candidateId))?.name ?? 'Unknown'} — ${a.stage.replace('_', ' ')}`);

  return { reply: `Found ${apps.length} pending candidate(s):\n${lines.join('\n')}`, action: 'list_pending', data: apps };
}

async function findCandidatesBySkill(userId: string, skill: string): Promise<ChatbotResult> {
  const candidates = await Candidate.find({
    userId, skills: { $regex: skill, $options: 'i' },
  }).limit(10).lean();

  if (candidates.length === 0) return { reply: `No candidates found with skill "${skill}".`, action: 'search_skill', data: [] };

  const lines = candidates.map((c: any) => `• ${c.name} — ${c.skills.slice(0, 5).join(', ')}`);
  return { reply: `Found ${candidates.length} candidate(s) matching "${skill}":\n${lines.join('\n')}`, action: 'search_skill', data: candidates };
}

async function findCandidatesByExperience(userId: string, minYears: number): Promise<ChatbotResult> {
  const candidates = await Candidate.find({ userId, totalExperienceYears: { $gte: minYears } }).limit(10).lean();
  if (candidates.length === 0) return { reply: `No candidates found with ${minYears}+ years of experience.`, action: 'search_experience', data: [] };
  const lines = candidates.map((c: any) => `• ${c.name} — ${c.totalExperienceYears} years`);
  return { reply: `Found ${candidates.length} candidate(s) with ${minYears}+ years:\n${lines.join('\n')}`, action: 'search_experience', data: candidates };
}

async function highestAiScore(userId: string): Promise<ChatbotResult> {
  const app = await Application.findOne({ userId, 'matchScore.overall': { $ne: null } })
    .sort({ 'matchScore.overall': -1 }).lean();
  if (!app) return { reply: 'No screened applications with an AI score yet.', action: 'highest_score' };

  const candidate = await Candidate.findById((app as any).candidateId).lean();
  const job = await Job.findById((app as any).jobId).lean();
  return {
    reply: `${(candidate as any)?.name ?? 'Unknown'} has the highest AI match score: ${(app as any).matchScore.overall}% for ${(job as any)?.title ?? 'a role'}.`,
    action: 'highest_score',
    data: app,
  };
}

async function listRejected(userId: string): Promise<ChatbotResult> {
  const apps = await Application.find({ userId, stage: 'rejected' }).sort({ updatedAt: -1 }).limit(10).lean();
  if (apps.length === 0) return { reply: 'No rejected candidates on record.', action: 'list_rejected', data: [] };
  const candidates = await Candidate.find({ _id: { $in: apps.map((a: any) => a.candidateId) } }).lean();
  const candidateById = new Map(candidates.map((c: any) => [String(c._id), c]));
  const lines = apps.map((a: any) => `• ${candidateById.get(String(a.candidateId))?.name ?? 'Unknown'}`);
  return { reply: `${apps.length} rejected candidate(s):\n${lines.join('\n')}`, action: 'list_rejected', data: apps };
}

async function generateOfferForName(userId: string, name: string): Promise<ChatbotResult> {
  const candidate = await Candidate.findOne({ userId, name: { $regex: name, $options: 'i' } }).lean();
  if (!candidate) return { reply: `I couldn't find a candidate named "${name}".`, action: 'generate_offer' };

  const app = await Application.findOne({ userId, candidateId: (candidate as any)._id }).sort({ updatedAt: -1 }).lean();
  const job = app ? await Job.findById((app as any).jobId).lean() : null;

  const letter = generateOfferLetter({
    candidateName: (candidate as any).name,
    jobTitle: (job as any)?.title ?? 'the role',
    department: (job as any)?.department ?? 'the team',
    salaryMin: (job as any)?.salaryMin ?? null,
    salaryMax: (job as any)?.salaryMax ?? null,
    salaryCurrency: (job as any)?.salaryCurrency ?? 'USD',
  });

  return { reply: letter, action: 'generate_offer', data: { candidateId: (candidate as any)._id, applicationId: (app as any)?._id } };
}

async function generateQuestionsFor(userId: string, name: string): Promise<ChatbotResult> {
  const job = await Job.findOne({ userId, title: { $regex: name, $options: 'i' } }).lean();
  const candidate = await Candidate.findOne({ userId, name: { $regex: name, $options: 'i' } }).lean();

  const targetJob = job ?? (await Job.findOne({ userId }).sort({ createdAt: -1 }).lean());
  if (!targetJob) return { reply: 'No jobs found to generate questions for. Create a job first.', action: 'generate_questions' };

  const questions = generateInterviewQuestions(targetJob as any, candidate as any ?? undefined);
  const lines = questions.map((q) => `[${q.category}] ${q.question}`);
  return { reply: `Interview questions for ${(targetJob as any).title}:\n${lines.join('\n')}`, action: 'generate_questions', data: questions };
}

async function scheduleInterviewFor(userId: string, name: string): Promise<ChatbotResult> {
  const candidate = await Candidate.findOne({ userId, name: { $regex: name, $options: 'i' } }).lean();
  if (!candidate) return { reply: `I couldn't find a candidate named "${name}" to schedule.`, action: 'schedule_interview' };

  const app = await Application.findOne({ userId, candidateId: (candidate as any)._id }).sort({ updatedAt: -1 }).lean();
  if (!app) return { reply: `${(candidate as any).name} has no active application to schedule an interview for.`, action: 'schedule_interview' };

  const stage = ['hr_interview', 'technical_interview', 'final_interview'].includes((app as any).stage)
    ? (app as any).stage
    : 'hr_interview';

  const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const session = await InterviewSession.create({
    userId, applicationId: (app as any)._id, stage, scheduledAt, status: 'scheduled',
  });

  await Notification.create({
    userId,
    type: 'info',
    title: 'Interview Reminder',
    message: `Interview with ${(candidate as any).name} scheduled for ${scheduledAt.toLocaleString()}.`,
  });

  return {
    reply: `Interview scheduled for ${(candidate as any).name} tomorrow at ${scheduledAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
    action: 'schedule_interview',
    data: session,
  };
}

async function summarizeToday(userId: string): Promise<ChatbotResult> {
  const range = { $gte: startOfToday(), $lte: endOfToday() };
  const [newApplications, interviewsToday, offersSent, joined] = await Promise.all([
    Application.countDocuments({ userId, createdAt: range }),
    InterviewSession.countDocuments({ userId, scheduledAt: range }),
    Application.countDocuments({ userId, stage: 'offer', updatedAt: range }),
    Application.countDocuments({ userId, stage: 'joined', updatedAt: range }),
  ]);

  return {
    reply: `Today's recruitment activity: ${newApplications} new application(s), ${interviewsToday} interview(s), ${offersSent} offer(s) sent, ${joined} candidate(s) joined.`,
    action: 'summarize_today',
    data: { newApplications, interviewsToday, offersSent, joined },
  };
}

const HELP_REPLY = `I can help with:
• "Show today's interviews"
• "Show pending candidates"
• "Find React developers" / "Search candidate by skill React"
• "Who has highest AI score?"
• "Generate offer letter for <name>"
• "Generate interview questions for <job or name>"
• "Schedule interview for <name>"
• "Show rejected candidates"
• "Search candidate by experience 5"
• "Summarize today's recruitment activity"`;

export async function handleChatbotMessage(userId: string, rawMessage: string): Promise<ChatbotResult> {
  await connectToDatabase();
  const message = rawMessage.trim();
  const lower = message.toLowerCase();

  if (/today.*interview|interview.*today/.test(lower)) return listTodaysInterviews(userId);
  if (/pending candidate/.test(lower)) return listPendingCandidates(userId);
  if (/highest.*(ai )?score|top.*candidate/.test(lower)) return highestAiScore(userId);
  if (/rejected candidate/.test(lower)) return listRejected(userId);
  if (/summari[sz]e.*today|today.*(summary|activity)/.test(lower)) return summarizeToday(userId);

  let m = message.match(/generate offer letter(?:\s+for)?\s*(.+)?/i);
  if (m) return generateOfferForName(userId, (m[1] ?? '').trim() || message);

  m = message.match(/generate interview questions?(?:\s+for)?\s*(.+)?/i);
  if (m) return generateQuestionsFor(userId, (m[1] ?? '').trim());

  m = message.match(/schedule (?:an? )?interview(?:\s+for)?\s*(.+)?/i);
  if (m) return scheduleInterviewFor(userId, (m[1] ?? '').trim());

  m = message.match(/find\s+(.+?)\s+developers?/i);
  if (m) return findCandidatesBySkill(userId, m[1].trim());

  m = message.match(/search candidates?\s*(?:by)?\s*skill\s*[:\-]?\s*(.+)/i);
  if (m) return findCandidatesBySkill(userId, m[1].trim());

  m = message.match(/search candidates?\s*(?:by)?\s*experience\s*[:\-]?\s*(\d+)/i);
  if (m) return findCandidatesByExperience(userId, Number(m[1]));

  m = message.match(/(\d+)\+?\s*years?.*experience/i);
  if (m) return findCandidatesByExperience(userId, Number(m[1]));

  return { reply: HELP_REPLY, action: 'help' };
}
