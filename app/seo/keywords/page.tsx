import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { SeoKeyword } from '@/lib/mongodb/models/SeoKeyword';
import { SeoProject } from '@/lib/mongodb/models/SeoProject';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

export default async function SeoKeywordsPage({ searchParams }: { searchParams: { project?: string; search?: string } }) {
  const user = await getCurrentUser();
  await connectToDatabase();

  const projects = (await SeoProject.find({ userId: user?.id }, 'name').lean()).map(serializeDoc);
  const query: Record<string, unknown> = { userId: user?.id };
  if (searchParams.project) query.projectId = searchParams.project;
  if (searchParams.search) query.keyword = { $regex: searchParams.search, $options: 'i' };

  const keywords = (await SeoKeyword.find(query).sort({ relevance: -1 }).limit(300).lean()).map(serializeDoc);
  const projectById = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Keyword Engine</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every keyword generated across all projects, ranked by relevance.</p>
      </div>

      <Card className="border-border bg-card/60 p-4 backdrop-blur">
        <form method="get" className="flex flex-wrap gap-3">
          <input name="search" defaultValue={searchParams.search ?? ''} placeholder="Search keyword..." className="h-9 flex-1 min-w-[200px] rounded-md border border-input bg-background px-3 text-sm" />
          <select name="project" defaultValue={searchParams.project ?? ''} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">All Projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Filter</button>
        </form>
      </Card>

      <Card className="border-border bg-card/60 backdrop-blur">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Keyword</TableHead><TableHead>Project</TableHead><TableHead>Type</TableHead>
              <TableHead>Intent</TableHead><TableHead>Relevance</TableHead><TableHead>Competition</TableHead><TableHead>Business Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keywords.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">No keywords found. Generate keywords from a project page.</TableCell></TableRow>
            ) : keywords.map((k: any) => (
              <TableRow key={k.id}>
                <TableCell className="font-medium">{k.keyword}</TableCell>
                <TableCell><Link href={`/seo/projects/${k.projectId}`} className="text-xs text-primary hover:underline">{projectById.get(k.projectId) ?? '—'}</Link></TableCell>
                <TableCell><Badge variant="outline" className="text-[10px] capitalize">{k.type.replace(/_/g, ' ')}</Badge></TableCell>
                <TableCell className="text-xs capitalize text-muted-foreground">{k.intent}</TableCell>
                <TableCell className="text-xs">{k.relevance}</TableCell>
                <TableCell className="text-xs capitalize">{k.competitionEstimate}</TableCell>
                <TableCell className="text-xs">{k.businessValue}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
