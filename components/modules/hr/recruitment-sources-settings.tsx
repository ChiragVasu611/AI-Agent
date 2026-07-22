'use client';

import { useEffect, useState } from 'react';
import { Loader2, Mail, MessageCircle, Globe, Linkedin as LinkedinIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  saveCareerPortalSettings, saveLinkedinSettings, saveEmailSettings, saveWhatsappSettings,
  testEmailSource, fetchEmailNow, testWhatsappSource,
} from '@/app/hr/settings-actions';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  CareerPortalSettings, EmailSourceSettings, LinkedinSourceSettings, RecruitmentSourceSettings, WhatsappSourceSettings,
} from '@/lib/types';

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}

function EnableToggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Switch checked={enabled} onCheckedChange={onChange} />
      <Badge variant={enabled ? 'default' : 'secondary'}>{enabled ? 'Enabled' : 'Disabled'}</Badge>
    </div>
  );
}

export function RecruitmentSourcesSettings() {
  const [settings, setSettings] = useState<RecruitmentSourceSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/hr/recruitment-sources').then((r) => r.json()).then((d) => setSettings(d.settings)).finally(() => setLoading(false));
  }, []);

  if (loading || !settings) {
    return <Card className="border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">Loading recruitment source settings…</Card>;
  }

  return (
    <Card className="border-border bg-card/60 p-6 backdrop-blur">
      <h2 className="font-display text-lg font-semibold">Recruitment Sources</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure every channel that automatically feeds candidates into your recruitment pipeline. Nothing here is
        hardcoded — every value is stored per-account and takes effect immediately.
      </p>

      <Tabs defaultValue="career_portal" className="mt-5">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="career_portal" className="gap-1.5"><Globe className="h-3.5 w-3.5" /> Career Portal</TabsTrigger>
          <TabsTrigger value="linkedin" className="gap-1.5"><LinkedinIcon className="h-3.5 w-3.5" /> LinkedIn</TabsTrigger>
          <TabsTrigger value="email" className="gap-1.5"><Mail className="h-3.5 w-3.5" /> Email</TabsTrigger>
          <TabsTrigger value="whatsapp" className="gap-1.5"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</TabsTrigger>
        </TabsList>

        <TabsContent value="career_portal" className="mt-4">
          <CareerPortalForm initial={settings.careerPortal} />
        </TabsContent>
        <TabsContent value="linkedin" className="mt-4">
          <LinkedinForm initial={settings.linkedin} />
        </TabsContent>
        <TabsContent value="email" className="mt-4">
          <EmailForm initial={settings.email} />
        </TabsContent>
        <TabsContent value="whatsapp" className="mt-4">
          <WhatsappForm initial={settings.whatsapp} />
        </TabsContent>
      </Tabs>
    </Card>
  );
}

