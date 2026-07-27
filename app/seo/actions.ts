'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/permissions';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { SeoProject } from '@/lib/mongodb/models/SeoProject';
import { SeoAudit } from '@/lib/mongodb/models/SeoAudit';
import { SeoKeyword } from '@/lib/mongodb/models/SeoKeyword';
import { SeoTask } from '@/lib/mongodb/models/SeoTask';
import { SeoContent } from '@/lib/mongodb/models/SeoContent';
import { SeoCompetitor } from '@/lib/mongodb/models/SeoCompetitor';
import { User } from '@/lib/mongodb/models/User';
import { ActivityLog } from '@/lib/mongodb/models/ActivityLog';
import { Notification } from '@/lib/mongodb/models/Notification';
import { runProjectAnalysis } from '@/lib/seo/analysis';
import { runWebsiteAudit } from '@/lib/seo/audit-engine';
import { runAsoAnalysis as analyzeAso, type AsoInput } from '@/lib/seo/aso-engine';
import { computeWebsiteScores, computeAsoScore } from '@/lib/seo/scoring';
import { generateKeywords } from '@/lib/seo/keyword-engine';
import { generateContent, type ContentType } from '@/lib/seo/content-engine';
import { buildTasksFromFindings } from '@/lib/seo/growth-coach';
import { reviewContent } from '@/lib/seo/content-review';
import type { SeoProjectType } from '@/lib/types';

import type { SessionUser } from '@/lib/auth/session';

type Guard = { ok: false; error: string } | { ok: true; user: SessionUser };

async function requireSeoAccess(): Promise<Guard> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!hasPermission(user.permissions, 'workspace:seo')) {
    return { ok: false, error: 'Forbidden: your role does not have workspace:seo permission.' };
  }
  return { ok: true, user };
}

async function notify(userId: string, type: string, title: string, message: string, settingKey?: string) {
  if (settingKey) {
    const u = await User.findById(userId).lean<{ seoSettings?: Record<string, boolean> }>();
    if (u?.seoSettings && u.seoSettings[settingKey] === false) return;
  }
  await Notification.create({ userId, type, title, message });
}

