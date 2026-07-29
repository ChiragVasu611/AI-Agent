import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestCaseSheet } from '@/lib/mongodb/models/QaTestCaseSheet';
import { serializeDoc } from '@/lib/mongodb/serialize';

/**
 * Lists sheets for the Test Case Repository picker: search, platform section
 * (Android / iOS / Web), sort, and real pagination. Each row summarizes the
 * sheet's CURRENT version (not necessarily its latest — a restored older
 * version is "current" until the user promotes something new).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const search = params.get('search')?.toLowerCase().trim() || null;
  const platform = params.get('platform') || null; // 'android' | 'ios' | 'web'
  const favoritesOnly = params.get('favorites') === 'true';
  const sort = params.get('sort') ?? 'recent';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const pageSize = Math.max(1, Number(params.get('pageSize') ?? '10') || 10);

  await connectToDatabase();

  const query: Record<string, unknown> = { userId: user.id };
  if (platform) query.platform = platform;
  if (favoritesOnly) query.isFavorite = true;

  const docs = await QaTestCaseSheet.find(query).lean();

  let rows = docs.map((d: any) => {
    const idx = d.currentVersionIndex ?? d.versions.length - 1;
    const current = d.versions[idx] ?? d.versions[d.versions.length - 1] ?? null;
    return {
      ...serializeDoc(d),
      versions: undefined, // full row list is heavy — fetched separately when opening the editor
      versionCount: d.versions.length,
      currentVersion: current?.version ?? 'v1.0',
      totalTestCases: current?.totalTestCases ?? 0,
      lastModified: d.updatedAt,
    };
  });

  if (search) {
    rows = rows.filter((r: any) =>
      r.sheetName?.toLowerCase().includes(search)
      || r.projectName?.toLowerCase().includes(search)
      || r.applicationName?.toLowerCase().includes(search)
      || r.module?.toLowerCase().includes(search));
  }

  switch (sort) {
    case 'name':
      rows.sort((a: any, b: any) => a.sheetName.localeCompare(b.sheetName));
      break;
    case 'oldest':
      rows.sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      break;
    case 'most_cases':
      rows.sort((a: any, b: any) => b.totalTestCases - a.totalTestCases);
      break;
    case 'recent':
    default:
      rows.sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const paged = rows.slice(start, start + pageSize);

  // Recent = 5 most-recently-modified active sheets for this platform, independent of search/favorites.
  const recent = docs
    .filter((d: any) => d.status === 'active')
    .slice()
    .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5)
    .map((d: any) => ({ id: String(d._id), sheetName: d.sheetName }));

  return NextResponse.json({ sheets: paged, total, page, pageSize, recent });
}
