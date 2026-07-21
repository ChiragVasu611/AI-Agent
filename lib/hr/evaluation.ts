/** Rule-based interview evaluation & summary generation. No external AI API. */
import type { InterviewRatings, InterviewRecommendation } from '@/lib/types';

export function computeOverallScore(ratings: InterviewRatings): number {
  const values = Object.values(ratings);
  if (values.length === 0) return 0;
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.round(avg * 10) / 10;
}

export function recommendationForInterview(overallScore: number): InterviewRecommendation {
  if (overallScore >= 8.5) return 'strong_hire';
  if (overallScore >= 7) return 'hire';
  if (overallScore >= 5) return 'hold';
  return 'reject';
}

const DIMENSION_LABEL: Record<keyof InterviewRatings, string> = {
  technicalKnowledge: 'technical knowledge',
  communication: 'communication',
  problemSolving: 'problem-solving',
  leadership: 'leadership',
  confidence: 'confidence',
  cultureFit: 'culture fit',
  learningAbility: 'learning ability',
};

export function generateInterviewSummary(
  candidateName: string,
  jobTitle: string,
  ratings: InterviewRatings,
  overallScore: number,
  recommendation: InterviewRecommendation,
  liveNotes: string,
): string {
  const entries = Object.entries(ratings) as [keyof InterviewRatings, number][];
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  const strengths = sorted.filter(([, v]) => v >= 7).slice(0, 3).map(([k]) => DIMENSION_LABEL[k]);
  const weaknesses = sorted.filter(([, v]) => v > 0 && v < 6).slice(-3).map(([k]) => DIMENSION_LABEL[k]);

  const recLabel: Record<string, string> = {
    strong_hire: 'a Strong Hire',
    hire: 'a Hire',
    hold: 'a Hold — a further round is recommended',
    reject: 'not a fit for this role',
  };

  const parts: string[] = [];
  parts.push(`${candidateName} interviewed for the ${jobTitle} role with an overall score of ${overallScore}/10.`);
  if (strengths.length > 0) {
    parts.push(`They demonstrated strong ${strengths.join(', ')}.`);
  }
  if (weaknesses.length > 0) {
    parts.push(`Areas for improvement include ${weaknesses.join(', ')}.`);
  }
  if (liveNotes.trim()) {
    parts.push(`Interviewer notes: ${liveNotes.trim().slice(0, 300)}`);
  }
  parts.push(`Recommendation: ${recLabel[recommendation ?? 'hold']}.`);

  return parts.join(' ');
}
