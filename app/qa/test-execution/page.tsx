'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Play, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { startTestExecution } from '@/app/qa/actions';
import { QA_MODULES, DEFAULT_SMOKE_MODULES } from '@/lib/qa/modules';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const SOURCE_TYPES = [
  { value: 'apk', label: 'Android APK (.apk)' },
  { value: 'aab', label: 'Android App Bundle (.aab)' },
  { value: 'ipa', label: 'iOS IPA (.ipa)' },
  { value: 'flutter', label: 'Flutter App' },
  { value: 'react_native', label: 'React Native App' },
  { value: 'hybrid', label: 'Hybrid App' },
  { value: 'web_app', label: 'Web App' },
  { value: 'play_store_url', label: 'Play Store URL' },
  { value: 'app_store_url', label: 'App Store URL' },
  { value: 'web_url', label: 'Web URL' },
];

const BINARY_EXTENSIONS: Record<string, string> = { apk: '.apk', aab: '.aab', ipa: '.ipa' };

export default function TestExecutionPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sourceType, setSourceType] = useState('web_url');
  const [selectedModules, setSelectedModules] = useState<string[]>(DEFAULT_SMOKE_MODULES);
  const [runs, setRuns] = useState<any[]>([]);
  const [appFileName, setAppFileName] = useState('');
  const isBinarySource = sourceType in BINARY_EXTENSIONS;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch('/api/qa/runs?limit=20');
      const data = await res.json();
      if (!cancelled) setRuns(data.runs ?? []);
    }
    load();
    const interval = setInterval(load, 4000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  function toggleModule(key: string) {
    setSelectedModules((prev) => (prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set('sourceType', sourceType);
    selectedModules.forEach((m) => formData.append('modules', m));

    startTransition(async () => {
      // Binary APK/AAB/IPA uploads go through a Route Handler instead of this
      // server action, since server actions in this Next.js version cap request
      // bodies at 1MB — far too small for a real app binary.
      const res = isBinarySource
        ? await fetch('/api/qa/runs/start-binary', { method: 'POST', body: formData }).then((r) => r.json())
        : await startTestExecution(formData);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success('Test execution started');
      router.push(`/qa/runs/${res.runId}`);
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Test Execution</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Submit an app under test and choose which QA modules to run. Execution starts immediately and streams live.
        </p>
      </div>

      <Card className="border-border bg-card/60 p-6 backdrop-blur">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Source Type</Label>
              <Select value={sourceType} onValueChange={(v) => { setSourceType(v); setAppFileName(''); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCE_TYPES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">App Name (optional)</Label>
              <Input id="name" name="name" placeholder="My Shopping App" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="buildVersion">Build Version</Label>
            <Input id="buildVersion" name="buildVersion" placeholder="1.0.0" defaultValue="1.0.0" />
          </div>

          {isBinarySource ? (
            <div className="space-y-1.5">
              <Label htmlFor="appFile">Upload {BINARY_EXTENSIONS[sourceType]} file *</Label>
              <label
                htmlFor="appFile"
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground transition hover:bg-secondary/40"
              >
                <UploadCloud className="h-5 w-5 flex-shrink-0" />
                {appFileName ? (
                  <span className="text-foreground">{appFileName}</span>
                ) : (
                  <span>Click to upload your {BINARY_EXTENSIONS[sourceType]} file, or drag it here.</span>
                )}
                <input
                  id="appFile"
                  name="appFile"
                  type="file"
                  accept={BINARY_EXTENSIONS[sourceType]}
                  required
                  className="hidden"
                  onChange={(e) => setAppFileName(e.target.files?.[0]?.name ?? '')}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Real package/bundle ID, display name, and version are extracted automatically from the uploaded binary.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="sourceRef">File name or URL *</Label>
              <Input
                id="sourceRef"
                name="sourceRef"
                required
                placeholder="app-release.apk, https://play.google.com/store/apps/details?id=..., or https://example.com"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Testing Modules</Label>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {QA_MODULES.map((m) => (
                <label key={m.key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs">
                  <Checkbox checked={selectedModules.includes(m.key)} onCheckedChange={() => toggleModule(m.key)} />
                  {m.label}
                </label>
              ))}
            </div>
          </div>

          <Button type="submit" disabled={pending} className="gap-2">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Start Test Execution
          </Button>
        </form>
      </Card>

      <Card className="border-border bg-card/40 p-6 backdrop-blur">
        <h2 className="mb-3 font-display text-lg font-semibold">Test Runs</h2>
        {runs.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No test runs yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {runs.map((r) => (
              <Link key={r.id} href={`/qa/runs/${r.id}`} className="flex items-center gap-3 py-3 transition hover:bg-secondary/50">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.project?.name ?? 'Unknown app'}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.modules?.length ?? 0} module(s) · {new Date(r.createdAt).toLocaleString()}
                  </div>
                </div>
                {r.status === 'running' && <span className="text-xs text-muted-foreground">{r.progress}%</span>}
                <Badge variant="outline" className="text-xs capitalize">{r.status}</Badge>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
