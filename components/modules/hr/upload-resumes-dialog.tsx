'use client';

import { useState, useTransition } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { uploadResumes } from '@/app/hr/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';

export function UploadResumesDialog({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [files, setFiles] = useState<File[]>([]);
  const router = useRouter();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (files.length === 0) {
      toast.error('Select at least one PDF or DOCX resume.');
      return;
    }
    const formData = new FormData();
    files.forEach((f) => formData.append('resumes', f));

    startTransition(async () => {
      const res = await uploadResumes(jobId, formData);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      const failed = res.results?.filter((r: any) => r.error) ?? [];
      const succeeded = res.results?.filter((r: any) => r.candidateId) ?? [];
      if (succeeded.length) toast.success(`Screened ${succeeded.length} resume(s).`);
      failed.forEach((f: any) => toast.error(`${f.fileName}: ${f.error}`));
      setOpen(false);
      setFiles([]);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2"><Upload className="h-4 w-4" /> Upload Resumes</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Resumes</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Upload multiple PDF or DOCX resumes. Each will be parsed, screened against this job, and scored automatically.
          </p>
          <input
            type="file"
            accept=".pdf,.docx"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:font-medium file:text-primary-foreground"
          />
          {files.length > 0 && (
            <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-muted-foreground">
              {files.map((f) => <li key={f.name}>• {f.name}</li>)}
            </ul>
          )}
          <Button type="submit" disabled={pending} className="w-full gap-2">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} Screen {files.length || ''} Resume{files.length === 1 ? '' : 's'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
