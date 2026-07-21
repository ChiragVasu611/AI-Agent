import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaBug } from '@/lib/mongodb/models/QaBug';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  const userId = user.id;

  const [
    totalRuns, runningRuns, queuedRuns, passedRuns, failedRuns,
    totalBugs, critical, high, medium, low, crashCount, anrCount, securityCount,
  ] = await Promise.all([
    QaTestRun.countDocuments({ userId }),
    QaTestRun.countDocuments({ userId, status: 'running' }),
    QaTestRun.countDocuments({ userId, status: 'queued' }),
    QaTestRun.countDocuments({ userId, status: 'passed' }),
    QaTestRun.countDocuments({ userId, status: 'failed' }),
    QaBug.countDocuments({ userId }),
    QaBug.countDocuments({ userId, severity: 'critical' }),
    QaBug.countDocuments({ userId, severity: 'high' }),
    QaBug.countDocuments({ userId, severity: 'medium' }),
    QaBug.countDocuments({ userId, severity: 'low' }),
    QaBug.countDocuments({ userId, type: 'crash' }),
    QaBug.countDocuments({ userId, type: 'anr' }),
    QaBug.countDocuments({ userId, type: 'security' }),
  ]);

  const completedRuns = await QaTestRun.find({
    userId, status: { $in: ['passed', 'failed'] }, startedAt: { $ne: null }, completedAt: { $ne: null },
  }).select('startedAt completedAt performanceScore').lean();

  const durations = completedRuns.map((r: any) => (new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 1000);
  const avgExecSeconds = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const fastestSeconds = durations.length ? Math.min(...durations) : null;
  const slowestSeconds = durations.length ? Math.max(...durations) : null;
  const successRate = totalRuns > 0 ? Math.round(((passedRuns) / (passedRuns + failedRuns || 1)) * 100) : 0;
  const avgPerformanceScore = completedRuns.length
    ? Math.round(completedRuns.reduce((a: number, r: any) => a + (r.performanceScore ?? 0), 0) / completedRuns.length)
    : null;

  const runningRun = await QaTestRun.findOne({ userId, status: 'running' }).lean();
  let etaSeconds: number | null = null;
  if (runningRun) {
    const elapsed = ((runningRun as any).startedAt ? (Date.now() - new Date((runningRun as any).startedAt).getTime()) / 1000 : 0);
    const total = (runningRun as any).estimatedSeconds ?? 0;
    etaSeconds = Math.max(0, Math.round(total - elapsed));
  }

  return NextResponse.json({
    totalRuns, runningRuns, queuedRuns, passedRuns, failedRuns, successRate,
    avgExecSeconds, fastestSeconds, slowestSeconds, etaSeconds,
    totalBugs, critical, high, medium, low, crashCount, anrCount, securityCount,
    avgPerformanceScore,
  });
}
