'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { saveSeoSettings } from '@/app/seo/actions';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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

interface Initial {
  defaultCountry: string; defaultLanguage: string; defaultProjectType: string; defaultReportFormat: string;
  notifyOnAuditComplete: boolean; notifyOnReportGenerated: boolean; notifyOnCriticalIssue: boolean;
  notifyOnOptimizationComplete: boolean; notifyOnProjectUpdated: boolean;
  seoAiEnabled: boolean; hasApiKey: boolean;
}

export function SettingsForm({ initial }: { initial: Initial }) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState(initial);
  const [apiKey, setApiKey] = useState('');

  function set<K extends keyof Initial>(key: K, value: Initial[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onSave() {
    startTransition(async () => {
      const res = await saveSeoSettings({
        defaultCountry: form.defaultCountry, defaultLanguage: form.defaultLanguage,
        defaultProjectType: form.defaultProjectType, defaultReportFormat: form.defaultReportFormat,
        notifyOnAuditComplete: form.notifyOnAuditComplete, notifyOnReportGenerated: form.notifyOnReportGenerated,
        notifyOnCriticalIssue: form.notifyOnCriticalIssue, notifyOnOptimizationComplete: form.notifyOnOptimizationComplete,
        notifyOnProjectUpdated: form.notifyOnProjectUpdated,
        seoAiEnabled: form.seoAiEnabled, seoOpenRouterApiKey: apiKey || null,
      });
      if (res?.error) { toast.error(res.error); return; }
      toast.success('Settings saved');
      setApiKey('');
    });
  }

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card/60 p-6 backdrop-blur">
        <h2 className="font-display text-lg font-semibold">Defaults</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="defaultCountry">Default Country</Label>
            <Input id="defaultCountry" value={form.defaultCountry} onChange={(e) => set('defaultCountry', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="defaultLanguage">Default Language</Label>
            <Input id="defaultLanguage" value={form.defaultLanguage} onChange={(e) => set('defaultLanguage', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Default Project Type</Label>
            <Select value={form.defaultProjectType} onValueChange={(v) => set('defaultProjectType', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PROJECT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Default Report Format</Label>
            <Select value={form.defaultReportFormat} onValueChange={(v) => set('defaultReportFormat', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pdf">PDF</SelectItem>
                <SelectItem value="excel">Excel</SelectItem>
                <SelectItem value="csv">CSV</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card className="border-border bg-card/60 p-6 backdrop-blur">
        <h2 className="font-display text-lg font-semibold">Notifications</h2>
        <div className="mt-4 space-y-3">
          {([
            ['notifyOnAuditComplete', 'New audit completed'],
            ['notifyOnReportGenerated', 'New report generated'],
            ['notifyOnCriticalIssue', 'Critical issue found'],
            ['notifyOnOptimizationComplete', 'Optimization task completed'],
            ['notifyOnProjectUpdated', 'Project updated'],
          ] as const).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between">
              <Label htmlFor={key} className="cursor-pointer font-normal">{label}</Label>
              <Switch id={key} checked={form[key]} onCheckedChange={(v) => set(key, v)} />
            </div>
          ))}
        </div>
      </Card>

      <Card className="border-border bg-card/60 p-6 backdrop-blur">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Optional AI Provider</h2>
          <Switch checked={form.seoAiEnabled} onCheckedChange={(v) => set('seoAiEnabled', v)} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {form.hasApiKey ? 'An OpenRouter key is currently saved.' : 'No key saved — using deterministic rule-based generation only.'} Bring your
          own free or paid OpenRouter key to enable model-generated analysis, keywords, and content. Leave blank to keep using
          deterministic generation, which always works with zero external dependencies.
        </p>
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="seoApiKey">OpenRouter API Key</Label>
          <Input
            id="seoApiKey" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            placeholder={form.hasApiKey ? 'Key saved — enter a new key to replace it' : 'sk-or-v1-…'}
          />
        </div>
      </Card>

      <Button onClick={onSave} disabled={pending} className="gap-2">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Save Settings
      </Button>
    </div>
  );
}
