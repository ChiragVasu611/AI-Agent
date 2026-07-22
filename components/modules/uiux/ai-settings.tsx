'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { saveUiuxAiSettings } from '@/app/designer/actions';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

export function UiuxAiSettings() {
  const [hasKey, setHasKey] = useState(false);
  const [tier, setTier] = useState<'free' | 'paid'>('free');
  const [apiKey, setApiKey] = useState('');
  const [aiEnabled, setAiEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/designer/ai-settings').then((r) => r.json()).then((d) => {
      setHasKey(d.hasKey);
      if (d.tier) setTier(d.tier);
      setAiEnabled(d.aiEnabled ?? true);
    });
  }, []);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await saveUiuxAiSettings(apiKey, tier, aiEnabled);
    setSaving(false);
    if ((res as any)?.error) return toast.error((res as any).error);
    setHasKey(Boolean(apiKey.trim()));
    setApiKey('');
    toast.success('AI settings saved');
  }

  return (
    <Card className="border-border bg-card/60 p-6 backdrop-blur">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">AI Generation Settings</h2>
        <Badge variant={aiEnabled ? (hasKey ? 'default' : 'secondary') : 'outline'}>
          {aiEnabled ? (hasKey ? `${tier} key set` : 'Using shared key') : 'Deterministic engine only'}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        The UI/UX Designer works completely without any API key — every stage has a built-in deterministic
        design engine. Bringing your own free or paid OpenRouter key here (or leaving it blank to use the
        platform&apos;s shared free-tier key) only enriches the output; it is never required.
      </p>

      <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-secondary/30 p-3">
        <Switch checked={aiEnabled} onCheckedChange={setAiEnabled} />
        <div>
          <div className="text-sm font-medium">Use AI-enhanced generation</div>
          <div className="text-xs text-muted-foreground">
            Off = always use the local deterministic design engine, even if a key is configured.
          </div>
        </div>
      </div>

      <form onSubmit={onSave} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="uiuxApiKey">OpenRouter API Key (optional)</Label>
            <Input
              id="uiuxApiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasKey ? 'Key saved — enter a new key to replace it, or leave blank to remove' : 'sk-or-v1-… (optional)'}
              disabled={!aiEnabled}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Key Type</Label>
            <Select value={tier} onValueChange={(v) => setTier(v as 'free' | 'paid')}>
              <SelectTrigger disabled={!aiEnabled}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button type="submit" disabled={saving} className="gap-2">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save AI Settings
        </Button>
      </form>
    </Card>
  );
}
