'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, User } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { Candidate } from '@/lib/types';

export default function CandidatesPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [minExperience, setMinExperience] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      limit: '50', ...(search ? { search } : {}), ...(minExperience ? { minExperience } : {}),
    });
    fetch(`/api/hr/candidates?${params}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setCandidates(data.candidates ?? []); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [search, minExperience]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Candidates</h1>
        <p className="mt-1 text-sm text-muted-foreground">Search and filter every candidate who has ever applied.</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, email, or skill…" className="pl-9" />
        </div>
        <Input
          value={minExperience}
          onChange={(e) => setMinExperience(e.target.value)}
          type="number"
          min={0}
          placeholder="Min. years experience"
          className="w-48"
        />
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
        </div>
      ) : candidates.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-2 border-dashed border-border bg-card/40 px-6 py-16 text-center backdrop-blur">
          <User className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No candidates yet. Upload resumes from a job to start screening.</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {candidates.map((c) => (
            <Link key={c.id} href={`/hr/candidates/${c.id}`}>
              <Card className="h-full border-border bg-card/60 p-5 backdrop-blur transition hover:border-primary/40">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-primary/15 text-primary">{c.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{c.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{c.email || 'No email extracted'}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {c.skills.slice(0, 4).map((s) => <Badge key={s} variant="outline" className="text-[10px] font-normal">{s}</Badge>)}
                </div>
                <div className="mt-3 text-xs text-muted-foreground">{c.totalExperienceYears} years experience</div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
