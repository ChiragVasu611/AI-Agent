import type { AuditFinding } from './audit-engine';

export interface AsoInput {
  appName: string;
  shortDescription: string;
  longDescription: string;
  keywords: string;
  screenshotCount: number;
  hasIcon: boolean;
  hasFeatureGraphic: boolean;
  category: string;
  releaseNotes: string;
}

export function runAsoAnalysis(input: AsoInput): { findings: AuditFinding[] } {
  const findings: AuditFinding[] = [];

  // App name
  if (!input.appName) {
    findings.push({ category: 'Metadata', item: 'App name', status: 'fail', severity: 'critical', detail: 'No app name provided.', recommendation: 'Provide a clear, keyword-relevant app name (max 30 characters on most stores).' });
  } else if (input.appName.length > 30) {
    findings.push({ category: 'Metadata', item: 'App name', status: 'warn', severity: 'medium', detail: `App name is ${input.appName.length} characters.`, recommendation: 'Keep the app name under 30 characters to avoid truncation on most stores.' });
  } else {
    findings.push({ category: 'Metadata', item: 'App name', status: 'pass', severity: 'low', detail: `"${input.appName}" (${input.appName.length} chars).`, recommendation: '' });
  }

  // Short description
  if (!input.shortDescription) {
    findings.push({ category: 'Metadata', item: 'Short description', status: 'fail', severity: 'high', detail: 'No short description provided.', recommendation: 'Add a compelling short description (max 80 characters on Play Store) leading with your primary keyword.' });
  } else if (input.shortDescription.length > 80) {
    findings.push({ category: 'Metadata', item: 'Short description', status: 'warn', severity: 'medium', detail: `Short description is ${input.shortDescription.length} characters.`, recommendation: 'Keep under 80 characters for Play Store; it is truncated beyond that.' });
  } else {
    findings.push({ category: 'Metadata', item: 'Short description', status: 'pass', severity: 'low', detail: `${input.shortDescription.length} characters.`, recommendation: '' });
  }

  // Long description
  const keywordList = input.keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (!input.longDescription) {
    findings.push({ category: 'Content', item: 'Long description', status: 'fail', severity: 'high', detail: 'No long description provided.', recommendation: 'Write a detailed long description (up to 4000 characters) covering features and benefits.' });
  } else {
    const lower = input.longDescription.toLowerCase();
    const missingKeywords = keywordList.filter((k) => k && !lower.includes(k));
    if (keywordList.length > 0 && missingKeywords.length > 0) {
      findings.push({ category: 'Content', item: 'Keyword usage in description', status: 'warn', severity: 'medium', detail: `${missingKeywords.length} of ${keywordList.length} target keyword(s) not found in the long description: ${missingKeywords.join(', ')}.`, recommendation: 'Naturally weave every target keyword into the long description at least once.' });
    } else if (keywordList.length > 0) {
      findings.push({ category: 'Content', item: 'Keyword usage in description', status: 'pass', severity: 'low', detail: 'All target keywords appear in the long description.', recommendation: '' });
    }
    if (input.longDescription.length < 300) {
      findings.push({ category: 'Content', item: 'Long description length', status: 'warn', severity: 'low', detail: `Only ${input.longDescription.length} characters.`, recommendation: 'Expand the description to at least 300-500 characters to cover more feature/keyword ground.' });
    } else {
      findings.push({ category: 'Content', item: 'Long description length', status: 'pass', severity: 'low', detail: `${input.longDescription.length} characters.`, recommendation: '' });
    }
  }

  // Keywords field
  if (keywordList.length === 0) {
    findings.push({ category: 'Metadata', item: 'Keywords field', status: 'fail', severity: 'high', detail: 'No keywords provided.', recommendation: 'Add a focused keyword list (iOS keyword field, or naturally in Play Store description).' });
  } else if (keywordList.length < 3) {
    findings.push({ category: 'Metadata', item: 'Keywords field', status: 'warn', severity: 'medium', detail: `Only ${keywordList.length} keyword(s) provided.`, recommendation: 'Provide at least 5-10 relevant keywords/phrases.' });
  } else {
    findings.push({ category: 'Metadata', item: 'Keywords field', status: 'pass', severity: 'low', detail: `${keywordList.length} keyword(s) provided.`, recommendation: '' });
  }

  // Screenshots
  if (input.screenshotCount === 0) {
    findings.push({ category: 'Visual Assets', item: 'Screenshots', status: 'fail', severity: 'critical', detail: 'No screenshots uploaded.', recommendation: 'Upload at least 4-8 screenshots showcasing your core value proposition first.' });
  } else if (input.screenshotCount < 4) {
    findings.push({ category: 'Visual Assets', item: 'Screenshots', status: 'warn', severity: 'medium', detail: `Only ${input.screenshotCount} screenshot(s).`, recommendation: 'Most top apps use 4-8 screenshots to tell a complete story.' });
  } else {
    findings.push({ category: 'Visual Assets', item: 'Screenshots', status: 'pass', severity: 'low', detail: `${input.screenshotCount} screenshot(s) uploaded.`, recommendation: '' });
  }

  // Icon
  findings.push({
    category: 'Visual Assets', item: 'App icon', status: input.hasIcon ? 'pass' : 'fail', severity: input.hasIcon ? 'low' : 'critical',
    detail: input.hasIcon ? 'App icon uploaded.' : 'No app icon uploaded.',
    recommendation: input.hasIcon ? '' : 'Upload a distinctive, scalable app icon — this is one of the highest-impact ASO assets.',
  });

  // Feature graphic (Play Store)
  findings.push({
    category: 'Visual Assets', item: 'Feature graphic', status: input.hasFeatureGraphic ? 'pass' : 'warn', severity: input.hasFeatureGraphic ? 'low' : 'medium',
    detail: input.hasFeatureGraphic ? 'Feature graphic uploaded.' : 'No feature graphic uploaded.',
    recommendation: input.hasFeatureGraphic ? '' : 'Add a 1024x500 feature graphic for Play Store promotional placements.',
  });

  // Category
  findings.push({
    category: 'Metadata', item: 'Category', status: input.category ? 'pass' : 'fail', severity: input.category ? 'low' : 'high',
    detail: input.category ? `Category: ${input.category}` : 'No category selected.',
    recommendation: input.category ? '' : 'Select the most relevant category to maximize category-browse discoverability.',
  });

  // Release notes
  if (!input.releaseNotes) {
    findings.push({ category: 'Content', item: 'Release notes', status: 'warn', severity: 'low', detail: 'No release notes provided.', recommendation: 'Write release notes for every update — stores factor recency/quality signals into ranking.' });
  } else {
    findings.push({ category: 'Content', item: 'Release notes', status: 'pass', severity: 'low', detail: `${input.releaseNotes.length} characters.`, recommendation: '' });
  }

  return { findings };
}
