'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  Award, Briefcase, FileText, Github, GraduationCap, Languages, Linkedin, Mail, Phone,
  MapPin, FolderGit2, Globe, Sparkles, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { updateCandidateNotes } from '@/app/dashboard/hr/actions';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { Application, Candidate, InterviewSession } from '@/lib/types';

const FLAG_LABEL: Record<string, string> = {
  duplicateResume: 'Duplicate Resume',
  fakeExperienceSuspected: 'Possible Fake Experience',
  employmentGap: 'Employment Gap',
  skillMismatch: 'Skill Mismatch',
  overqualified: 'Overqualified',
  underqualified: 'Underqualified',
};

const RECOMMENDATION_COLOR: Record<string, string> = {
  strong_hire: 'bg-success/15 text-success',
  hire: 'bg-primary/15 text-primary',
  consider: 'bg-amber-500/15 text-amber-600',
  reject: 'bg-destructive/15 text-destructive',
};

export function CandidateProfileClient({
  candidate, applications, interviews,
}: {
  candidate: Candidate;
  applications: (Application & { job?: { title: string; id: string } })[];
  interviews: InterviewSession[];
}) {
  const [notes, setNotes] = useState(candidate.notes ?? '');
  const [pending, startTransition] = useTransition();
  const latestApp = applications[0];

  function saveNotes() {
    startTransition(async () => {
      const res = await updateCandidateNotes(candidate.id, notes);
      if (res?.error) toast.error(res.error); else toast.success('Notes saved');
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <div className="flex items-start gap-4">
        <Avatar className="h-16 w-16">
          <AvatarFallback className="bg-primary/15 text-lg text-primary">{candidate.name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight">{candidate.name}</h1>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {candidate.email && <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {candidate.email}</span>}
            {candidate.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {candidate.phone}</span>}
            {candidate.address && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {candidate.address}</span>}
          </div>
          <div className="mt-2 flex gap-3 text-xs">
            {candidate.linkedinUrl && <a href={candidate.linkedinUrl} target="_blank" className="inline-flex items-center gap-1 text-primary hover:underline"><Linkedin className="h-3.5 w-3.5" /> LinkedIn</a>}
            {candidate.githubUrl && <a href={candidate.githubUrl} target="_blank" className="inline-flex items-center gap-1 text-primary hover:underline"><Github className="h-3.5 w-3.5" /> GitHub</a>}
            {candidate.portfolioUrl && <a href={candidate.portfolioUrl} target="_blank" className="inline-flex items-center gap-1 text-primary hover:underline"><Globe className="h-3.5 w-3.5" /> Portfolio</a>}
          </div>
        </div>
        {latestApp?.matchScore && (
          <Card className="border-border bg-card/60 p-4 text-center backdrop-blur">
            <div className="font-display text-3xl font-semibold text-primary">{latestApp.matchScore.overall}%</div>
            <div className="text-[11px] text-muted-foreground">AI Match Score</div>
            {latestApp.recommendation && (
              <Badge className={cn('mt-1.5 text-[10px] capitalize', RECOMMENDATION_COLOR[latestApp.recommendation])}>
                {latestApp.recommendation.replace('_', ' ')}
              </Badge>
            )}
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {latestApp?.matchScore && (
            <Card className="border-border bg-card/60 p-5 backdrop-blur">
              <h2 className="mb-3 font-display text-sm font-semibold">AI Resume Score</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  ['Overall Match', latestApp.matchScore.overall],
                  ['Skills Match', latestApp.matchScore.skills],
                  ['Experience', latestApp.matchScore.experience],
                  ['Education', latestApp.matchScore.education],
                  ['Certification', latestApp.matchScore.certification],
                  ['Communication', latestApp.matchScore.communication],
                ].map(([label, val]) => (
                  <div key={label as string} className="rounded-lg border border-border bg-secondary/30 p-3 text-center">
                    <div className="font-display text-xl font-semibold">{val}%</div>
                    <div className="text-[10px] text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>

              {latestApp.aiInsights && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-success">Strengths</div>
                    <div className="flex flex-wrap gap-1">
                      {latestApp.aiInsights.strengths.map((s) => <Badge key={s} className="bg-success/15 text-[10px] text-success">{s}</Badge>)}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold text-destructive">Missing Skills</div>
                    <div className="flex flex-wrap gap-1">
                      {latestApp.aiInsights.missingSkills.map((s) => <Badge key={s} className="bg-destructive/10 text-[10px] text-destructive">{s}</Badge>)}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold text-muted-foreground">Recommended Skills</div>
                    <div className="flex flex-wrap gap-1">
                      {latestApp.aiInsights.recommendedSkills.map((s) => <Badge key={s} variant="outline" className="text-[10px] font-normal">{s}</Badge>)}
                    </div>
                  </div>
                </div>
              )}

              {latestApp.flags && Object.values(latestApp.flags).some(Boolean) && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {Object.entries(latestApp.flags).filter(([, v]) => v).map(([k]) => (
                    <Badge key={k} className="bg-amber-500/15 text-[10px] text-amber-600">{FLAG_LABEL[k]}</Badge>
                  ))}
                </div>
              )}
            </Card>
          )}

          <Card className="border-border bg-card/60 p-5 backdrop-blur">
            <h2 className="mb-3 flex items-center gap-1.5 font-display text-sm font-semibold"><Briefcase className="h-4 w-4" /> Experience</h2>
            {candidate.experience.length === 0 ? <p className="text-sm text-muted-foreground">No experience extracted.</p> : (
              <div className="space-y-3">
                {candidate.experience.map((e, i) => (
                  <div key={i} className="border-l-2 border-primary/30 pl-3">
                    <div className="text-sm font-medium">{e.title || 'Role'} {e.company ? `at ${e.company}` : ''}</div>
                    <div className="text-xs text-muted-foreground">{e.startDate} - {e.endDate}</div>
                    {e.description && <p className="mt-1 text-xs text-muted-foreground">{e.description}</p>}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="border-border bg-card/60 p-5 backdrop-blur">
            <h2 className="mb-3 flex items-center gap-1.5 font-display text-sm font-semibold"><GraduationCap className="h-4 w-4" /> Education</h2>
            {candidate.education.length === 0 ? <p className="text-sm text-muted-foreground">No education extracted.</p> : (
              <div className="space-y-2">
                {candidate.education.map((e, i) => (
                  <div key={i} className="text-sm">
                    <span className="font-medium">{e.degree}</span> — {e.field} {e.startDate && `(${e.startDate} - ${e.endDate})`}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {candidate.projects.length > 0 && (
            <Card className="border-border bg-card/60 p-5 backdrop-blur">
              <h2 className="mb-3 flex items-center gap-1.5 font-display text-sm font-semibold"><FolderGit2 className="h-4 w-4" /> Projects</h2>
              <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                {candidate.projects.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </Card>
          )}

          <Card className="border-border bg-card/60 p-5 backdrop-blur">
            <h2 className="mb-3 flex items-center gap-1.5 font-display text-sm font-semibold"><Sparkles className="h-4 w-4" /> Interview History</h2>
            {interviews.length === 0 ? <p className="text-sm text-muted-foreground">No interviews conducted yet.</p> : (
              <div className="space-y-2">
                {interviews.map((session) => (
                  <Link
                    key={session.id}
                    href={`/dashboard/hr/interviews/${session.applicationId}`}
                    className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm transition hover:bg-secondary/50"
                  >
                    <span className="capitalize">{session.stage.replace('_', ' ')}</span>
                    <div className="flex items-center gap-2">
                      {session.overallScore != null && <span className="text-xs text-muted-foreground">{session.overallScore}/10</span>}
                      <Badge variant={session.status === 'completed' ? 'secondary' : 'outline'} className="text-[10px] capitalize">{session.status}</Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card className="border-border bg-card/60 p-5 backdrop-blur">
            <h2 className="mb-2 flex items-center gap-1.5 font-display text-sm font-semibold"><FileText className="h-4 w-4" /> Resume</h2>
            <p className="mb-2 text-xs text-muted-foreground">{candidate.resumeFileName ?? 'No resume on file'}</p>
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-secondary/30 p-3 text-xs text-muted-foreground">
              {candidate.resumeText?.slice(0, 4000) || 'No resume text extracted.'}
            </pre>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-border bg-card/60 p-5 backdrop-blur">
            <h2 className="mb-2 font-display text-sm font-semibold">Skills</h2>
            <div className="flex flex-wrap gap-1.5">
              {candidate.skills.length === 0 ? <p className="text-sm text-muted-foreground">No skills detected.</p> :
                candidate.skills.map((s) => <Badge key={s} variant="outline" className="text-xs font-normal">{s}</Badge>)}
            </div>
          </Card>

          {candidate.certifications.length > 0 && (
            <Card className="border-border bg-card/60 p-5 backdrop-blur">
              <h2 className="mb-2 flex items-center gap-1.5 font-display text-sm font-semibold"><Award className="h-4 w-4" /> Certifications</h2>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {candidate.certifications.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </Card>
          )}

          {candidate.languages.length > 0 && (
            <Card className="border-border bg-card/60 p-5 backdrop-blur">
              <h2 className="mb-2 flex items-center gap-1.5 font-display text-sm font-semibold"><Languages className="h-4 w-4" /> Languages</h2>
              <div className="flex flex-wrap gap-1.5">
                {candidate.languages.map((l) => <Badge key={l} variant="secondary" className="text-xs font-normal">{l}</Badge>)}
              </div>
            </Card>
          )}

          {candidate.companiesWorked.length > 0 && (
            <Card className="border-border bg-card/60 p-5 backdrop-blur">
              <h2 className="mb-2 font-display text-sm font-semibold">Previous Companies</h2>
              <div className="flex flex-wrap gap-1.5">
                {candidate.companiesWorked.map((c) => <Badge key={c} variant="outline" className="text-xs font-normal">{c}</Badge>)}
              </div>
            </Card>
          )}

          <Card className="border-border bg-card/60 p-5 backdrop-blur">
            <h2 className="mb-2 font-display text-sm font-semibold">Applications</h2>
            <div className="space-y-2">
              {applications.map((a) => (
                <Link key={a.id} href={a.job ? `/dashboard/hr/jobs/${a.job.id}` : '#'} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs transition hover:bg-secondary/50">
                  <span>{a.job?.title ?? 'Unknown job'}</span>
                  <Badge variant="outline" className="text-[10px] capitalize">{a.stage.replace('_', ' ')}</Badge>
                </Link>
              ))}
            </div>
          </Card>

          <Card className="border-border bg-card/60 p-5 backdrop-blur">
            <h2 className="mb-2 font-display text-sm font-semibold">Notes</h2>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Internal notes about this candidate…" />
            <Button size="sm" className="mt-2 gap-1.5" onClick={saveNotes} disabled={pending}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save Notes
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
