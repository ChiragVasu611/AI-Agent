import type { AuditFinding } from './audit-engine';

/**
 * Real deterministic content-quality analysis — readability, keyword usage,
 * heading/CTA presence, and duplicate-content detection against sibling
 * content pieces in the same project. No external API required.
 */

const CTA_PHRASES = [
  'get started', 'sign up', 'try free', 'try it free', 'book a demo', 'learn more',
  'download now', 'contact us', 'buy now', 'shop now', 'start your trial', 'subscribe',
  'join now', 'get a quote', 'schedule a call', 'request a demo',
];

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are',
  'was', 'were', 'be', 'this', 'that', 'it', 'as', 'at', 'by', 'from', 'your', 'you', 'we',
]);

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  const matches = w.match(/[aeiouy]+/g);
  let count = matches ? matches.length : 1;
  if (w.endsWith('e') && count > 1) count -= 1;
  return Math.max(1, count);
}

/** Flesch Reading Ease approximation — no external NLP library required. */
function readabilityScore(text: string): number {
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  const words = text.split(/\s+/).map((w) => w.trim()).filter(Boolean);
  if (sentences.length === 0 || words.length === 0) return 0;
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const score = 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syllables / words.length);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function readabilityLabel(score: number): string {
  if (score >= 70) return 'Easy to read';
  if (score >= 50) return 'Moderately readable';
  if (score >= 30) return 'Fairly difficult';
  return 'Very difficult';
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !STOPWORDS.has(w)));
  const setB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !STOPWORDS.has(w)));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  setA.forEach((w) => { if (setB.has(w)) intersection += 1; });
  const union = new Set(Array.from(setA).concat(Array.from(setB))).size;
  return union === 0 ? 0 : intersection / union;
}

export interface ContentReviewResult {
  score: number;
  findings: AuditFinding[];
}

