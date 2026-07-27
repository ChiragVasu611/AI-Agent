'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck, Loader2, PlayCircle, Plus, RefreshCw, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  runProjectWebsiteAudit, runProjectAsoAudit, generateProjectKeywords,
  generateProjectContent, addSeoCompetitor, updateSeoTask, reviewSeoContent,
} from '@/app/seo/actions';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-500 border-red-500/30',
  high: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
  medium: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  low: 'bg-sky-500/15 text-sky-500 border-sky-500/30',
};

const CONTENT_TYPES = [
  { value: 'seo_title', label: 'SEO Title' },
  { value: 'meta_description', label: 'Meta Description' },
  { value: 'blog_idea', label: 'Blog Ideas' },
  { value: 'landing_page', label: 'Landing Page Copy' },
  { value: 'faq', label: 'FAQ' },
  { value: 'product_description', label: 'Product Description' },
  { value: 'app_description', label: 'App Description' },
  { value: 'release_notes', label: 'Release Notes' },
  { value: 'social_caption', label: 'Social Caption' },
];

function ScoreTile({ label, value }: { label: string; value: number | null }) {
  return (
    <Card className="border-border bg-card/60 p-4 backdrop-blur">
      <div className="font-display text-2xl font-semibold">{value ?? '—'}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </Card>
  );
}