function parseList(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export async function createSeoProject(formData: FormData) {
  const guard = await requireSeoAccess();
  if (!guard.ok) return { error: guard.error };
  await connectToDatabase();

  const name = String(formData.get('name') ?? '').trim();
  const projectType = String(formData.get('projectType') ?? 'website') as SeoProjectType;
  if (!name) return { error: 'Project name is required.' };

  const input = {
    name,
    companyName: String(formData.get('companyName') ?? '').trim(),
    projectType,
    businessCategory: String(formData.get('businessCategory') ?? '').trim(),
    industry: String(formData.get('industry') ?? '').trim(),
    targetAudience: String(formData.get('targetAudience') ?? '').trim(),
    targetCountry: String(formData.get('targetCountry') ?? 'United States').trim(),
    language: String(formData.get('language') ?? 'English').trim(),
    focusKeywords: parseList(formData.get('focusKeywords')),
    websiteUrl: String(formData.get('websiteUrl') ?? '').trim() || null,
    playStoreUrl: String(formData.get('playStoreUrl') ?? '').trim() || null,
    appStoreUrl: String(formData.get('appStoreUrl') ?? '').trim() || null,
  };

  const dbUser = await User.findById(guard.user.id).lean<{ seoOpenRouterApiKey?: string; seoAiEnabled?: boolean }>();
  const apiKey = dbUser?.seoAiEnabled !== false ? (dbUser?.seoOpenRouterApiKey ?? null) : null;
  const analysis = await runProjectAnalysis(input, apiKey);

  const project = await SeoProject.create({
    userId: guard.user.id,
    ...input,
    competitorNames: parseList(formData.get('competitorNames')),
    businessType: analysis.businessType,
    productType: analysis.productType,
    userIntent: analysis.userIntent,
    targetMarket: analysis.targetMarket,
    businessGoals: analysis.businessGoals,
    conversionGoals: analysis.conversionGoals,
    businessSummary: analysis.businessSummary,
    seoStrategy: analysis.seoStrategy,
    asoStrategy: analysis.asoStrategy,
    growthRoadmap: analysis.growthRoadmap,
    analysisSource: analysis.source,
  });

  await ActivityLog.create({ userId: guard.user.id, action: 'seo.project.created', entity: 'SeoProject', entityId: String(project._id), meta: { name } });
  revalidatePath('/seo');
  revalidatePath('/seo/projects');
  return { ok: true, projectId: String(project._id) };
}

export async function deleteSeoProject(projectId: string) {
  const guard = await requireSeoAccess();
  if (!guard.ok) return { error: guard.error };
  await connectToDatabase();

  const project = await SeoProject.findOne({ _id: projectId, userId: guard.user.id });
  if (!project) return { error: 'Project not found.' };

  await Promise.all([
    SeoProject.deleteOne({ _id: projectId }),
    SeoAudit.deleteMany({ projectId }),
    SeoKeyword.deleteMany({ projectId }),
    SeoTask.deleteMany({ projectId }),
    SeoContent.deleteMany({ projectId }),
    SeoCompetitor.deleteMany({ projectId }),
  ]);

  await ActivityLog.create({ userId: guard.user.id, action: 'seo.project.deleted', entity: 'SeoProject', entityId: projectId, meta: { name: project.name } });
  revalidatePath('/seo');
  revalidatePath('/seo/projects');
  return { ok: true };
}

export async function runProjectWebsiteAudit(projectId: string) {
  const guard = await requireSeoAccess();
  if (!guard.ok) return { error: guard.error };
  await connectToDatabase();

  const project = await SeoProject.findOne({ _id: projectId, userId: guard.user.id });
  if (!project) return { error: 'Project not found.' };
  if (!project.websiteUrl) return { error: 'This project has no website URL configured.' };

  const audit = await SeoAudit.create({ projectId, userId: guard.user.id, type: 'website', target: project.websiteUrl, status: 'running' });

  try {
    const { findings, rawMeta } = await runWebsiteAudit(project.websiteUrl);
    const scores = computeWebsiteScores(findings);
    const counts = findings.reduce(
      (acc, f) => {
        if (f.status === 'pass') acc.passed += 1;
        else acc[f.severity] += 1;
        return acc;
      },
      { critical: 0, high: 0, medium: 0, low: 0, passed: 0 },
    );

    audit.status = 'completed';
    audit.findings = findings;
    audit.counts = counts;
    audit.scoreBreakdown = scores;
    audit.rawMeta = rawMeta;
    audit.completedAt = new Date();
    await audit.save();

    project.seoScore = scores.seoScore;
    project.technicalScore = scores.technicalScore;
    project.contentScore = scores.contentScore;
    project.accessibilityScore = scores.accessibilityScore;
    project.performanceScore = scores.performanceScore;
    project.metadataScore = scores.metadataScore;
    project.mobileScore = scores.mobileScore;
    project.uxScore = scores.uxScore;
    project.lastAuditAt = new Date();
    await project.save();

    const taskDrafts = buildTasksFromFindings(findings, false);
    if (taskDrafts.length > 0) {
      await SeoTask.insertMany(taskDrafts.map((t) => ({ ...t, projectId, userId: guard.user.id })));
    }

    await ActivityLog.create({ userId: guard.user.id, action: 'seo.audit.website_completed', entity: 'SeoProject', entityId: projectId, meta: { seoScore: scores.seoScore, issues: counts } });
    await notify(guard.user.id, 'seo_audit_completed', 'SEO audit completed', `${project.name}: SEO score ${scores.seoScore}/100 (${counts.critical} critical, ${counts.high} high issues).`, 'notifyOnAuditComplete');
    if (counts.critical > 0) {
      await notify(guard.user.id, 'seo_critical_issue', 'Critical SEO issue found', `${project.name} has ${counts.critical} critical issue(s) — review the audit.`, 'notifyOnCriticalIssue');
    }

    revalidatePath(`/seo/projects/${projectId}`);
    revalidatePath('/seo');
    return { ok: true, auditId: String(audit._id) };
  } catch (err: any) {
    audit.status = 'failed';
    audit.errorMessage = err?.message ?? 'Audit failed';
    await audit.save();
    return { error: `Audit failed: ${audit.errorMessage}` };
  }
}

export async function runProjectAsoAudit(projectId: string, formData: FormData) {
  const guard = await requireSeoAccess();
  if (!guard.ok) return { error: guard.error };
  await connectToDatabase();

  const project = await SeoProject.findOne({ _id: projectId, userId: guard.user.id });
  if (!project) return { error: 'Project not found.' };

  const input: AsoInput = {
    appName: String(formData.get('appName') ?? '').trim(),
    shortDescription: String(formData.get('shortDescription') ?? '').trim(),
    longDescription: String(formData.get('longDescription') ?? '').trim(),
    keywords: String(formData.get('keywords') ?? '').trim(),
    screenshotCount: Number(formData.get('screenshotCount') ?? 0) || 0,
    hasIcon: formData.get('hasIcon') === 'on',
    hasFeatureGraphic: formData.get('hasFeatureGraphic') === 'on',
    category: String(formData.get('category') ?? '').trim(),
    releaseNotes: String(formData.get('releaseNotes') ?? '').trim(),
  };

  const { findings } = analyzeAso(input);
  const asoScore = computeAsoScore(findings);
  const counts = findings.reduce(
    (acc, f) => {
      if (f.status === 'pass') acc.passed += 1;
      else acc[f.severity] += 1;
      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0, passed: 0 },
  );

  const audit = await SeoAudit.create({
    projectId, userId: guard.user.id, type: 'aso', target: 'ASO metadata', status: 'completed',
    findings, counts, scoreBreakdown: { asoScore }, rawMeta: input, completedAt: new Date(),
  });

  project.asoScore = asoScore;
  project.lastAuditAt = new Date();
  await project.save();

  const taskDrafts = buildTasksFromFindings(findings, true);
  if (taskDrafts.length > 0) {
    await SeoTask.insertMany(taskDrafts.map((t) => ({ ...t, projectId, userId: guard.user.id })));
  }

  await ActivityLog.create({ userId: guard.user.id, action: 'seo.audit.aso_completed', entity: 'SeoProject', entityId: projectId, meta: { asoScore, issues: counts } });
  await notify(guard.user.id, 'seo_audit_completed', 'ASO audit completed', `${project.name}: ASO score ${asoScore}/100.`, 'notifyOnAuditComplete');
  if (counts.critical > 0) {
    await notify(guard.user.id, 'seo_critical_issue', 'Critical ASO issue found', `${project.name} has ${counts.critical} critical ASO issue(s).`, 'notifyOnCriticalIssue');
  }

  revalidatePath(`/seo/projects/${projectId}`);
  revalidatePath('/seo');
  return { ok: true, auditId: String(audit._id) };
}

export async function generateProjectKeywords(projectId: string) {
  const guard = await requireSeoAccess();
  if (!guard.ok) return { error: guard.error };
  await connectToDatabase();

  const project = await SeoProject.findOne({ _id: projectId, userId: guard.user.id }).lean<any>();
  if (!project) return { error: 'Project not found.' };

  const dbUser = await User.findById(guard.user.id).lean<{ seoOpenRouterApiKey?: string; seoAiEnabled?: boolean }>();
  const apiKey = dbUser?.seoAiEnabled !== false ? (dbUser?.seoOpenRouterApiKey ?? null) : null;

  const { keywords } = await generateKeywords({
    businessCategory: project.businessCategory, industry: project.industry,
    targetAudience: project.targetAudience, targetCountry: project.targetCountry,
    focusKeywords: project.focusKeywords ?? [],
  }, apiKey);

  for (const kw of keywords) {
    await SeoKeyword.findOneAndUpdate(
      { projectId, keyword: kw.keyword },
      { $set: { ...kw, userId: guard.user.id } },
      { upsert: true },
    );
  }

  await ActivityLog.create({ userId: guard.user.id, action: 'seo.keywords.generated', entity: 'SeoProject', entityId: projectId, meta: { count: keywords.length } });
  revalidatePath(`/seo/projects/${projectId}`);
  return { ok: true, count: keywords.length };
}

export async function generateProjectContent(projectId: string, type: ContentType) {
  const guard = await requireSeoAccess();
  if (!guard.ok) return { error: guard.error };
  await connectToDatabase();

  const project = await SeoProject.findOne({ _id: projectId, userId: guard.user.id }).lean<any>();
  if (!project) return { error: 'Project not found.' };

  const dbUser = await User.findById(guard.user.id).lean<{ seoOpenRouterApiKey?: string; seoAiEnabled?: boolean }>();
  const apiKey = dbUser?.seoAiEnabled !== false ? (dbUser?.seoOpenRouterApiKey ?? null) : null;

  const result = await generateContent(type, {
    name: project.name, companyName: project.companyName, businessCategory: project.businessCategory,
    industry: project.industry, targetAudience: project.targetAudience, targetCountry: project.targetCountry,
    focusKeywords: project.focusKeywords ?? [],
  }, apiKey);

  const doc = await SeoContent.create({ projectId, userId: guard.user.id, type, title: result.title, body: result.body, source: result.source });

  await ActivityLog.create({ userId: guard.user.id, action: 'seo.content.generated', entity: 'SeoProject', entityId: projectId, meta: { type } });
  revalidatePath(`/seo/projects/${projectId}`);
  return { ok: true, contentId: String(doc._id) };
}

export async function reviewSeoContent(contentId: string) {
  const guard = await requireSeoAccess();
  if (!guard.ok) return { error: guard.error };
  await connectToDatabase();

  const doc = await SeoContent.findOne({ _id: contentId, userId: guard.user.id });
  if (!doc) return { error: 'Content not found.' };

  const project = await SeoProject.findOne({ _id: doc.projectId, userId: guard.user.id }).lean<any>();
  const siblings = await SeoContent.find({ projectId: doc.projectId, _id: { $ne: contentId } }, 'body').lean();

  const { score, findings } = reviewContent(
    doc.body,
    project?.focusKeywords ?? [],
    siblings.map((s: any) => ({ id: String(s._id), body: s.body })),
  );

  doc.reviewScore = score;
  doc.reviewFindings = findings;
  doc.reviewedAt = new Date();
  await doc.save();

  await ActivityLog.create({ userId: guard.user.id, action: 'seo.content.reviewed', entity: 'SeoContent', entityId: contentId, meta: { score } });
  revalidatePath(`/seo/projects/${String(doc.projectId)}`);
  return { ok: true, score };
}

export async function addSeoCompetitor(projectId: string, formData: FormData) {
  const guard = await requireSeoAccess();
  if (!guard.ok) return { error: guard.error };
  await connectToDatabase();

  const project = await SeoProject.findOne({ _id: projectId, userId: guard.user.id }).lean<any>();
  if (!project) return { error: 'Project not found.' };

  const name = String(formData.get('name') ?? '').trim();
  const url = String(formData.get('url') ?? '').trim() || null;
  if (!name) return { error: 'Competitor name is required.' };

  let comparison: Record<string, unknown> | null = null;
  let missingOpportunities: string[] = [];
  let improvementSuggestions: string[] = [];
  let competitiveAdvantages: string[] = [];
  let status: 'completed' | 'failed' = 'completed';

  if (url) {
    try {
      const { rawMeta } = await runWebsiteAudit(url);
      comparison = {
        title: rawMeta.title, metaDesc: rawMeta.metaDesc, structuredData: rawMeta.structuredData,
        internalLinks: rawMeta.internalLinks, externalLinks: rawMeta.externalLinks, totalImages: rawMeta.totalImages,
      };
      const ourTitleLen = project.seoScore != null ? 60 : 0;
      if (Number(rawMeta.structuredData) > 0) missingOpportunities.push('Competitor uses structured data (JSON-LD) — consider adding it if you have not.');
      if (Number(rawMeta.internalLinks) > (project.internalLinksCount ?? 0)) missingOpportunities.push('Competitor has stronger internal linking — expand your internal link structure.');
      improvementSuggestions.push(`Competitor title: "${rawMeta.title}" — compare against your own title strategy for differentiation.`);
      competitiveAdvantages.push(project.seoScore != null && project.seoScore >= 70 ? 'Your current SEO score is healthy relative to typical competitor baselines.' : 'Room to differentiate — competitor has not been scored on the same rubric yet.');
      void ourTitleLen;
    } catch (err: any) {
      status = 'failed';
      improvementSuggestions.push(`Could not analyze competitor URL: ${err?.message ?? 'unknown error'}`);
    }
  } else {
    improvementSuggestions.push('Add a URL for this competitor to unlock automated metadata comparison.');
  }

  const competitor = await SeoCompetitor.create({
    projectId, userId: guard.user.id, name, url, comparison, status,
    missingOpportunities, improvementSuggestions, competitiveAdvantages,
  });

  await ActivityLog.create({ userId: guard.user.id, action: 'seo.competitor.added', entity: 'SeoProject', entityId: projectId, meta: { name, url } });
  revalidatePath(`/seo/projects/${projectId}`);
  return { ok: true, competitorId: String(competitor._id) };
}

export async function updateSeoTask(taskId: string, updates: { status?: string; completionPercent?: number }) {
  const guard = await requireSeoAccess();
  if (!guard.ok) return { error: guard.error };
  await connectToDatabase();

  const task = await SeoTask.findOne({ _id: taskId, userId: guard.user.id });
  if (!task) return { error: 'Task not found.' };

  if (updates.status) task.status = updates.status as any;
  if (updates.completionPercent != null) task.completionPercent = Math.max(0, Math.min(100, updates.completionPercent));
  if (task.status === 'done') task.completionPercent = 100;
  await task.save();

  if (task.status === 'done') {
    await notify(guard.user.id, 'seo_optimization_completed', 'Optimization task completed', task.title, 'notifyOnOptimizationComplete');
  }

  revalidatePath(`/seo/projects/${String(task.projectId)}`);
  return { ok: true };
}

export async function saveSeoSettings(data: {
  defaultCountry: string; defaultLanguage: string; defaultProjectType: string; defaultReportFormat: string;
  notifyOnAuditComplete: boolean; notifyOnReportGenerated: boolean; notifyOnCriticalIssue: boolean;
  notifyOnOptimizationComplete: boolean; notifyOnProjectUpdated: boolean;
  seoAiEnabled: boolean; seoOpenRouterApiKey: string | null;
}) {
  const guard = await requireSeoAccess();
  if (!guard.ok) return { error: guard.error };
  await connectToDatabase();

  await User.findByIdAndUpdate(guard.user.id, {
    seoSettings: {
      defaultCountry: data.defaultCountry, defaultLanguage: data.defaultLanguage,
      defaultProjectType: data.defaultProjectType, defaultReportFormat: data.defaultReportFormat,
      notifyOnAuditComplete: data.notifyOnAuditComplete, notifyOnReportGenerated: data.notifyOnReportGenerated,
      notifyOnCriticalIssue: data.notifyOnCriticalIssue, notifyOnOptimizationComplete: data.notifyOnOptimizationComplete,
      notifyOnProjectUpdated: data.notifyOnProjectUpdated,
    },
    seoAiEnabled: data.seoAiEnabled,
    seoOpenRouterApiKey: data.seoOpenRouterApiKey || null,
  });

  revalidatePath('/seo/settings');
  return { ok: true };
}
