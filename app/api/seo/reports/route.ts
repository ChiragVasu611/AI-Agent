import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/permissions';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { SeoProject } from '@/lib/mongodb/models/SeoProject';
import { SeoTask } from '@/lib/mongodb/models/SeoTask';
import { SeoAudit } from '@/lib/mongodb/models/SeoAudit';
import { SeoContent } from '@/lib/mongodb/models/SeoContent';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.permissions, 'workspace:seo')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const type = url.searchParams.get('type') ?? 'executive';

  await connectToDatabase();
  const projects = (await SeoProject.find({ userId: user.id }).lean()).map(serializeDoc);

  if (type === 'executive') {
    return NextResponse.json({ rows: projects.map((p: any) => ({
      Project: p.name, Type: p.projectType, Country: p.targetCountry,
      'SEO Score': p.seoScore ?? '—', 'ASO Score': p.asoScore ?? '—',
      'Technical Score': p.technicalScore ?? '—', 'Content Score': p.contentScore ?? '—',
      'Accessibility Score': p.accessibilityScore ?? '—', 'Performance Score': p.performanceScore ?? '—',
      'Last Audit': p.lastAuditAt ?? 'Never',
    })) });
  }

  if (type === 'tasks') {
    const projectById = new Map(projects.map((p: any) => [p.id, p.name]));
    const tasks = (await SeoTask.find({ userId: user.id }).lean()).map(serializeDoc);
    return NextResponse.json({ rows: tasks.map((t: any) => ({
      Project: projectById.get(t.projectId) ?? '—', Task: t.title, Priority: t.priority,
      Category: t.category, Status: t.status, 'Est. Time': t.estimatedTime, 'Completion %': t.completionPercent,
    })) });
  }

  if (type === 'seo_audit' || type === 'aso_audit' || type === 'technical' || type === 'audit') {
    const projectById = new Map(projects.map((p: any) => [p.id, p.name]));
    const auditType = type === 'aso_audit' ? 'aso' : type === 'seo_audit' || type === 'technical' ? 'website' : undefined;
    const auditQuery: Record<string, unknown> = { userId: user.id };
    if (auditType) auditQuery.type = auditType;
    const audits = (await SeoAudit.find(auditQuery).sort({ createdAt: -1 }).lean()).map(serializeDoc);
    let findings = audits.flatMap((a: any) => a.findings.map((f: any) => ({ ...f, projectId: a.projectId, auditType: a.type })));
    if (type === 'technical') findings = findings.filter((f: any) => f.category === 'Technical' || f.category === 'Performance' || f.category === 'Mobile');
    const rows = findings.map((f: any) => ({
      Project: projectById.get(f.projectId) ?? '—', 'Audit Type': f.auditType, Category: f.category, Item: f.item,
      Status: f.status, Severity: f.severity, Detail: f.detail, Recommendation: f.recommendation,
    }));
    return NextResponse.json({ rows });
  }

  if (type === 'content') {
    const projectById = new Map(projects.map((p: any) => [p.id, p.name]));
    const content = (await SeoContent.find({ userId: user.id }).sort({ createdAt: -1 }).lean()).map(serializeDoc);
    return NextResponse.json({ rows: content.map((c: any) => ({
      Project: projectById.get(c.projectId) ?? '—', Type: c.type, Title: c.title, Source: c.source,
      'Quality Score': c.reviewScore ?? 'Not reviewed', 'Word Count': String(c.body ?? '').split(/\s+/).filter(Boolean).length,
    })) });
  }

  if (type === 'growth') {
    const projectById = new Map(projects.map((p: any) => [p.id, p.name]));
    const tasks = (await SeoTask.find({ userId: user.id, status: { $ne: 'done' } }).lean()).map(serializeDoc);
    return NextResponse.json({ rows: tasks.map((t: any) => ({
      Project: projectById.get(t.projectId) ?? '—', Task: t.title, Priority: t.priority, 'Plan Horizon': t.planHorizon ?? '—',
      'Estimated Impact': t.estimatedImpact, 'Estimated Time': t.estimatedTime, Category: t.category,
    })) });
  }

  return NextResponse.json({ error: 'Unknown report type' }, { status: 400 });
}
