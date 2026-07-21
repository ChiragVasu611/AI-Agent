'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { motion } from 'framer-motion';
import { Apple, Bot, Globe, ListChecks, Loader2, Play, Smartphone, Sparkles, Trash2 } from 'lucide-react';
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
import { DevicePanel } from '@/components/modules/app-factory/device-panel';
import { cn } from '@/lib/utils';
import type { Project } from '@/lib/types';

const STORAGE_KEY = 'app-factory:selected-project';

export default function AppFactoryPage() {
  const [pending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [platform, setPlatform] = useState('flutter');
  const [runTarget, setRunTarget] = useState('auto');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Persist the selected project so a page reload restores the live view
  // (pipeline, device panel and build status) instead of resetting to empty.
  const selectProject = useCallback((id: string | null) => {
    setProjectId(id);
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setProjectId(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch('/api/projects?limit=12', { cache: 'no-store' });
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

  async function onDelete(id: string) {
    if (!window.confirm('Delete this project and its build history? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to delete project');
        return;
      }
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (projectId === id) selectProject(null);
      toast.success('Project deleted');
    } finally {
      setDeletingId(null);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set('platform', platform);
    formData.set('runTarget', runTarget);
    startTransition(async () => {
      const res = await analyzeAndBuild(formData);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      if (res?.projectId) {
        selectProject(res.projectId);
        toast.success('Pipeline started');
      }
    });
  }

  const apkReady = projects.find((p) => p.id === projectId)?.status === 'completed';

  return (
    <div className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <header className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-6 sm:p-7">
        <div className="pointer-events-none absolute -right-20 -top-20 h-52 w-52 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
              <Bot className="h-6 w-6" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">AI App Factory</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Drop a reference app URL. 8 autonomous agents analyze, plan, design, code, build, test, and ship — then run it on a device or emulator.
              </p>
            </div>
          </div>
          <Badge className="bg-success/15 text-success hover:bg-success/15">
            <Sparkles className="mr-1 h-3 w-3" /> 8 agents online
          </Badge>
        </div>
      </header>

      {/* Row 1 — Reference App (left) + Device & Emulator (right) */}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        {/* Analyze & Build form */}
        <Card className="relative overflow-hidden border-border bg-card/60 p-6 backdrop-blur">
          <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            <h2 className="font-display text-lg font-semibold">Reference App</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Provide a Google Play or Apple App Store URL, or any public reference app page.
          </p>
          <form onSubmit={onSubmit} autoComplete="off" className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="referenceUrl" className="flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5" /> Reference App URL
              </Label>
              <Input
                id="referenceUrl"
                name="referenceUrl"
                type="url"
                autoComplete="off"
                placeholder="https://play.google.com/store/apps/details?id=com.example.app"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Apple className="h-3.5 w-3.5" /> Google Play URL
                </Label>
                <Input name="googlePlay" type="url" autoComplete="off" placeholder="play.google.com/…" />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Apple className="h-3.5 w-3.5" /> Apple App Store URL
                </Label>
                <Input name="appleStore" type="url" autoComplete="off" placeholder="apps.apple.com/…" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Target Platform</Label>
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flutter">Flutter</SelectItem>
                    <SelectItem value="react-native">React Native</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Smartphone className="h-3.5 w-3.5" /> Run Target
                </Label>
                <Select value={runTarget} onValueChange={setRunTarget}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-detect</SelectItem>
                    <SelectItem value="emulator">Virtual Emulator</SelectItem>
                    <SelectItem value="real-device">Real Device</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <motion.div whileHover={{ scale: 1.005 }} whileTap={{ scale: 0.995 }}>
              <Button type="submit" disabled={pending} className="w-full gap-2 sm:w-auto">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Analyze & Build
              </Button>
            </motion.div>
          </form>
        </Card>

        {/* Device & Emulator — to the right of the Reference URL section */}
        <Card className="border-border bg-card/60 p-6 backdrop-blur">
          <div className="mb-4 flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-primary" />
            <h2 className="font-display text-lg font-semibold">Device &amp; Emulator</h2>
          </div>
          <DevicePanel projectId={projectId} apkReady={apkReady} />
        </Card>
      </div>

      {/* Row 2 — Agent Pipeline (wide) + Build status */}
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card className="border-border bg-card/40 p-6 backdrop-blur lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 className="font-display text-lg font-semibold">Agent Pipeline</h2>
            </div>
            {projectId && <Badge variant="secondary" className="text-xs">Live</Badge>}
          </div>
          <AgentPipeline projectId={projectId} active={pending || !!projectId} />
        </Card>

        <div className="lg:col-span-1">
          <RightPanel projectId={projectId} />
        </div>
      </div>

      {/* Row 3 — Project History (full width) */}
      <Card className="border-border bg-card/40 p-6 backdrop-blur">
        <div className="mb-3 flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-primary" />
          <h2 className="font-display text-lg font-semibold">Project History</h2>
        </div>
        {projects.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No projects yet. Run your first build above.
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {projects.map((p) => (
              <div
                key={p.id}
                className={cn(
                  'flex items-center gap-3 rounded-xl border px-3 py-2.5 transition',
                  projectId === p.id ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-secondary/50',
                )}
              >
                <button
                  onClick={() => selectProject(p.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{p.referenceUrl}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant="outline" className="capitalize text-[10px]">{p.status}</Badge>
                    <span className="hidden text-[11px] text-muted-foreground sm:block">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete project"
                  title="Delete project"
                  disabled={deletingId === p.id}
                  onClick={() => onDelete(p.id)}
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                >
                  {deletingId === p.id
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Trash2 className="h-4 w-4" />}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
