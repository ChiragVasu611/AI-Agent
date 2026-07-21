'use client';

import { useState, useTransition } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createJob } from '@/app/hr/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useRouter } from 'next/navigation';

export function CreateJobDialog({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [employmentType, setEmploymentType] = useState('full_time');
  const [workMode, setWorkMode] = useState('onsite');
  const [priority, setPriority] = useState('medium');
  const router = useRouter();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set('employmentType', employmentType);
    formData.set('workMode', workMode);
    formData.set('priority', priority);

    startTransition(async () => {
      const res = await createJob(formData);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success('Job created');
      setOpen(false);
      onCreated?.();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" /> Create Job</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Job</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="title">Job Title *</Label>
              <Input id="title" name="title" required placeholder="Senior Frontend Engineer" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="department">Department *</Label>
              <Input id="department" name="department" required placeholder="Engineering" />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Employment Type</Label>
              <Select value={employmentType} onValueChange={setEmploymentType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time">Full-time</SelectItem>
                  <SelectItem value="part_time">Part-time</SelectItem>
                  <SelectItem value="contract">Contract</SelectItem>
                  <SelectItem value="internship">Internship</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Work Mode</Label>
              <Select value={workMode} onValueChange={setWorkMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="onsite">Onsite</SelectItem>
                  <SelectItem value="remote">Remote</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Experience Required (years)</Label>
              <div className="flex items-center gap-2">
                <Input name="experienceMinYears" type="number" min={0} placeholder="Min" defaultValue={0} />
                <span className="text-xs text-muted-foreground">to</span>
                <Input name="experienceMaxYears" type="number" min={0} placeholder="Max" defaultValue={0} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Salary Range</Label>
              <div className="flex items-center gap-2">
                <Input name="salaryMin" type="number" min={0} placeholder="Min" />
                <span className="text-xs text-muted-foreground">-</span>
                <Input name="salaryMax" type="number" min={0} placeholder="Max" />
                <Input name="salaryCurrency" defaultValue="USD" className="w-20" />
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Required Skills (comma separated)</Label>
              <Input name="requiredSkills" placeholder="React, TypeScript, Node.js" />
            </div>
            <div className="space-y-1.5">
              <Label>Preferred Skills (comma separated)</Label>
              <Input name="preferredSkills" placeholder="GraphQL, AWS" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Job Description</Label>
            <Textarea name="description" rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label>Responsibilities</Label>
            <Textarea name="responsibilities" rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>Qualifications</Label>
            <Textarea name="qualifications" rows={2} placeholder="Bachelor's degree in Computer Science or related field" />
          </div>
          <div className="space-y-1.5">
            <Label>Benefits</Label>
            <Textarea name="benefits" rows={2} />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="hiringManager">Hiring Manager *</Label>
              <Input id="hiringManager" name="hiringManager" required placeholder="Jordan Rivera" />
            </div>
            <div className="space-y-1.5">
              <Label>Number of Openings</Label>
              <Input name="openings" type="number" min={1} defaultValue={1} />
            </div>
            <div className="space-y-1.5">
              <Label>Closing Date</Label>
              <Input name="closingDate" type="date" />
            </div>
          </div>

          <Button type="submit" disabled={pending} className="w-full gap-2">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} Create Job
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
