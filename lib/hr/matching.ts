/** Rule-based candidate <-> job matching. No external AI API involved. */
import type {
  AIInsights, ApplicationFlags, Candidate, Job, MatchScore, Recommendation,
} from '@/lib/types';

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function skillOverlap(candidateSkills: string[], targetSkills: string[]) {
  const candSet = new Set(candidateSkills.map(norm));
  const matched = targetSkills.filter((s) => candSet.has(norm(s)));
  const missing = targetSkills.filter((s) => !candSet.has(norm(s)));
  return { matched, missing };
}

function scoreSkills(candidate: Pick<Candidate, 'skills'>, job: Pick<Job, 'requiredSkills' | 'preferredSkills'>) {
  const required = skillOverlap(candidate.skills, job.requiredSkills);
  const preferred = skillOverlap(candidate.skills, job.preferredSkills);

  const requiredScore = job.requiredSkills.length > 0
    ? (required.matched.length / job.requiredSkills.length) * 100
    : 100;
  const preferredBonus = job.preferredSkills.length > 0
    ? (preferred.matched.length / job.preferredSkills.length) * 10
    : 0;

  return {
    score: Math.min(100, Math.round(requiredScore * 0.9 + preferredBonus)),
    requiredMatched: required.matched,
    requiredMissing: required.missing,
    preferredMatched: preferred.matched,
    preferredMissing: preferred.missing,
  };
}

function scoreExperience(candidateYears: number, minYears: number, maxYears: number) {
  if (maxYears <= 0 && minYears <= 0) return 100;
  if (candidateYears >= minYears && candidateYears <= (maxYears || minYears + 5)) return 100;
  if (candidateYears < minYears) {
    const deficit = minYears - candidateYears;
    return Math.max(0, Math.round(100 - deficit * 20));
  }
  const excess = candidateYears - (maxYears || minYears);
  return Math.max(40, Math.round(100 - excess * 8));
}

function scoreEducation(candidate: Pick<Candidate, 'education'>, job: Pick<Job, 'qualifications'>) {
  if (!job.qualifications) return 80;
  const qualLower = job.qualifications.toLowerCase();
  const candidateDegrees = candidate.education.map((e) => (e.degree ?? '').toLowerCase());
  if (candidateDegrees.length === 0) return 50;
  const mentioned = candidateDegrees.some((d) => d && qualLower.includes(d));
  return mentioned ? 100 : 70;
}

function scoreCertification(candidate: Pick<Candidate, 'certifications'>, job: Pick<Job, 'preferredSkills' | 'qualifications'>) {
  if (candidate.certifications.length === 0) return job.preferredSkills.length > 0 ? 40 : 70;
  const text = `${job.qualifications} ${job.preferredSkills.join(' ')}`.toLowerCase();
  const relevant = candidate.certifications.filter((c) => text.includes(norm(c).split(' ')[0]));
  return relevant.length > 0 ? 100 : 75;
}

function scoreCommunication(resumeText: string) {
  if (!resumeText) return 60;
  const words = resumeText.split(/\s+/).filter(Boolean);
  const bulletCount = (resumeText.match(/\n\s*[-•*]/g) ?? []).length;
  const actionVerbs = ['led', 'built', 'developed', 'managed', 'designed', 'implemented', 'improved', 'launched', 'created', 'delivered'];
  const verbHits = actionVerbs.filter((v) => new RegExp(`\\b${v}\\b`, 'i').test(resumeText)).length;
  let score = 70;
  if (words.length > 150) score += 5;
  if (bulletCount >= 3) score += 10;
  score += Math.min(15, verbHits * 3);
  return Math.min(97, Math.max(50, score));
}

function detectEmploymentGap(candidate: Pick<Candidate, 'experience'>): boolean {
  const withYears = candidate.experience
    .map((e) => ({
      start: Number((e.startDate ?? '').match(/\d{4}/)?.[0]),
      end: /present|current/i.test(e.endDate ?? '') ? new Date().getFullYear() : Number((e.endDate ?? '').match(/\d{4}/)?.[0]),
    }))
    .filter((e) => Number.isFinite(e.start) && Number.isFinite(e.end))
    .sort((a, b) => a.start - b.start);

  // Dates are parsed at year granularity, so a same-year-boundary transition (e.g.
  // Dec 2019 -> Jan 2020) always shows a nominal 1-year diff. Require >= 2 to avoid
  // flagging normal back-to-back jobs as an employment gap.
  for (let i = 1; i < withYears.length; i++) {
    if (withYears[i].start - withYears[i - 1].end >= 2) return true;
  }
  return false;
}

function detectOverlappingExperience(candidate: Pick<Candidate, 'experience'>): boolean {
  const ranges = candidate.experience
    .map((e) => ({
      start: Number((e.startDate ?? '').match(/\d{4}/)?.[0]),
      end: /present|current/i.test(e.endDate ?? '') ? new Date().getFullYear() : Number((e.endDate ?? '').match(/\d{4}/)?.[0]),
      company: e.company,
    }))
    .filter((e) => Number.isFinite(e.start) && Number.isFinite(e.end));

  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      if (ranges[i].company === ranges[j].company) continue;
      const overlap = ranges[i].start < ranges[j].end && ranges[j].start < ranges[i].end;
      if (overlap) return true;
    }
  }
  return false;
}

export function recommendationForScore(overall: number): Recommendation {
  if (overall >= 85) return 'strong_hire';
  if (overall >= 70) return 'hire';
  if (overall >= 50) return 'consider';
  return 'reject';
}

export interface MatchResult {
  matchScore: MatchScore;
  aiInsights: AIInsights;
  flags: ApplicationFlags;
  recommendation: Recommendation;
}

export function computeMatch(
  candidate: Pick<Candidate, 'skills' | 'education' | 'certifications' | 'experience' | 'totalExperienceYears' | 'resumeText'>,
  job: Pick<Job, 'requiredSkills' | 'preferredSkills' | 'qualifications' | 'experienceMinYears' | 'experienceMaxYears'>,
  opts: { isDuplicate?: boolean } = {},
): MatchResult {
  const skills = scoreSkills(candidate, job);
  const experience = scoreExperience(candidate.totalExperienceYears, job.experienceMinYears, job.experienceMaxYears);
  const education = scoreEducation(candidate, job);
  const certification = scoreCertification(candidate, job);
  const communication = scoreCommunication(candidate.resumeText);

  const overall = Math.round(
    skills.score * 0.4 + experience * 0.25 + education * 0.15 + certification * 0.1 + communication * 0.1,
  );

  const matchScore: MatchScore = {
    overall, skills: skills.score, experience, education, certification, communication,
  };

  const aiInsights: AIInsights = {
    strengths: skills.requiredMatched.slice(0, 6),
    weaknesses: skills.requiredMissing.slice(0, 6),
    missingSkills: skills.requiredMissing,
    recommendedSkills: skills.preferredMissing.slice(0, 6),
  };

  const flags: ApplicationFlags = {
    duplicateResume: opts.isDuplicate ?? false,
    fakeExperienceSuspected: detectOverlappingExperience(candidate),
    employmentGap: detectEmploymentGap(candidate),
    skillMismatch: skills.score < 40,
    overqualified: job.experienceMaxYears > 0 && candidate.totalExperienceYears > job.experienceMaxYears + 3,
    underqualified: candidate.totalExperienceYears < job.experienceMinYears,
  };

  return { matchScore, aiInsights, flags, recommendation: recommendationForScore(overall) };
}
