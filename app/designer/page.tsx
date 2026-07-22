'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Layers, Link2, Loader2, Play, Plus, Search, Sparkles, Wand2, Workflow,
} from 'lucide-react';
import { generateDesign } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { DesignAgentPipeline, DesignRightPanel } from '@/components/modules/uiux/agent-pipeline';
import type { DesignProject } from '@/lib/types';

type MainTab = 'brief' | 'pipeline';

export default function UiuxPage() {
  const [pending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('both');
  const [style, setStyle] = useState('modern');
  const [tab, setTab] = useState<MainTab>('brief');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch('/api/design-projects?limit=50');
      const data = await res.json();
      if (!cancelled && data.projects) setProjects(data.projects as DesignProject[]);
    }
    load();
    const interval = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q)
      || p.brief.toLowerCase().includes(q)
      || (p.referenceUrl ?? '').toLowerCase().includes(q));
  }, [projects, search]);

  const activeProject = projects.find((p) => p.id === projectId) ?? null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set('platform', platform);
    formData.set('style', style);
    startTransition(async () => {
      const res = await generateDesign(formData);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      if (res?.projectId) {
        setProjectId(res.projectId);
        setTab('pipeline');
        toast.success('Design pipeline started');
      }
    });
  }

  function onNewDesign() {
    setProjectId(null);
    setTab('brief');
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
              <Layers className="h-5 w-5" />
            </div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">UI/UX AI Designer</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Describe a product, or paste an app/website/Figma/Dribbble/Behance link. 8 autonomous agents
            research, plan UX, wireframe, design, systemize, adapt responsively, audit accessibility, and hand off.
          </p>
        </div>
        <Badge className="hidden bg-success/15 text-success hover:bg-success/15 sm:inline-flex">
          <Sparkles className="mr-1 h-3 w-3" /> 8 agents online
        </Badge>
      </div>

      {/* Enterprise workspace shell: persistent project sidebar + tabbed main content + status panel */}
      <div className="grid min-w-0 gap-6 lg:grid-cols-[260px_1fr_340px]">
        {/* Left: Projects sidebar */}
        <Card className="flex h-[calc(100vh-14rem)] min-h-[420px] min-w-0 flex-col border-border bg-card/40 p-4 backdrop-blur">
          <Button type="button" onClick={onNewDesign} className="mb-3 w-full gap-2">
            <Plus className="h-4 w-4" /> New Design
          </Button>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects…"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-medium text-muted-foreground">Design History</span>
            <span className="text-xs text-muted-foreground">{filteredProjects.length}</span>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {filteredProjects.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                {projects.length === 0 ? 'No designs yet. Click "New Design" to start.' : 'No projects match your search.'}
              </div>
            ) : (
              filteredProjects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setProjectId(p.id); setTab('pipeline'); }}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition',
                    p.id === projectId ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-secondary/50',
                  )}
                >
                  <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
                    <Layers className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{p.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge variant="outline" className="px-1 py-0 text-[9px] capitalize">{p.status}</Badge>
                      <span className="truncate text-[10px] text-muted-foreground">
                        {new Date(p.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </Card>

        {/* Center: tabbed Brief / Pipeline */}
        <div className="min-w-0 space-y-4">
          <div className="flex gap-1 rounded-xl border border-border bg-card/40 p-1">
            <button
              type="button"
              onClick={() => setTab('brief')}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition',
                tab === 'brief' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary/50',
              )}
            >
              <Wand2 className="h-4 w-4" /> Brief
            </button>
            <button
              type="button"
              onClick={() => setTab('pipeline')}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition',
                tab === 'pipeline' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary/50',
              )}
            >
              <Workflow className="h-4 w-4" />
              Pipeline
              {(pending || projectId) && <Badge variant="secondary" className="ml-1 text-[10px]">Live</Badge>}
            </button>
          </div>

          {tab === 'brief' && (
            <Card className="relative overflow-hidden border-border bg-card/60 p-6 backdrop-blur">
              <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
              <h2 className="font-display text-lg font-semibold">Design Brief</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Original designs only — references are analyzed for UX patterns, never copied visually.
              </p>
              <form onSubmit={onSubmit} className="mt-5 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="brief" className="flex items-center gap-1.5">
                    <Wand2 className="h-3.5 w-3.5" /> What should we design?
                  </Label>
                  <Textarea
                    id="brief"
                    name="brief"
                    rows={3}
                    placeholder="A premium fintech mobile app for freelancers to track invoices and get paid faster."
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="referenceUrl" className="flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5" /> Reference URL (optional)
                  </Label>
                  <Input
                    id="referenceUrl"
                    name="referenceUrl"
                    type="url"
                    placeholder="Play Store, App Store, website, Figma, Dribbble, or Behance link"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Platform</Label>
                    <Select value={platform} onValueChange={setPlatform}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mobile">Mobile</SelectItem>
                        <SelectItem value="web">Web</SelectItem>
                        <SelectItem value="both">Mobile + Web</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Design Style</Label>
                    <Select value={style} onValueChange={setStyle}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="modern">Modern</SelectItem>
                        <SelectItem value="minimal">Minimal</SelectItem>
                        <SelectItem value="premium">Premium / Luxury</SelectItem>
                        <SelectItem value="playful">Playful</SelectItem>
                        <SelectItem value="enterprise">Enterprise</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <motion.div whileHover={{ scale: 1.005 }} whileTap={{ scale: 0.995 }}>
                  <Button type="submit" disabled={pending} className="gap-2">
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    Generate Design
                  </Button>
                </motion.div>
              </form>
            </Card>
          )}

          {tab === 'pipeline' && (
            <Card className="border-border bg-card/40 p-6 backdrop-blur">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-display text-lg font-semibold">Agent Pipeline</h2>
                  {activeProject && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{activeProject.name}</p>
                  )}
                </div>
                {projectId && <Badge variant="secondary" className="text-xs">Live</Badge>}
              </div>
              {projectId ? (
                <DesignAgentPipeline projectId={projectId} active={pending || !!projectId} />
              ) : (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-3 py-12 text-center text-sm text-muted-foreground">
                  <Sparkles className="h-5 w-5" />
                  Select a design from the sidebar, or generate a new one from the Brief tab.
                </div>
              )}
            </Card>
          )}

          {activeProject && (
            <div className="flex items-center justify-end">
              <Link
                href={`/uiux-editor/${activeProject.id}`}
                className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/15"
              >
                View Design
              </Link>
            </div>
          )}
        </div>

        {/* Right: status + review panel */}
        <div className="min-w-0">
          <DesignRightPanel projectId={projectId} />
        </div>
      </div>
    </div>
  );
}
