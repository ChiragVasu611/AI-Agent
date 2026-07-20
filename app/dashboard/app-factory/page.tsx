'use client';

import { useEffect, useState, useTransition } from 'react';
import { motion } from 'framer-motion';
import { Apple, Bot, Globe, Loader2, Play, Sparkles } from 'lucide-react';
import { analyzeAndBuild } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { AgentPipeline, RightPanel } from '@/components/modules/app-factory/agent-pipeline';
import type { Project } from '@/lib/types';

export default function AppFactoryPage() {
  const [pending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [platform, setPlatform] = useState('flutter');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch('/api/projects?limit=8');
      const data = await res.json();
      if (!cancelled && data.projects) setProjects(data.projects as Project[]);
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
    startTransition(async () => {
      const res = await analyzeAndBuild(formData);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      if (res?.projectId) {
        setProjectId(res.projectId);
        toast.success('Pipeline started');
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
              <Bot className="h-5 w-5" />
            </div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">AI App Factory</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Drop a reference app URL. 8 autonomous agents will analyze, plan, design, code, build, test, and ship.
          </p>
        </div>
        <Badge className="hidden bg-success/15 text-success hover:bg-success/15 sm:inline-flex">
          <Sparkles className="mr-1 h-3 w-3" /> 8 agents online
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left + center: form + pipeline */}
        <div className="space-y-6 lg:col-span-2">
          {/* Analyze & Build form */}
          <Card className="relative overflow-hidden border-border bg-card/60 p-6 backdrop-blur">
            <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
            <h2 className="font-display text-lg font-semibold">Reference App</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Provide a Google Play or Apple App Store URL, or any public reference app page.
            </p>
            <form onSubmit={onSubmit} className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="referenceUrl" className="flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5" /> Reference App URL
                </Label>
                <Input
                  id="referenceUrl"
                  name="referenceUrl"
                  type="url"
                  placeholder="https://play.google.com/store/apps/details?id=com.example.app"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Apple className="h-3.5 w-3.5" /> Google Play URL
                  </Label>
                  <Input name="googlePlay" type="url" placeholder="play.google.com/…" />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Apple className="h-3.5 w-3.5" /> Apple App Store URL
                  </Label>
                  <Input name="appleStore" type="url" placeholder="apps.apple.com/…" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Target Platform</Label>
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger className="w-full sm:w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flutter">Flutter</SelectItem>
                    <SelectItem value="android">Android Native</SelectItem>
                    <SelectItem value="ios">iOS Native</SelectItem>
                    <SelectItem value="react-native">React Native</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <motion.div whileHover={{ scale: 1.005 }} whileTap={{ scale: 0.995 }}>
                <Button type="submit" disabled={pending} className="gap-2">
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Analyze & Build
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
            <AgentPipeline projectId={projectId} active={pending || !!projectId} />
          </Card>

          {/* Project history */}
          <Card className="border-border bg-card/40 p-6 backdrop-blur">
            <h2 className="mb-3 font-display text-lg font-semibold">Project History</h2>
            {projects.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No projects yet. Run your first build above.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setProjectId(p.id)}
                    className="flex w-full items-center gap-3 px-1 py-3 text-left transition hover:bg-secondary/50"
                  >
                    <div className="grid h-8 w-8 place-items-center rounded-lg bg-secondary text-muted-foreground">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {p.referenceUrl}
                      </div>
                    </div>
                    <Badge variant="outline" className="capitalize text-xs">{p.status}</Badge>
                    <span className="hidden text-xs text-muted-foreground sm:block">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right panel */}
        <div>
          <RightPanel projectId={projectId} />
        </div>
      </div>
    </div>
  );
}
