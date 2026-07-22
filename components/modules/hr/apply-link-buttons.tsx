'use client';

import { Link as LinkIcon, Linkedin } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function ApplyLinkButtons({ jobId, campaignName }: { jobId: string; campaignName?: string }) {
  function copy(url: string, label: string) {
    navigator.clipboard.writeText(url);
    toast.success(`${label} copied to clipboard`);
  }

  function applyUrl() {
    return `${window.location.origin}/careers/${jobId}/apply`;
  }

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => copy(applyUrl(), 'Apply link')}>
        <LinkIcon className="h-3.5 w-3.5" /> Copy Apply Link
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => {
          const params = new URLSearchParams({ utm_source: 'linkedin', ...(campaignName ? { utm_campaign: campaignName } : {}) });
          copy(`${applyUrl()}?${params.toString()}`, 'LinkedIn apply link');
        }}
      >
        <Linkedin className="h-3.5 w-3.5" /> Copy LinkedIn Link
      </Button>
    </div>
  );
}