export function ProjectWorkspace({ project, websiteAudit, asoAudit, keywords, tasks, content, competitors }: {
  project: any; websiteAudit: any; asoAudit: any; keywords: any[]; tasks: any[]; content: any[]; competitors: any[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [contentType, setContentType] = useState('seo_title');
  const [competitorForm, setCompetitorForm] = useState(false);

  function refresh() { router.refresh(); }

  function runWebsiteAudit() {
    startTransition(async () => {
      const res = await runProjectWebsiteAudit(project.id);
      if (res?.error) toast.error(res.error);
      else { toast.success('Website audit completed'); refresh(); }
    });
  }

  function runAso(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await runProjectAsoAudit(project.id, formData);
      if (res?.error) toast.error(res.error);
      else { toast.success('ASO audit completed'); refresh(); }
    });
  }

  function genKeywords() {
    startTransition(async () => {
      const res = await generateProjectKeywords(project.id);
      if (res?.error) toast.error(res.error);
      else { toast.success(`Generated ${res.count} keywords`); refresh(); }
    });
  }

  function genContent() {
    startTransition(async () => {
      const res = await generateProjectContent(project.id, contentType as any);
      if (res?.error) toast.error(res.error);
      else { toast.success('Content generated'); refresh(); }
    });
  }

  function addCompetitor(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await addSeoCompetitor(project.id, formData);
      if (res?.error) toast.error(res.error);
      else { toast.success('Competitor added'); setCompetitorForm(false); refresh(); }
    });
  }

  function onTaskStatusChange(taskId: string, status: string) {
    startTransition(async () => {
      const res = await updateSeoTask(taskId, { status });
      if (res?.error) toast.error(res.error);
      else refresh();
    });
  }

  function onReviewContent(contentId: string) {
    startTransition(async () => {
      const res = await reviewSeoContent(contentId);
      if (res?.error) toast.error(res.error);
      else { toast.success(`Content quality score: ${res.score}/100`); refresh(); }
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{project.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground capitalize">
          {project.projectType.replace(/_/g, ' ')} · {project.targetCountry} · {project.businessCategory || 'uncategorized'}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
        <ScoreTile label="SEO" value={project.seoScore} />
        <ScoreTile label="ASO" value={project.asoScore} />
        <ScoreTile label="Technical" value={project.technicalScore} />
        <ScoreTile label="Content" value={project.contentScore} />
        <ScoreTile label="Accessibility" value={project.accessibilityScore} />
        <ScoreTile label="Performance" value={project.performanceScore} />
        <ScoreTile label="Metadata" value={project.metadataScore} />
        <ScoreTile label="Mobile" value={project.mobileScore} />
        <ScoreTile label="UX" value={project.uxScore} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="seo">SEO Audit</TabsTrigger>
          <TabsTrigger value="aso">ASO</TabsTrigger>
          <TabsTrigger value="keywords">Keywords</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="competitors">Competitors</TabsTrigger>
          <TabsTrigger value="tasks">Tasks ({tasks.filter((t) => t.status !== 'done').length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-4">
          <Card className="border-border bg-card/60 p-6 backdrop-blur">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-lg font-semibold">AI Project Analysis</h2>
              <Badge variant="secondary" className="text-[10px] capitalize">{project.analysisSource ?? 'deterministic'}</Badge>
            </div>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <div><dt className="text-xs font-semibold text-muted-foreground">Business Type</dt><dd className="mt-1 text-sm">{project.businessType}</dd></div>
              <div><dt className="text-xs font-semibold text-muted-foreground">Product Type</dt><dd className="mt-1 text-sm">{project.productType}</dd></div>
              <div><dt className="text-xs font-semibold text-muted-foreground">User Intent</dt><dd className="mt-1 text-sm">{project.userIntent}</dd></div>
              <div><dt className="text-xs font-semibold text-muted-foreground">Target Market</dt><dd className="mt-1 text-sm">{project.targetMarket}</dd></div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {project.businessGoals?.map((g: string) => <Badge key={g} variant="outline" className="text-[11px]">{g}</Badge>)}
            </div>
            <div className="mt-6 space-y-3 text-sm">
              <p><span className="font-semibold">Business Summary — </span>{project.businessSummary}</p>
              <p><span className="font-semibold">SEO Strategy — </span>{project.seoStrategy}</p>
              <p><span className="font-semibold">ASO Strategy — </span>{project.asoStrategy}</p>
              <p><span className="font-semibold">Growth Roadmap — </span>{project.growthRoadmap}</p>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="seo" className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {project.websiteUrl ? `Target: ${project.websiteUrl}` : 'No website URL configured for this project.'}
            </p>
            <Button onClick={runWebsiteAudit} disabled={pending || !project.websiteUrl} className="gap-2">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              {websiteAudit ? 'Re-run Audit' : 'Run Website Audit'}
            </Button>
          </div>
          {websiteAudit ? (
            <Card className="border-border bg-card/60 backdrop-blur">
              <div className="flex flex-wrap gap-2 border-b border-border p-4 text-xs">
                <Badge className={SEVERITY_STYLES.critical}>{websiteAudit.counts.critical} Critical</Badge>
                <Badge className={SEVERITY_STYLES.high}>{websiteAudit.counts.high} High</Badge>
                <Badge className={SEVERITY_STYLES.medium}>{websiteAudit.counts.medium} Medium</Badge>
                <Badge className={SEVERITY_STYLES.low}>{websiteAudit.counts.low} Low</Badge>
                <Badge variant="outline">{websiteAudit.counts.passed} Passed</Badge>
              </div>
              <div className="divide-y divide-border">
                {websiteAudit.findings.map((f: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-3 text-sm">
                    <Badge className={`${SEVERITY_STYLES[f.severity]} shrink-0 text-[10px]`}>{f.severity}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{f.category} — {f.item}</div>
                      <div className="text-xs text-muted-foreground">{f.detail}</div>
                      {f.recommendation && <div className="mt-1 text-xs text-primary">{f.recommendation}</div>}
                    </div>
                    {f.status === 'pass' && <BadgeCheck className="h-4 w-4 shrink-0 text-success" />}
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <Card className="border-border bg-card/40 p-8 text-center text-sm text-muted-foreground backdrop-blur">
              No website audit run yet.
            </Card>
          )}
        </TabsContent>

        <TabsContent value="aso" className="mt-6 space-y-4">
          <Card className="border-border bg-card/60 p-6 backdrop-blur">
            <form onSubmit={runAso} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="appName">App Name</Label><Input id="appName" name="appName" defaultValue={asoAudit?.rawMeta?.appName ?? project.name} /></div>
                <div className="space-y-1.5"><Label htmlFor="category">Category</Label><Input id="category" name="category" defaultValue={asoAudit?.rawMeta?.category ?? project.businessCategory} /></div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="shortDescription">Short Description</Label><Textarea id="shortDescription" name="shortDescription" rows={2} defaultValue={asoAudit?.rawMeta?.shortDescription ?? ''} /></div>
              <div className="space-y-1.5"><Label htmlFor="longDescription">Long Description</Label><Textarea id="longDescription" name="longDescription" rows={4} defaultValue={asoAudit?.rawMeta?.longDescription ?? ''} /></div>
              <div className="space-y-1.5"><Label htmlFor="keywords">Keywords (comma-separated)</Label><Input id="keywords" name="keywords" defaultValue={asoAudit?.rawMeta?.keywords ?? project.focusKeywords?.join(', ')} /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="screenshotCount">Screenshot Count</Label><Input id="screenshotCount" name="screenshotCount" type="number" min={0} defaultValue={asoAudit?.rawMeta?.screenshotCount ?? 0} /></div>
                <div className="space-y-1.5"><Label htmlFor="releaseNotes">Release Notes</Label><Input id="releaseNotes" name="releaseNotes" defaultValue={asoAudit?.rawMeta?.releaseNotes ?? ''} /></div>
              </div>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm"><Checkbox name="hasIcon" defaultChecked={asoAudit?.rawMeta?.hasIcon} /> Icon uploaded</label>
                <label className="flex items-center gap-2 text-sm"><Checkbox name="hasFeatureGraphic" defaultChecked={asoAudit?.rawMeta?.hasFeatureGraphic} /> Feature graphic uploaded</label>
              </div>
              <Button type="submit" disabled={pending} className="gap-2">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                {asoAudit ? 'Re-run ASO Analysis' : 'Run ASO Analysis'}
              </Button>
            </form>
          </Card>
          {asoAudit && (
            <Card className="border-border bg-card/60 backdrop-blur">
              <div className="flex flex-wrap gap-2 border-b border-border p-4 text-xs">
                <Badge className={SEVERITY_STYLES.critical}>{asoAudit.counts.critical} Critical</Badge>
                <Badge className={SEVERITY_STYLES.high}>{asoAudit.counts.high} High</Badge>
                <Badge className={SEVERITY_STYLES.medium}>{asoAudit.counts.medium} Medium</Badge>
                <Badge className={SEVERITY_STYLES.low}>{asoAudit.counts.low} Low</Badge>
                <Badge variant="outline">{asoAudit.counts.passed} Passed</Badge>
              </div>
              <div className="divide-y divide-border">
                {asoAudit.findings.map((f: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-3 text-sm">
                    <Badge className={`${SEVERITY_STYLES[f.severity]} shrink-0 text-[10px]`}>{f.severity}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{f.category} — {f.item}</div>
                      <div className="text-xs text-muted-foreground">{f.detail}</div>
                      {f.recommendation && <div className="mt-1 text-xs text-primary">{f.recommendation}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="keywords" className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{keywords.length} keyword(s) generated.</p>
            <Button onClick={genKeywords} disabled={pending} className="gap-2">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate Keywords
            </Button>
          </div>
          <Card className="border-border bg-card/60 backdrop-blur">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Keyword</TableHead><TableHead>Type</TableHead><TableHead>Intent</TableHead>
                  <TableHead>Relevance</TableHead><TableHead>Competition</TableHead><TableHead>Business Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keywords.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No keywords yet.</TableCell></TableRow>
                ) : keywords.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.keyword}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px] capitalize">{k.type.replace(/_/g, ' ')}</Badge></TableCell>
                    <TableCell className="text-xs capitalize text-muted-foreground">{k.intent}</TableCell>
                    <TableCell className="text-xs">{k.relevance}</TableCell>
                    <TableCell className="text-xs capitalize">{k.competitionEstimate}</TableCell>
                    <TableCell className="text-xs">{k.businessValue}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="content" className="mt-6 space-y-4">
          <div className="flex items-center gap-3">
            <Select value={contentType} onValueChange={setContentType}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>{CONTENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
            <Button onClick={genContent} disabled={pending} className="gap-2">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate
            </Button>
          </div>
          <div className="space-y-3">
            {content.length === 0 ? (
              <Card className="border-border bg-card/40 p-8 text-center text-sm text-muted-foreground backdrop-blur">No content generated yet.</Card>
            ) : content.map((c) => (
              <Card key={c.id} className="border-border bg-card/60 p-4 backdrop-blur">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">{c.title}</div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="secondary" className="text-[10px] capitalize">{c.source}</Badge>
                    {c.reviewScore != null && (
                      <Badge variant="outline" className={c.reviewScore >= 70 ? 'text-success' : c.reviewScore >= 40 ? 'text-amber-500' : 'text-destructive'}>
                        Quality {c.reviewScore}/100
                      </Badge>
                    )}
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => onReviewContent(c.id)} className="gap-1.5 text-xs">
                      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <BadgeCheck className="h-3 w-3" />}
                      {c.reviewScore != null ? 'Re-review' : 'Review Quality'}
                    </Button>
                  </div>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{c.body}</p>
                {c.reviewFindings?.length > 0 && (
                  <div className="mt-3 divide-y divide-border rounded-lg border border-border">
                    {c.reviewFindings.map((f: any, i: number) => (
                      <div key={i} className="flex items-start gap-2 p-2.5 text-xs">
                        <Badge className={`${SEVERITY_STYLES[f.severity]} shrink-0 text-[9px]`}>{f.severity}</Badge>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{f.category} — {f.item}</div>
                          <div className="text-muted-foreground">{f.detail}</div>
                          {f.recommendation && <div className="mt-0.5 text-primary">{f.recommendation}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="competitors" className="mt-6 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setCompetitorForm((s) => !s)} variant="outline" className="gap-2"><Plus className="h-4 w-4" /> Add Competitor</Button>
          </div>
          {competitorForm && (
            <Card className="border-border bg-card/60 p-4 backdrop-blur">
              <form onSubmit={addCompetitor} className="grid gap-3 sm:grid-cols-3">
                <Input name="name" placeholder="Competitor name" required />
                <Input name="url" placeholder="https://competitor.com (optional)" />
                <Button type="submit" disabled={pending} className="gap-2">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add</Button>
              </form>
            </Card>
          )}
          <div className="space-y-3">
            {competitors.length === 0 ? (
              <Card className="border-border bg-card/40 p-8 text-center text-sm text-muted-foreground backdrop-blur">No competitors added yet.</Card>
            ) : competitors.map((c) => (
              <Card key={c.id} className="border-border bg-card/60 p-4 backdrop-blur">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">{c.name}</div>
                  {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">{c.url}</a>}
                </div>
                {c.missingOpportunities.length > 0 && (
                  <div className="mt-2"><div className="text-xs font-semibold text-muted-foreground">Missing Opportunities</div>
                    <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">{c.missingOpportunities.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {c.improvementSuggestions.length > 0 && (
                  <div className="mt-2"><div className="text-xs font-semibold text-muted-foreground">Improvement Suggestions</div>
                    <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">{c.improvementSuggestions.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {c.competitiveAdvantages.length > 0 && (
                  <div className="mt-2"><div className="text-xs font-semibold text-muted-foreground">Your Advantages</div>
                    <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">{c.competitiveAdvantages.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="tasks" className="mt-6">
          <Card className="border-border bg-card/60 backdrop-blur">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead><TableHead>Priority</TableHead><TableHead>Category</TableHead>
                  <TableHead>Est. Time</TableHead><TableHead>Impact</TableHead><TableHead>Status</TableHead><TableHead>Progress</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">No tasks yet — run an audit to auto-generate an optimization plan.</TableCell></TableRow>
                ) : tasks.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell><div className="text-sm font-medium">{t.title}</div><div className="text-xs text-muted-foreground">{t.description}</div></TableCell>
                    <TableCell><Badge className={`${SEVERITY_STYLES[t.priority]} text-[10px]`}>{t.priority}</Badge></TableCell>
                    <TableCell className="text-xs capitalize">{t.category.replace(/_/g, ' ')}</TableCell>
                    <TableCell className="text-xs">{t.estimatedTime}</TableCell>
                    <TableCell className="max-w-[160px] text-xs text-muted-foreground">{t.estimatedImpact}</TableCell>
                    <TableCell>
                      <Select value={t.status} onValueChange={(v) => onTaskStatusChange(t.id, v)}>
                        <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="todo">To Do</SelectItem>
                          <SelectItem value="in_progress">In Progress</SelectItem>
                          <SelectItem value="done">Done</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="w-24"><Progress value={t.completionPercent} className="h-1.5" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
