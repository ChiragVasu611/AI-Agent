'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, Loader2, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { submitCareerPortalApplication } from '@/app/careers/actions';
import { Button } from '@/components/ui/button';

export function ApplyForm({ jobId, source, utmSource, utmCampaign }: {
  jobId: string;
  source: 'career_portal' | 'linkedin';
  utmSource?: string;
  utmCampaign?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [fileName, setFileName] = useState('');
  const [done, setDone] = useState<{ duplicate: boolean } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set('jobId', jobId);
    formData.set('source', source);
    if (utmSource) formData.set('utmSource', utmSource);
    if (utmCampaign) formData.set('utmCampaign', utmCampaign);

    startTransition(async () => {
      const res = await submitCareerPortalApplication(formData);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      setDone({ duplicate: Boolean(res?.duplicate) });
    });
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card/60 p-8 text-center backdrop-blur">
        <CheckCircle2 className="h-10 w-10 text-emerald-500" />
        <h2 className="font-display text-lg font-semibold">Application received</h2>
        <p className="text-sm text-muted-foreground">
          {done.duplicate
            ? 'We already had a resume on file for you — your profile has been updated with this application.'
            : "Thanks for applying. Our team will review your profile and reach out if there's a match."}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-border bg-card/60 p-6 backdrop-blur">
      {source === 'linkedin' && (
        <p className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">Applying via LinkedIn</p>
      )}
      <div className="space-y-1.5">
        <label htmlFor="resume" className="text-sm font-medium">Resume (PDF or DOCX) *</label>
        <label
          htmlFor="resume"
          className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground transition hover:bg-secondary/40"
        >
          <UploadCloud className="h-5 w-5 flex-shrink-0" />
          {fileName ? <span className="text-foreground">{fileName}</span> : <span>Click to upload your resume, or drag it here.</span>}
          <input
            id="resume"
            name="resume"
            type="file"
            accept=".pdf,.docx"
            required
            className="hidden"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
          />
        </label>
      </div>
      <Button type="submit" disabled={pending} className="w-full gap-2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Submit Application
      </Button>
    </form>
  );
}
