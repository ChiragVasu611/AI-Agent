'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Layers, Link2, Loader2, Play, Sparkles, Wand2 } from 'lucide-react';
import { generateDesign } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { DesignAgentPipeline, DesignRightPanel } from '@/components/modules/uiux/agent-pipeline';
import type { DesignProject } from '@/lib/types';

export default function UiuxPage() {
  const [pending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [platform, setPlatform] = useState('both');
  const [style, setStyle] = useState('modern');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch('/api/design-projects?limit=8');
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
        toast.success('Design pipeline started');
      }
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
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

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left + center: form + pipeline */}
        <div className="space-y-6 lg:col-span-2">
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

          {/* Pipeline */}
          <Card className="border-border bg-card/40 p-6 backdrop-blur">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Agent Pipeline</h2>
              {projectId && <Badge variant="secondary" className="text-xs">Live</Badge>}
            </div>
            <DesignAgentPipeline projectId={projectId} active={pending || !!projectId} />
          </Card>

          {/* Project history */}
          <Card className="border-border bg-card/40 p-6 backdrop-blur">
            <h2 className="mb-3 font-display text-lg font-semibold">Design History</h2>
            {projects.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No designs yet. Generate your first design above.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {projects.map((p) => (
                  <div
                    key={p.id}
                    className="flex w-full items-center gap-3 px-1 py-3 text-left transition hover:bg-secondary/50"
                  >
                    <button onClick={() => setProjectId(p.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
                        <Layers className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{p.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {p.referenceUrl ?? p.brief}
                        </div>
                      </div>
                    </button>
                    <Badge variant="outline" className="capitalize text-xs">{p.status}</Badge>
                    <span className="hidden text-xs text-muted-foreground sm:block">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </span>
                    <Link
                      href={`/uiux-editor/${p.id}`}
                      className="rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/15"
                    >
                      View Design
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right panel */}
        <div>
          <DesignRightPanel projectId={projectId} />
        </div>
      </div>
    </div>
  );
}
