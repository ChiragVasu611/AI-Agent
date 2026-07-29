'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Play, RefreshCw, Trash2, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { startTestExecution, startInstalledAppExecution } from '@/app/qa/actions';
import { submitBinaryRun } from '@/lib/qa/submit-binary-run';
import { SelectedDeviceBanner } from '@/components/modules/qa/selected-device-banner';
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
  { value: 'installed_app', label: 'Installed App (on connected device)' },
  { value: 'ipa', label: 'iOS IPA (.ipa)' },
  { value: 'flutter', label: 'Flutter App' },
  { value: 'web_app', label: 'Web App' },
  { value: 'play_store_url', label: 'Play Store URL' },
  { value: 'app_store_url', label: 'App Store URL' },
  { value: 'web_url', label: 'Web URL' },
];

const BINARY_EXTENSIONS: Record<string, string> = { apk: '.apk', ipa: '.ipa' };

export default function TestExecutionPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sourceType, setSourceType] = useState('web_url');
  const [selectedModules, setSelectedModules] = useState<string[]>(DEFAULT_SMOKE_MODULES);
  const [runs, setRuns] = useState<any[]>([]);
  const [appFileName, setAppFileName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [deviceId, setDeviceId] = useState('auto');
  // Installed-app picker state.
  const [installedApps, setInstalledApps] = useState<any[] | null>(null);
  const [loadingApps, setLoadingApps] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState('');
  const [appFilter, setAppFilter] = useState('');
  const [resetAppData, setResetAppData] = useState(false);

  const isInstalledAppSource = sourceType === 'installed_app';
  // An uploaded APK and an installed-app selection are mutually exclusive: the
  // upload control is only rendered when we are NOT in installed-app mode, and
  // the picker only when we are — so neither can be active at the same time.
  const isBinarySource = !isInstalledAppSource && sourceType in BINARY_EXTENSIONS;
  // Only a real .apk can be installed on a device via `adb install`.
  const supportsRealDevice = sourceType === 'apk';
  const hasDevice = devices.length > 0;
  const selectedApp = installedApps?.find((a) => a.packageName === selectedPackage) ?? null;

  async function onDeleteRun(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm('Permanently delete this test run and all of its execution data (results, screenshots, logs, bugs)? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/qa/runs/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to delete test run');
        return;
      }
      setRuns((prev) => prev.filter((r) => r.id !== id));
      toast.success('Test run permanently deleted');
    } finally {
      setDeletingId(null);
    }
  }

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

  // Poll connected devices so an APK can be targeted at a real phone.
  useEffect(() => {
    let cancelled = false;
    async function loadDevices() {
      try {
        const res = await fetch('/api/qa/devices');
        const data = await res.json();
        if (!cancelled) {
          setDevices((data.devices ?? []).filter((d: any) => d.state === 'online' && d.platform === 'android'));
        }
      } catch { /* ignore */ }
    }
    loadDevices();
    const interval = setInterval(loadDevices, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  function toggleModule(key: string) {
    setSelectedModules((prev) => (prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]));
  }

  /** Reads the user-installed apps off the selected (or first online) device. */
  async function onLoadApps() {
    setLoadingApps(true);
    try {
      const serial = deviceId !== 'auto' && deviceId !== 'simulated' ? deviceId : '';
      const res = await fetch(`/api/qa/devices/apps${serial ? `?serial=${encodeURIComponent(serial)}` : ''}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Could not load installed apps.');
        return;
      }
      setInstalledApps(data.apps ?? []);
      if ((data.apps ?? []).length === 0) toast.info('No user-installed apps found on this device.');
    } catch {
      toast.error('Could not reach the device. Check that it is still connected.');
    } finally {
      setLoadingApps(false);
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set('sourceType', sourceType);
    selectedModules.forEach((m) => formData.append('modules', m));
    if (supportsRealDevice || isInstalledAppSource) formData.set('deviceId', deviceId === 'auto' ? '' : deviceId);
    else formData.set('deviceId', 'simulated');

    // Installed app: no upload, so this goes to its own action which attaches to
    // the package already on the device.
    if (isInstalledAppSource) {
      if (!selectedPackage) {
        toast.error('Click "Load Apps" and select an installed app to test.');
        return;
      }
      formData.set('packageName', selectedPackage);
      formData.set('appVersionName', selectedApp?.versionName ?? '');
      if (resetAppData) formData.set('resetAppData', 'on');
      else formData.delete('resetAppData');
      startTransition(async () => {
        const res = await startInstalledAppExecution(formData);
        if (res?.error) { toast.error(res.error); return; }
        toast.success('Test execution started');
        router.push(`/qa/runs/${res.runId}`);
      });
      return;
    }

    startTransition(async () => {
      // Binary APK/AAB/IPA uploads go through a Route Handler instead of this
      // server action, since server actions in this Next.js version cap request
      // bodies at 1MB — far too small for a real app binary.
      const res = isBinarySource
        ? await submitBinaryRun(formData)
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

          {isInstalledAppSource ? (
            /* Installed-app picker. Rendered INSTEAD of the upload control, so an
               uploaded APK and an installed-app selection can never both apply. */
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="deviceId">Device</Label>
                <Select
                  value={deviceId}
                  onValueChange={(v) => { setDeviceId(v); setInstalledApps(null); setSelectedPackage(''); }}
                >
                  <SelectTrigger id="deviceId"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto — first connected device{devices.length ? ` (${devices.length} online)` : ''}</SelectItem>
                    {devices.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name} · {d.osVersion}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  disabled={!hasDevice || loadingApps}
                  onClick={onLoadApps}
                >
                  {loadingApps ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {installedApps ? 'Reload Apps' : 'Load Apps'}
                </Button>
                {installedApps && (
                  <span className="text-xs text-muted-foreground">{installedApps.length} app(s) found</span>
                )}
              </div>

              {!hasDevice && (
                <p className="text-xs text-amber-500">
                  Connect a device with USB debugging enabled to load its installed apps.
                </p>
              )}

              {installedApps && installedApps.length > 0 && (
                <div className="space-y-2">
                  <Input
                    placeholder="Filter apps…"
                    value={appFilter}
                    onChange={(e) => setAppFilter(e.target.value)}
                  />
                  <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-1.5">
                    {installedApps
                      .filter((a) => a.packageName.toLowerCase().includes(appFilter.toLowerCase()))
                      .map((a) => (
                        <label
                          key={a.packageName}
                          className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-xs transition hover:bg-secondary/50 ${
                            selectedPackage === a.packageName ? 'bg-primary/10 ring-1 ring-primary/30' : ''
                          }`}
                        >
                          <input
                            type="radio"
                            name="installedApp"
                            className="h-3.5 w-3.5 accent-primary"
                            checked={selectedPackage === a.packageName}
                            onChange={() => setSelectedPackage(a.packageName)}
                          />
                          <span className="min-w-0 flex-1 truncate font-mono" title={a.packageName}>{a.packageName}</span>
                          {a.versionName && (
                            <Badge variant="secondary" className="shrink-0 text-[10px]">v{a.versionName}</Badge>
                          )}
                        </label>
                      ))}
                  </div>
                </div>
              )}

              {selectedPackage && (
                <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
                  <p className="text-xs">
                    Testing installed app <span className="font-mono font-medium">{selectedPackage}</span>
                    {selectedApp?.versionName ? ` (v${selectedApp.versionName})` : ''}. No APK upload is needed —
                    remove the selection to upload a binary instead.
                  </p>
                  <label className="flex items-start gap-2 text-xs">
                    <Checkbox
                      checked={resetAppData}
                      onCheckedChange={(v) => setResetAppData(v === true)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">Reset app data before testing</span>
                      <span className="block text-[11px] text-destructive">
                        Warning: permanently deletes this app&apos;s existing data on the device (sign-ins, photos,
                        downloads) and revokes its permissions. Leave unchecked to test the app in its current state.
                      </span>
                    </span>
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setSelectedPackage('')}
                  >
                    Clear selection
                  </Button>
                </div>
              )}
            </div>
          ) : isBinarySource ? (
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

              {supportsRealDevice && (
                <div className="mt-2 space-y-1.5">
                  <Label htmlFor="deviceId">Run on device</Label>
                  <Select value={deviceId} onValueChange={setDeviceId}>
                    <SelectTrigger id="deviceId"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto — first connected device{devices.length ? ` (${devices.length} online)` : ''}</SelectItem>
                      {devices.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name} · {d.osVersion}</SelectItem>
                      ))}
                      <SelectItem value="simulated">Simulated (no real device)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {devices.length > 0
                      ? 'The APK will be installed and launched on the real device — screenshots and crash logs are captured live.'
                      : 'No device connected. The run will use the simulated engine. Connect a device in the Devices page for a real run.'}
                  </p>
                </div>
              )}
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

          <SelectedDeviceBanner show={isBinarySource || sourceType === 'play_store_url'} />

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
              <div key={r.id} className="flex items-center gap-3 py-3 transition hover:bg-secondary/50">
                <Link href={`/qa/runs/${r.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.project?.name ?? 'Unknown app'}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.modules?.length ?? 0} module(s) · {new Date(r.createdAt).toLocaleString()}
                    </div>
                  </div>
                  {r.status === 'running' && <span className="text-xs text-muted-foreground">{r.progress}%</span>}
                  <Badge variant="outline" className="text-xs capitalize">{r.status}</Badge>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete test run"
                  title="Delete test run permanently"
                  disabled={deletingId === r.id}
                  onClick={(e) => onDeleteRun(e, r.id)}
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                >
                  {deletingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
