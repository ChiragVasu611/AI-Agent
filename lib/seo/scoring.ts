import type { AuditFinding } from './audit-engine';

const SEVERITY_WEIGHT: Record<AuditFinding['severity'], number> = { critical: 4, high: 3, medium: 2, low: 1 };
const STATUS_CREDIT: Record<AuditFinding['status'], number> = { pass: 1, warn: 0.5, fail: 0 };

export function scoreFindings(findings: AuditFinding[]): number {
  if (findings.length === 0) return 100;
  let earned = 0;
  let total = 0;
  for (const f of findings) {
    const weight = SEVERITY_WEIGHT[f.severity];
    earned += weight * STATUS_CREDIT[f.status];
    total += weight;
  }
  return total === 0 ? 100 : Math.round((earned / total) * 100);
}

export function scoreByCategory(findings: AuditFinding[], category: string): number | null {
  const subset = findings.filter((f) => f.category === category);
  if (subset.length === 0) return null;
  return scoreFindings(subset);
}

export interface WebsiteScoreBreakdown {
  seoScore: number;
  technicalScore: number | null;
  contentScore: number | null;
  accessibilityScore: number | null;
  performanceScore: number | null;
  metadataScore: number | null;
  mobileScore: number | null;
  uxScore: number | null;
}

export function computeWebsiteScores(findings: AuditFinding[]): WebsiteScoreBreakdown {
  const technicalScore = scoreByCategory(findings, 'Technical');
  const contentScore = scoreByCategory(findings, 'Content Structure') ?? scoreByCategory(findings, 'Content');
  const accessibilityScore = scoreByCategory(findings, 'Accessibility');
  const performanceScore = scoreByCategory(findings, 'Performance');
  const metadataScore = scoreByCategory(findings, 'Metadata');
  const mobileScore = scoreByCategory(findings, 'Mobile');
  const linksScore = scoreByCategory(findings, 'Links');

  const uxInputs = [accessibilityScore, mobileScore, linksScore].filter((s): s is number => s != null);
  const uxScore = uxInputs.length > 0 ? Math.round(uxInputs.reduce((a, b) => a + b, 0) / uxInputs.length) : null;

  return {
    seoScore: scoreFindings(findings),
    technicalScore, contentScore, accessibilityScore, performanceScore, metadataScore, mobileScore, uxScore,
  };
}

export function computeAsoScore(findings: AuditFinding[]): number {
  return scoreFindings(findings);
}
