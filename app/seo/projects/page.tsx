'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { createSeoProject, deleteSeoProject } from '@/app/seo/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const PROJECT_TYPES = [
  { value: 'website', label: 'Website' },
  { value: 'android', label: 'Android Application' },
  { value: 'ios', label: 'iOS Application' },
  { value: 'flutter', label: 'Flutter' },
  { value: 'react_native', label: 'React Native' },
  { value: 'hybrid', label: 'Hybrid Application' },
  { value: 'web_app', label: 'Web Application' },
];

export default function SeoProjectsPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [projectType, setProjectType] = useState('website');
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [countryFilter, setCountryFilter] = useState('all');
  const [sort, setSort] = useState('recent');

  function load() {
    setLoading(true);
    fetch('/api/seo/projects').then((r) => r.json()).then((d) => setProjects(d.projects ?? [])).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const countryOptions = useMemo(
    () => Array.from(new Set(projects.map((p) => p.targetCountry).filter(Boolean))).sort(),
    [projects],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = projects.filter((p) => {
      if (typeFilter !== 'all' && p.projectType !== typeFilter) return false;
      if (countryFilter !== 'all' && p.targetCountry !== countryFilter) return false;
      if (q && !`${p.name} ${p.companyName ?? ''} ${p.businessCategory ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    result = [...result].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'seo') return (b.seoScore ?? -1) - (a.seoScore ?? -1);
      if (sort === 'aso') return (b.asoScore ?? -1) - (a.asoScore ?? -1);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return result;
  }, [projects, search, typeFilter, countryFilter, sort]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set('projectType', projectType);
    startTransition(async () => {
      const res = await createSeoProject(formData);
      if (res?.error) { toast.error(res.error); return; }
      toast.success('Project created — AI analysis complete.');
      router.push(`/seo/projects/${res.projectId}`);
    });
  }

  function onDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This removes all audits, keywords, tasks, and content for this project.`)) return;
    startTransition(async () => {
      const res = await deleteSeoProject(id);
      if (res?.error) { toast.error(res.error); return; }
      toast.success('Project deleted');
      load();
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">SEO/ASO Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create a project to unlock AI analysis, audits, keywords, content, and growth planning.</p>
        </div>
        <Button onClick={() => setShowForm((s) => !s)} className="gap-2">
          <Plus className="h-4 w-4" /> New Project
        </Button>
      </div>

      {showForm && (
        <Card className="border-border bg-card/60 p-6 backdrop-blur">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Project Name *</Label>
                <Input id="name" name="name" required placeholder="Acme Shopping App" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="companyName">Company Name</Label>
                <Input id="companyName" name="companyName" placeholder="Acme Inc." />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Project Type</Label>
                <Select value={projectType} onValueChange={setProjectType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROJECT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="websiteUrl">Website URL</Label>
                <Input id="websiteUrl" name="websiteUrl" placeholder="https://example.com" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="playStoreUrl">Play Store URL</Label>
                <Input id="playStoreUrl" name="playStoreUrl" placeholder="https://play.google.com/store/apps/details?id=..." />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="appStoreUrl">App Store URL</Label>
                <Input id="appStoreUrl" name="appStoreUrl" placeholder="https://apps.apple.com/app/..." />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="targetCountry">Target Country</Label>
                <Input id="targetCountry" name="targetCountry" defaultValue="United States" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="language">Language</Label>
                <Input id="language" name="language" defaultValue="English" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="businessCategory">Business Category</Label>
                <Input id="businessCategory" name="businessCategory" placeholder="E-commerce" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="industry">Industry</Label>
                <Input id="industry" name="industry" placeholder="Retail" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="targetAudience">Target Audience</Label>
              <Input id="targetAudience" name="targetAudience" placeholder="Small business owners, 25-45" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="competitorNames">Competitor Names (comma-separated)</Label>
                <Textarea id="competitorNames" name="competitorNames" rows={2} placeholder="Competitor A, Competitor B" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="focusKeywords">Focus Keywords (comma-separated)</Label>
                <Textarea id="focusKeywords" name="focusKeywords" rows={2} placeholder="project management software, task tracker" />
              </div>
            </div>

            <Button type="submit" disabled={pending} className="gap-2">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Create Project &amp; Run AI Analysis
            </Button>
          </form>
        </Card>
      )}

      <Card className="border-border bg-card/60 p-4 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-md border border-input bg-background px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, company, or category..."
              className="h-full w-full bg-transparent text-sm outline-none"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-9 w-[180px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Project Types</SelectItem>
              {PROJECT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={countryFilter} onValueChange={setCountryFilter}>
            <SelectTrigger className="h-9 w-[160px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Countries</SelectItem>
              {countryOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-9 w-[160px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Newest First</SelectItem>
              <SelectItem value="name">Name (A-Z)</SelectItem>
              <SelectItem value="seo">SEO Score (High-Low)</SelectItem>
              <SelectItem value="aso">ASO Score (High-Low)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="border-border bg-card/40 backdrop-blur">
        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
        ) : projects.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No projects yet. Create your first one above.</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No projects match your search/filters.</div>
        ) : (
          <div className="divide-y divide-border">
            <div className="px-5 py-2 text-xs text-muted-foreground">{filtered.length} of {projects.length} project(s)</div>
            {filtered.map((p) => (
              <div key={p.id} className="flex items-center gap-4 px-5 py-4">
                <Link href={`/seo/projects/${p.id}`} className="min-w-0 flex-1 hover:underline">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="text-xs capitalize text-muted-foreground">{p.projectType.replace(/_/g, ' ')} · {p.targetCountry} · {p.businessCategory || 'uncategorized'}</div>
                </Link>
                <Badge variant="outline">SEO {p.seoScore ?? '—'}</Badge>
                <Badge variant="outline">ASO {p.asoScore ?? '—'}</Badge>
                <Button variant="ghost" size="icon" disabled={pending} onClick={() => onDelete(p.id, p.name)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
