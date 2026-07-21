'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { saveQaApiKey } from '@/app/qa/actions';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

export function QaApiKeySettings() {
  const [hasKey, setHasKey] = useState(false);
  const [tier, setTier] = useState<'free' | 'paid'>('free');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/qa/api-key').then((r) => r.json()).then((d) => {
      setHasKey(d.hasKey);
      if (d.tier) setTier(d.tier);
    });
  }, []);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await saveQaApiKey(apiKey, tier);
    setSaving(false);
    if (res.error) return toast.error(res.error);
    setHasKey(Boolean(apiKey.trim()));
    setApiKey('');
    toast.success(apiKey.trim() ? 'API key saved' : 'API key removed');
  }

  return (
    <Card className="border-border bg-card/60 p-6 backdrop-blur">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">AI Provider (QA Bug Detection)</h2>
        <Badge variant={hasKey ? 'default' : 'secondary'}>{hasKey ? `${tier} key set` : 'Using shared key'}</Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        AI-driven bug detection uses OpenRouter. Bring your own free or paid OpenRouter API key here, or leave this
        blank to use the platform&apos;s shared free-tier key. No paid API key is required or hardcoded.
      </p>
      <form onSubmit={onSave} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="qaApiKey">OpenRouter API Key</Label>
            <Input
              id="qaApiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasKey ? 'Key saved — enter a new key to replace it, or leave blank to remove' : 'sk-or-v1-…'}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Key Type</Label>
            <Select value={tier} onValueChange={(v) => setTier(v as 'free' | 'paid')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button type="submit" disabled={saving} className="gap-2">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save API Key
        </Button>
      </form>
    </Card>
  );
}
