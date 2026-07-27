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

  const selected = projects.find((p) => p.id === projectId);
  const apkReady = selected?.status === 'completed';
  const webReady = !!selected?.webReady;

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

      {/* Row 1 — Reference App + Device */}
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        {/* ========================= Reference App ========================= */}
        <Card className="overflow-hidden rounded-3xl border border-border/60 bg-card shadow-sm">
          <div className="border-b bg-gradient-to-r from-primary/5 via-background to-background px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                <Globe className="h-5 w-5 text-primary" />
              </div>

              <div>
                <h2 className="font-display text-xl font-semibold">
                  Reference Application
                </h2>
                <p className="text-sm text-muted-foreground">
                  Paste a Play Store or App Store link and let AI analyze &
                  recreate the application.
                </p>
              </div>
            </div>
          </div>

          <form
              onSubmit={onSubmit}
              autoComplete="off"
              className="space-y-6 p-6"
          >
            {/* URL */}
            <div className="space-y-2">
              <Label htmlFor="referenceUrl">
                Reference Application URL
              </Label>

              <Input
                  id="referenceUrl"
                  name="referenceUrl"
                  type="url"
                  placeholder="https://play.google.com/store/apps/details?id=com.example.app"
                  className="h-12 rounded-xl"
              />
            </div>

            {/* Optional Apple */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Apple className="h-4 w-4" />
                Apple App Store URL (Optional)
              </Label>

              <Input
                  name="appleStore"
                  type="url"
                  placeholder="https://apps.apple.com/..."
                  className="h-11 rounded-xl"
              />
            </div>

            {/* Divider */}
            <div className="border-t" />

            {/* Configuration */}
            <div>
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Build Configuration
              </h3>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Target Platform</Label>

                  <Select
                      value={platform}
                      onValueChange={setPlatform}
                  >
                    <SelectTrigger className="h-11 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="flutter">
                        Flutter
                      </SelectItem>

                      <SelectItem value="react-native">
                        React Native
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Run Target</Label>

                  <Select
                      value={runTarget}
                      onValueChange={setRunTarget}
                  >
                    <SelectTrigger className="h-11 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="auto">
                        Auto Detect
                      </SelectItem>

                      <SelectItem value="emulator">
                        Virtual Emulator
                      </SelectItem>

                      <SelectItem value="real-device">
                        Real Device
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <motion.div
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
            >
              <Button
                  type="submit"
                  disabled={pending}
                  className="h-12 w-full rounded-xl gap-2 text-base"
              >
                {pending ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                    <Sparkles className="h-5 w-5" />
                )}

                Analyze & Build Application
              </Button>
            </motion.div>
          </form>
        </Card>

        {/* ========================= Device ========================= */}
        <Card className="overflow-hidden rounded-3xl border border-border/60 bg-card shadow-sm">
          <div className="border-b bg-gradient-to-r from-primary/5 via-background to-background px-6 py-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                  <Smartphone className="h-5 w-5 text-primary" />
                </div>

                <div>
                  <h2 className="font-display text-xl font-semibold">
                    Live Emulator
                  </h2>

                  <p className="text-sm text-muted-foreground">
                    Preview and run the generated application instantly.
                  </p>
                </div>
              </div>

              <Badge variant="secondary">
                {apkReady || webReady ? "Ready" : "Waiting"}
              </Badge>
            </div>
          </div>

          <div className="p-6">
            <DevicePanel
                projectId={projectId}
                apkReady={apkReady}
                webReady={webReady}
            />
          </div>
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
