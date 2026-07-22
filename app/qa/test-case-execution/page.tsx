'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileSpreadsheet, Loader2, Play, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { startUploadedTestExecution } from '@/app/qa/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
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

const REQUIRED_COLUMNS = [
  'Test Case ID', 'Module', 'Feature', 'Test Scenario', 'Preconditions',
  'Test Steps', 'Test Data', 'Expected Result', 'Priority', 'Severity',
];

export default function TestCaseExecutionPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sourceType, setSourceType] = useState('web_url');
  const [fileName, setFileName] = useState('');
  const [appFileName, setAppFileName] = useState('');
  const isBinarySource = sourceType in BINARY_EXTENSIONS;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set('sourceType', sourceType);

    if (isBinarySource) formData.set('mode', 'uploaded');

    startTransition(async () => {
      // Binary APK/AAB/IPA uploads go through a Route Handler instead of this
      // server action, since server actions in this Next.js version cap request
      // bodies at 1MB — far too small for a real app binary.
      const res = isBinarySource
        ? await fetch('/api/qa/runs/start-binary', { method: 'POST', body: formData }).then((r) => r.json())
        : await startUploadedTestExecution(formData);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success('AI test case execution started');
      router.push(`/qa/runs/${res.runId}`);
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">AI Test Case Execution</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a test case sheet and the app under test. The AI reads every test case, executes it in order,
          follows each step, and validates the actual result against the expected result — automatically
          generating a bug report for every failure.
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="buildVersion">Build Version</Label>
              <Input id="buildVersion" name="buildVersion" placeholder="1.0.0" defaultValue="1.0.0" />
            </div>
            {!isBinarySource && (
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
          </div>

          {isBinarySource && (
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
          )}

          <div className="space-y-1.5">
            <Label htmlFor="testCaseFile">Test Case Sheet (.xlsx / .csv) *</Label>
            <label
              htmlFor="testCaseFile"
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground transition hover:bg-secondary/40"
            >
              <UploadCloud className="h-5 w-5 flex-shrink-0" />
              {fileName ? (
                <span className="flex items-center gap-2 text-foreground"><FileSpreadsheet className="h-4 w-4" /> {fileName}</span>
              ) : (
                <span>Click to upload your test case sheet, or drag it here.</span>
              )}
              <input
                id="testCaseFile"
                name="testCaseFile"
                type="file"
                accept=".xlsx,.xls,.csv"
                required
                className="hidden"
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Expected columns: {REQUIRED_COLUMNS.join(', ')}. Column order and casing are flexible — headers are matched automatically.
            </p>
          </div>

          <Button type="submit" disabled={pending} className="gap-2">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Start AI Test Case Execution
          </Button>
        </form>
      </Card>

      <Card className="border-border bg-card/40 p-6 backdrop-blur">
        <h2 className="mb-2 font-display text-sm font-semibold">How it works</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-xs text-muted-foreground">
          <li>Every row from your sheet is imported and executed in the exact order it appears.</li>
          <li>Each test step runs sequentially with the corresponding screen detected automatically.</li>
          <li>The AI compares the actual result against your Expected Result column for every case.</li>
          <li>Each case is marked Pass, Fail, Blocked, or Skipped — execution continues even after a failure.</li>
          <li>Every failure generates a full developer-ready bug report, viewable in Execution Reports.</li>
        </ol>
      </Card>
    </div>
  );
}