function CareerPortalForm({ initial }: { initial: CareerPortalSettings }) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function onSave() {
    setSaving(true);
    const res = await saveCareerPortalSettings(form);
    setSaving(false);
    if ((res as any)?.error) return toast.error((res as any).error);
    toast.success('Career Portal settings saved');
  }

  return (
    <div className="space-y-4">
      <EnableToggle enabled={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} />
      <Row>
        <Field label="Career Portal URL"><Input value={form.portalUrl} onChange={(e) => setForm({ ...form, portalUrl: e.target.value })} placeholder="https://careers.yourcompany.com" /></Field>
        <Field label="Company Name"><Input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="Your Company" /></Field>
        <Field label="Company Logo URL"><Input value={form.companyLogoUrl} onChange={(e) => setForm({ ...form, companyLogoUrl: e.target.value })} placeholder="https://…/logo.png" /></Field>
        <Field label="Default Application Status"><Input value={form.defaultApplicationStatus} onChange={(e) => setForm({ ...form, defaultApplicationStatus: e.target.value })} placeholder="applied" /></Field>
        <Field label="Supported Resume Types (comma-separated)"><Input value={form.supportedResumeTypes.join(', ')} onChange={(e) => setForm({ ...form, supportedResumeTypes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="pdf, docx" /></Field>
        <Field label="Maximum Resume Size (MB)"><Input type="number" value={form.maxResumeSizeMb} onChange={(e) => setForm({ ...form, maxResumeSizeMb: Number(e.target.value) })} /></Field>
      </Row>
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm"><Switch checked={form.resumeUploadEnabled} onCheckedChange={(v) => setForm({ ...form, resumeUploadEnabled: v })} /> Resume Upload Enabled</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={form.autoResumeParsing} onCheckedChange={(v) => setForm({ ...form, autoResumeParsing: v })} /> Auto Resume Parsing</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={form.autoAiScreening} onCheckedChange={(v) => setForm({ ...form, autoAiScreening: v })} /> Auto AI Screening</label>
      </div>
      <Button onClick={onSave} disabled={saving} className="gap-2">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save Career Portal Settings</Button>
    </div>
  );
}

function LinkedinForm({ initial }: { initial: LinkedinSourceSettings }) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function onSave() {
    setSaving(true);
    const res = await saveLinkedinSettings(form);
    setSaving(false);
    if ((res as any)?.error) return toast.error((res as any).error);
    toast.success('LinkedIn settings saved');
  }

  return (
    <div className="space-y-4">
      <EnableToggle enabled={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} />
      <p className="text-xs text-muted-foreground">
        The system never fetches resumes directly from LinkedIn. Post a job&apos;s Career Portal apply link on
        LinkedIn with <code>?utm_source=linkedin</code> (use the &quot;Copy LinkedIn Link&quot; button on any job) —
        applications through that link are automatically tagged <strong>Application Source = LinkedIn</strong>.
      </p>
      <Row>
        <Field label="LinkedIn Company Page URL"><Input value={form.companyPageUrl} onChange={(e) => setForm({ ...form, companyPageUrl: e.target.value })} placeholder="https://linkedin.com/company/…" /></Field>
        <Field label="LinkedIn Careers Page URL"><Input value={form.careersPageUrl} onChange={(e) => setForm({ ...form, careersPageUrl: e.target.value })} placeholder="https://linkedin.com/company/…/jobs" /></Field>
        <Field label="Default Apply URL"><Input value={form.defaultApplyUrl} onChange={(e) => setForm({ ...form, defaultApplyUrl: e.target.value })} placeholder="https://careers.yourcompany.com" /></Field>
        <Field label="Campaign Name"><Input value={form.campaignName} onChange={(e) => setForm({ ...form, campaignName: e.target.value })} placeholder="2026-spring-hiring" /></Field>
        <Field label="Source Name"><Input value={form.sourceName} onChange={(e) => setForm({ ...form, sourceName: e.target.value })} placeholder="linkedin" /></Field>
      </Row>
      <label className="flex items-center gap-2 text-sm"><Switch checked={form.utmTrackingEnabled} onCheckedChange={(v) => setForm({ ...form, utmTrackingEnabled: v })} /> UTM / Source Tracking Enabled</label>
      <Button onClick={onSave} disabled={saving} className="gap-2">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save LinkedIn Settings</Button>
    </div>
  );
}

function EmailForm({ initial }: { initial: EmailSourceSettings }) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [fetching, setFetching] = useState(false);

  async function onSave() {
    setSaving(true);
    const res = await saveEmailSettings(form);
    setSaving(false);
    if ((res as any)?.error) return toast.error((res as any).error);
    toast.success('Email settings saved');
  }

  async function onTest() {
    setTesting(true);
    const res = await testEmailSource();
    setTesting(false);
    if ((res as any)?.error) return toast.error((res as any).error);
    if ((res as any).ok) toast.success((res as any).message);
    else toast.error((res as any).message);
  }

  async function onFetchNow() {
    setFetching(true);
    const res: any = await fetchEmailNow();
    setFetching(false);
    if (res?.error) return toast.error(res.error);
    toast.success(`Scanned ${res.scanned}, ingested ${res.ingested}, skipped ${res.skipped}${res.errors?.length ? `, ${res.errors.length} error(s)` : ''}.`);
  }

  return (
    <div className="space-y-4">
      <EnableToggle enabled={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} />
      <p className="text-xs text-muted-foreground">
        This environment has no persistent background worker, so continuous monitoring is realized via the manual
        &quot;Fetch Now&quot; action below — wire a real cron to call it on an interval for true 24/7 monitoring in production.
      </p>
      <Row>
        <Field label="Recruitment Email Address"><Input value={form.emailAddress} onChange={(e) => setForm({ ...form, emailAddress: e.target.value })} placeholder="careers@yourcompany.com" /></Field>
        <Field label="Display Name"><Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="Careers Team" /></Field>
        <Field label="Incoming Mail Server"><Input value={form.incomingServer} onChange={(e) => setForm({ ...form, incomingServer: e.target.value })} placeholder="imap.yourprovider.com" /></Field>
        <Field label="Port"><Input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} /></Field>
        <Field label="Username"><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
        <Field label="Password / App Password"><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        <Field label="Inbox Folder"><Input value={form.inboxFolder} onChange={(e) => setForm({ ...form, inboxFolder: e.target.value })} placeholder="INBOX" /></Field>
        <Field label="Fetch Interval (minutes)"><Input type="number" value={form.fetchIntervalMinutes} onChange={(e) => setForm({ ...form, fetchIntervalMinutes: Number(e.target.value) })} /></Field>
        <Field label="Allowed Resume Types (comma-separated)"><Input value={form.allowedResumeTypes.join(', ')} onChange={(e) => setForm({ ...form, allowedResumeTypes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></Field>
        <Field label="Maximum Attachment Size (MB)"><Input type="number" value={form.maxAttachmentSizeMb} onChange={(e) => setForm({ ...form, maxAttachmentSizeMb: Number(e.target.value) })} /></Field>
      </Row>
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm"><Switch checked={form.useSsl} onCheckedChange={(v) => setForm({ ...form, useSsl: v })} /> SSL/TLS</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={form.autoResumeParsing} onCheckedChange={(v) => setForm({ ...form, autoResumeParsing: v })} /> Auto Resume Parsing</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={form.autoCandidateCreation} onCheckedChange={(v) => setForm({ ...form, autoCandidateCreation: v })} /> Auto Candidate Creation</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={form.autoAiScreening} onCheckedChange={(v) => setForm({ ...form, autoAiScreening: v })} /> Auto AI Screening</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={form.duplicateDetection} onCheckedChange={(v) => setForm({ ...form, duplicateDetection: v })} /> Duplicate Detection</label>
      </div>
      {form.lastTestResult && <p className="text-xs text-muted-foreground">Last test: {form.lastTestResult}</p>}
      {form.lastFetchedAt && <p className="text-xs text-muted-foreground">Last fetched: {new Date(form.lastFetchedAt).toLocaleString()}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={onSave} disabled={saving} className="gap-2">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save Email Settings</Button>
        <Button type="button" variant="outline" onClick={onTest} disabled={testing} className="gap-2">{testing && <Loader2 className="h-4 w-4 animate-spin" />} Test Connection</Button>
        <Button type="button" variant="outline" onClick={onFetchNow} disabled={fetching} className="gap-2">{fetching && <Loader2 className="h-4 w-4 animate-spin" />} Fetch Now</Button>
      </div>
    </div>
  );
}

function WhatsappForm({ initial }: { initial: WhatsappSourceSettings }) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/hr/recruitment-sources/whatsapp/webhook`);
  }, []);

  async function onSave() {
    setSaving(true);
    const res = await saveWhatsappSettings(form);
    setSaving(false);
    if ((res as any)?.error) return toast.error((res as any).error);
    toast.success('WhatsApp settings saved');
  }

  async function onTest() {
    setTesting(true);
    const res = await testWhatsappSource();
    setTesting(false);
    if ((res as any)?.error) return toast.error((res as any).error);
    if ((res as any).ok) toast.success((res as any).message);
    else toast.error((res as any).message);
  }

  return (
    <div className="space-y-4">
      <EnableToggle enabled={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} />
      <p className="text-xs text-muted-foreground">
        No paid WhatsApp Business API key is used here. Point any provider&apos;s webhook (Meta Cloud API, Twilio, etc.)
        at the URL below once you have your own credentials, and resumes will flow into the same pipeline automatically.
      </p>
      <Field label="Webhook URL (give this to your WhatsApp Business API provider)">
        <Input readOnly value={webhookUrl} onFocus={(e) => e.currentTarget.select()} />
      </Field>
      <Row>
        <Field label="Recruitment WhatsApp Number"><Input value={form.whatsappNumber} onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value })} placeholder="+1 555 000 1234" /></Field>
        <Field label="WhatsApp Display Name"><Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="Careers Team" /></Field>
        <Field label="WhatsApp Invite Link"><Input value={form.inviteLink} onChange={(e) => setForm({ ...form, inviteLink: e.target.value })} placeholder="https://wa.me/…" /></Field>
        <Field label="Supported Resume Types (comma-separated)"><Input value={form.supportedResumeTypes.join(', ')} onChange={(e) => setForm({ ...form, supportedResumeTypes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></Field>
        <Field label="Maximum File Size (MB)"><Input type="number" value={form.maxFileSizeMb} onChange={(e) => setForm({ ...form, maxFileSizeMb: Number(e.target.value) })} /></Field>
      </Row>
      <Field label="Resume Submission Instructions"><Textarea value={form.submissionInstructions} onChange={(e) => setForm({ ...form, submissionInstructions: e.target.value })} placeholder="Send us your resume as a PDF or DOCX file." /></Field>
      <Field label="Welcome Message"><Textarea value={form.welcomeMessage} onChange={(e) => setForm({ ...form, welcomeMessage: e.target.value })} placeholder="Thanks for reaching out about our openings!" /></Field>
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm"><Switch checked={form.autoReply} onCheckedChange={(v) => setForm({ ...form, autoReply: v })} /> Auto Reply</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={form.resumeProcessingEnabled} onCheckedChange={(v) => setForm({ ...form, resumeProcessingEnabled: v })} /> Resume Processing Enabled</label>
      </div>
      {form.lastTestResult && <p className="text-xs text-muted-foreground">Last test: {form.lastTestResult}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={onSave} disabled={saving} className="gap-2">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save WhatsApp Settings</Button>
        <Button type="button" variant="outline" onClick={onTest} disabled={testing} className="gap-2">{testing && <Loader2 className="h-4 w-4 animate-spin" />} Test Configuration</Button>
      </div>
    </div>
  );
}