export function reviewContent(
  body: string,
  focusKeywords: string[],
  siblingContents: Array<{ id: string; body: string }>,
): ContentReviewResult {
  const findings: AuditFinding[] = [];
  const wordCount = body.split(/\s+/).filter(Boolean).length;

  // --- Readability ---
  const flesch = readabilityScore(body);
  findings.push({
    category: 'Readability', item: 'Reading ease', status: flesch >= 50 ? 'pass' : flesch >= 30 ? 'warn' : 'fail',
    severity: flesch >= 50 ? 'low' : flesch >= 30 ? 'medium' : 'high',
    detail: `Flesch reading-ease score: ${flesch}/100 (${readabilityLabel(flesch)}). Based on ${wordCount} word(s).`,
    recommendation: flesch >= 50 ? '' : 'Shorten sentences and prefer simpler, shorter words to improve readability.',
  });

  // --- Length ---
  if (wordCount < 10) {
    findings.push({ category: 'Structure', item: 'Content length', status: 'warn', severity: 'medium', detail: `Only ${wordCount} word(s).`, recommendation: 'Expand this content — very short copy gives search engines and readers little to work with.' });
  } else {
    findings.push({ category: 'Structure', item: 'Content length', status: 'pass', severity: 'low', detail: `${wordCount} word(s).`, recommendation: '' });
  }

  // --- Keyword usage ---
  const lower = body.toLowerCase();
  const cleanKeywords = focusKeywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (cleanKeywords.length > 0) {
    const used = cleanKeywords.filter((k) => lower.includes(k));
    const missing = cleanKeywords.filter((k) => !lower.includes(k));
    if (missing.length === 0) {
      findings.push({ category: 'Keyword Usage', item: 'Focus keyword coverage', status: 'pass', severity: 'low', detail: `All ${cleanKeywords.length} focus keyword(s) appear in this content.`, recommendation: '' });
    } else {
      findings.push({ category: 'Keyword Usage', item: 'Focus keyword coverage', status: used.length > 0 ? 'warn' : 'fail', severity: used.length > 0 ? 'medium' : 'high', detail: `${missing.length} of ${cleanKeywords.length} focus keyword(s) missing: ${missing.join(', ')}.`, recommendation: 'Naturally include the missing focus keywords at least once.' });
    }

    // Keyword stuffing check — a single keyword shouldn't dominate the text.
    const topKeyword = cleanKeywords[0];
    if (topKeyword && wordCount > 0) {
      const occurrences = lower.split(topKeyword).length - 1;
      const density = occurrences / wordCount;
      if (density > 0.06) {
        findings.push({ category: 'Keyword Usage', item: 'Keyword density', status: 'warn', severity: 'medium', detail: `"${topKeyword}" appears ${occurrences} time(s) — ${(density * 100).toFixed(1)}% density.`, recommendation: 'Reduce repetition of the same keyword; aim for natural, varied phrasing (under ~3-4% density).' });
      }
    }
  }

  // --- Heading quality (markdown-style or a distinct short first line) ---
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const hasMarkdownHeading = lines.some((l) => /^#{1,3}\s+\S/.test(l));
  const firstLineIsHeadingLike = lines.length > 1 && lines[0].length > 0 && lines[0].length <= 70 && !/[.!?]$/.test(lines[0]);
  if (hasMarkdownHeading || firstLineIsHeadingLike) {
    findings.push({ category: 'Structure', item: 'Heading quality', status: 'pass', severity: 'low', detail: 'A clear heading/title line was detected.', recommendation: '' });
  } else if (wordCount >= 40) {
    findings.push({ category: 'Structure', item: 'Heading quality', status: 'warn', severity: 'low', detail: 'No clear heading line detected in longer content.', recommendation: 'Lead with a short, distinct heading or headline before the body copy.' });
  }

  // --- Call-to-action ---
  const hasCta = CTA_PHRASES.some((p) => lower.includes(p));
  findings.push({
    category: 'Conversion', item: 'Call-to-action', status: hasCta ? 'pass' : 'warn', severity: hasCta ? 'low' : 'medium',
    detail: hasCta ? 'A call-to-action phrase was detected.' : 'No clear call-to-action phrase detected.',
    recommendation: hasCta ? '' : 'Add a direct call-to-action (e.g. "Get Started", "Try Free") to guide the reader toward the next step.',
  });

  // --- Grammar heuristics (lightweight, no external NLP) ---
  const doubleSpaces = (body.match(/ {2,}/g) ?? []).length;
  const repeatedWords = (body.match(/\b(\w+)\s+\1\b/gi) ?? []).length;
  if (doubleSpaces > 0 || repeatedWords > 0) {
    findings.push({ category: 'Grammar', item: 'Basic grammar check', status: 'warn', severity: 'low', detail: `${repeatedWords} repeated word pair(s), ${doubleSpaces} double-space run(s) found.`, recommendation: 'Proofread for accidental repeated words and extra whitespace.' });
  } else {
    findings.push({ category: 'Grammar', item: 'Basic grammar check', status: 'pass', severity: 'low', detail: 'No repeated words or stray double-spaces detected.', recommendation: '' });
  }

  // --- Duplicate content vs sibling content in the same project ---
  let maxSimilarity = 0;
  let mostSimilarId: string | null = null;
  for (const sibling of siblingContents) {
    const sim = jaccardSimilarity(body, sibling.body);
    if (sim > maxSimilarity) { maxSimilarity = sim; mostSimilarId = sibling.id; }
  }
  if (mostSimilarId && maxSimilarity >= 0.6) {
    findings.push({ category: 'Duplicate Content', item: 'Similarity to other content', status: 'fail', severity: 'high', detail: `${Math.round(maxSimilarity * 100)}% word-overlap with another content piece in this project.`, recommendation: 'Differentiate this content — rework the wording so it is not near-duplicate of other generated assets.' });
  } else if (mostSimilarId && maxSimilarity >= 0.35) {
    findings.push({ category: 'Duplicate Content', item: 'Similarity to other content', status: 'warn', severity: 'low', detail: `${Math.round(maxSimilarity * 100)}% word-overlap with another content piece in this project.`, recommendation: 'Some overlap with existing content — consider varying phrasing further.' });
  } else {
    findings.push({ category: 'Duplicate Content', item: 'Similarity to other content', status: 'pass', severity: 'low', detail: siblingContents.length > 0 ? 'No significant overlap with other content in this project.' : 'No other content to compare against yet.', recommendation: '' });
  }

  const weight = (f: AuditFinding) => (f.severity === 'critical' ? 4 : f.severity === 'high' ? 3 : f.severity === 'medium' ? 2 : 1);
  const credit = (f: AuditFinding) => (f.status === 'pass' ? 1 : f.status === 'warn' ? 0.5 : 0);
  const totalWeight = findings.reduce((sum, f) => sum + weight(f), 0);
  const earned = findings.reduce((sum, f) => sum + weight(f) * credit(f), 0);
  const score = totalWeight === 0 ? 100 : Math.round((earned / totalWeight) * 100);

  return { score, findings };
}
