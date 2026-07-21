'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2, Clock, FileText, Pause, Play, RotateCcw, Sparkles,
} from 'lucide-react';
import { submitInterviewFeedback } from '@/app/hr/actions';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { QUESTION_CATEGORY_LABEL } from '@/lib/hr/questions';
import type { Candidate, InterviewRatings, InterviewSession, Job, QuestionCategory } from '@/lib/types';

const RATING_DIMENSIONS: { key: keyof InterviewRatings; label: string }[] = [
  { key: 'technicalKnowledge', label: 'Technical Knowledge' },
  { key: 'communication', label: 'Communication' },
  { key: 'problemSolving', label: 'Problem Solving' },
  { key: 'leadership', label: 'Leadership' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'cultureFit', label: 'Culture Fit' },
  { key: 'learningAbility', label: 'Learning Ability' },
];

const CATEGORY_ORDER: QuestionCategory[] = ['hr', 'technical', 'behavioral', 'coding', 'scenario'];

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const RECOMMENDATION_COLOR: Record<string, string> = {
  strong_hire: 'bg-success/15 text-success',
  hire: 'bg-primary/15 text-primary',
  hold: 'bg-amber-500/15 text-amber-600',
  reject: 'bg-destructive/15 text-destructive',
};

export function InterviewRoom({
  session, candidate, job,
}: {
  session: InterviewSession;
  candidate: Candidate;
  job: Job;
}) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(session.durationSeconds ?? 0);
  const [liveNotes, setLiveNotes] = useState(session.liveNotes ?? '');
  const [ratings, setRatings] = useState<InterviewRatings>(session.ratings ?? {
    technicalKnowledge: 0, communication: 0, problemSolving: 0, leadership: 0, confidence: 0, cultureFit: 0, learningAbility: 0,
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ overallScore: number; recommendation: string; summary: string } | null>(
    session.status === 'completed' && session.overallScore != null
      ? { overallScore: session.overallScore, recommendation: session.recommendation ?? 'hold', summary: session.summary ?? '' }
      : null,
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running]);

  async function onSubmit() {
    setSubmitting(true);
    setRunning(false);
    const res = await submitInterviewFeedback(session.id, ratings, liveNotes, elapsed);
    setSubmitting(false);
    if (res?.error) {
      toast.error(res.error);
      return;
    }
    setResult({ overallScore: res.overallScore!, recommendation: res.recommendation!, summary: res.summary! });
    toast.success('Evaluation generated');
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Interview — {candidate.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{job.title} · {session.stage.replace('_', ' ')}</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card/60 px-4 py-2">
          <Clock className="h-4 w-4 text-primary" />
          <span className="font-display text-lg tabular-nums">{formatTime(elapsed)}</span>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setRunning((r) => !r)}>
            {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setElapsed(0); setRunning(false); }}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Resume panel */}
        <Card className="border-border bg-card/60 p-5 backdrop-blur">
          <h2 className="mb-2 flex items-center gap-1.5 font-display text-sm font-semibold"><FileText className="h-4 w-4" /> Candidate Resume</h2>
          <div className="mb-2 flex flex-wrap gap-1">
            {candidate.skills.slice(0, 8).map((s) => <Badge key={s} variant="outline" className="text-[10px] font-normal">{s}</Badge>)}
          </div>
          <p className="mb-2 text-xs text-muted-foreground">{candidate.totalExperienceYears} years experience</p>
          <pre className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-secondary/30 p-3 text-xs text-muted-foreground">
            {candidate.resumeText?.slice(0, 3000) || 'No resume text available.'}
          </pre>
        </Card>

        {/* Question panel + live notes */}
        <Card className="border-border bg-card/60 p-5 backdrop-blur">
          <h2 className="mb-3 flex items-center gap-1.5 font-display text-sm font-semibold"><Sparkles className="h-4 w-4" /> Interview Questions</h2>
          <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
            {CATEGORY_ORDER.map((cat) => {
              const qs = session.questions.filter((q) => q.category === cat);
              if (qs.length === 0) return null;
              return (
                <div key={cat}>
                  <Badge variant="secondary" className="mb-1.5 text-[10px]">{QUESTION_CATEGORY_LABEL[cat]}</Badge>
                  <ul className="space-y-1.5">
                    {qs.map((q, i) => <li key={i} className="text-xs text-foreground/90">{q.question}</li>)}
                  </ul>
                </div>
              );
            })}
          </div>
          <div className="mt-4">
            <Label className="text-xs">Live Notes</Label>
            <Textarea
              value={liveNotes}
              onChange={(e) => setLiveNotes(e.target.value)}
              rows={6}
              className="mt-1"
              placeholder="Capture observations as the interview progresses…"
            />
          </div>
        </Card>

        {/* Rating panel */}
        <Card className="border-border bg-card/60 p-5 backdrop-blur">
          <h2 className="mb-3 font-display text-sm font-semibold">Rating Panel</h2>
          <div className="space-y-4">
            {RATING_DIMENSIONS.map((dim) => (
              <div key={dim.key}>
                <div className="mb-1 flex justify-between text-xs">
                  <span>{dim.label}</span>
                  <span className="tabular-nums text-muted-foreground">{ratings[dim.key]}/10</span>
                </div>
                <Slider
                  value={[ratings[dim.key]]}
                  min={0}
                  max={10}
                  step={1}
                  onValueChange={([v]) => setRatings((r) => ({ ...r, [dim.key]: v }))}
                  disabled={result != null}
                />
              </div>
            ))}
          </div>

          {!result ? (
            <Button onClick={onSubmit} disabled={submitting} className="mt-4 w-full">
              {submitting ? 'Generating Evaluation…' : 'Submit & Generate Evaluation'}
            </Button>
          ) : (
            <div className="mt-4 space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-semibold"><CheckCircle2 className="h-4 w-4 text-success" /> Overall Score</span>
                <span className="font-display text-xl font-semibold">{result.overallScore}/10</span>
              </div>
              <Badge className={RECOMMENDATION_COLOR[result.recommendation]}>{result.recommendation.replace('_', ' ')}</Badge>
              <p className="text-xs text-muted-foreground">{result.summary}</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
