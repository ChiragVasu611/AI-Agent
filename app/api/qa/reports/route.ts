import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaBug } from '@/lib/mongodb/models/QaBug';

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  const userId = user.id;

  const [passed, failed] = await Promise.all([
    QaTestRun.countDocuments({ userId, status: 'passed' }),
    QaTestRun.countDocuments({ userId, status: 'failed' }),
  ]);

  const runs = await QaTestRun.find({ userId }).sort({ createdAt: 1 }).lean();
  const bugs = await QaBug.find({ userId }).sort({ createdAt: 1 }).lean();

  const bugTrendMap = new Map<string, number>();
  bugs.forEach((b: any) => {
    const key = dayKey(new Date(b.createdAt));
    bugTrendMap.set(key, (bugTrendMap.get(key) ?? 0) + 1);
  });
  const bugTrends = Array.from(bugTrendMap.entries()).map(([date, count]) => ({ date, count }));

  const execTimeTotals = new Map<string, { seconds: number; count: number }>();
  runs.filter((r: any) => r.startedAt && r.completedAt).forEach((r: any) => {
    const key = dayKey(new Date(r.completedAt));
    const seconds = Math.round((new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 1000);
    const existing = execTimeTotals.get(key) ?? { seconds: 0, count: 0 };
    execTimeTotals.set(key, { seconds: existing.seconds + seconds, count: existing.count + 1 });
  });
  const execTimeTrends = Array.from(execTimeTotals.entries()).map(([date, { seconds, count }]) => ({
    date, seconds: Math.round(seconds / count),
  }));

  const crashTrendMap = new Map<string, number>();
  bugs.filter((b: any) => b.type === 'crash' || b.type === 'anr').forEach((b: any) => {
    const key = dayKey(new Date(b.createdAt));
    crashTrendMap.set(key, (crashTrendMap.get(key) ?? 0) + 1);
  });
  const crashTrends = Array.from(crashTrendMap.entries()).map(([date, count]) => ({ date, count }));

  const deviceUsageMap = new Map<string, number>();
  runs.forEach((r: any) => {
    if (r.currentDevice) deviceUsageMap.set(r.currentDevice, (deviceUsageMap.get(r.currentDevice) ?? 0) + 1);
  });
  const deviceUsage = Array.from(deviceUsageMap.entries()).map(([device, count]) => ({ device, count }));

  const securityBugs = bugs.filter((b: any) => b.type === 'security');
  const securitySeverity = ['critical', 'high', 'medium', 'low'].map((sev) => ({
    severity: sev, count: securityBugs.filter((b: any) => b.severity === sev).length,
  }));

  const apiBugs = bugs.filter((b: any) => b.type === 'api').length;
  const apiRuns = runs.filter((r: any) => r.modules?.includes('api')).length;

  return NextResponse.json({
    passVsFail: [{ name: 'Passed', value: passed }, { name: 'Failed', value: failed }],
    bugTrends,
    execTimeTrends,
    crashTrends,
    deviceUsage,
    securitySeverity,
    apiHealth: { totalApiRuns: apiRuns, apiBugsFound: apiBugs },
  });
}
