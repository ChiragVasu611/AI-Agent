import type { Finding } from './types';
import { coldStart, gfxinfo, resetGfxinfo, cpuinfo, startAppTimed } from './device';

/**
 * Performance measurement.
 *
 * Every number comes from the platform itself — `am start -W` for launch
 * timings and `dumpsys gfxinfo` for real frame statistics. Nothing is
 * estimated with a stopwatch on the host, which would include adb latency.
 * Thresholds follow Android's own vitals guidance and are stated in each
 * finding so a reviewer can judge the verdict.
 */

/** Android vitals: >20% janky frames is flagged as "excessive"; 5% is a healthy target. */
const JANK_WARN_PCT = 20;
const JANK_HIGH_PCT = 35;
/** Play Console guidance for cold start on mid-range hardware. */
const COLD_START_WARN_MS = 5_000;
const COLD_START_HIGH_MS = 8_000;
const WARM_START_WARN_MS = 2_000;

export interface FrameStats {
  totalFrames: number | null;
  jankyFrames: number | null;
  jankyPct: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  raw: string;
}

export function parseGfxinfo(out: string): FrameStats {
  const num = (re: RegExp): number | null => {
    const m = re.exec(out);
    return m ? Number(m[1]) : null;
  };
  const total = num(/Total frames rendered:\s*(\d+)/);
  const janky = num(/Janky frames:\s*(\d+)/);
  const jankyPctDirect = /Janky frames:\s*\d+\s*\(([\d.]+)%\)/.exec(out);
  return {
    totalFrames: total,
    jankyFrames: janky,
    jankyPct: jankyPctDirect ? Number(jankyPctDirect[1]) : (total && janky ? (janky / total) * 100 : null),
    p50: num(/50th percentile:\s*(\d+)ms/),
    p90: num(/90th percentile:\s*(\d+)ms/),
    p95: num(/95th percentile:\s*(\d+)ms/),
    p99: num(/99th percentile:\s*(\d+)ms/),
    raw: out.slice(0, 3000),
  };
}

export interface CpuSample {
  totalPct: number | null;
  appPct: number | null;
  raw: string;
}

export function parseCpuinfo(out: string, pkg: string): CpuSample {
  const total = /([\d.]+)%\s+TOTAL/.exec(out);
  // Per-process line, e.g. "12% 4321/com.app: 8% user + 4% kernel"
  const appLine = new RegExp(`([\\d.]+)%\\s+\\d+/${pkg.replace(/\./g, '\\.')}`).exec(out);
  return {
    totalPct: total ? Number(total[1]) : null,
    appPct: appLine ? Number(appLine[1]) : null,
    raw: out.split('\n').slice(0, 15).join('\n'),
  };
}

export interface PerformanceReport {
  coldStartMs: number | null;
  warmStartMs: number | null;
  frames: FrameStats | null;
  cpu: CpuSample | null;
  findings: Finding[];
}

/**
 * Runs the performance module: a genuine cold start, a warm start, then frame
 * and CPU statistics accumulated over the exploration that already happened.
 */
export async function measurePerformance(
  serial: string,
  pkg: string,
  moduleLabel: string,
  screenName: string,
): Promise<PerformanceReport> {
  const findings: Finding[] = [];

  // Cold start — force-stop guarantees the process is actually cold.
  const cold = await coldStart(serial, pkg);
  const coldMs = cold.totalTimeMs;

  // Warm start — the process is now warm, so relaunching measures that path.
  const warm = await startAppTimed(serial, pkg);
  const warmMs = warm.totalTimeMs;

  if (coldMs != null && coldMs > COLD_START_WARN_MS) {
    findings.push({
      type: 'performance',
      module: moduleLabel,
      severity: coldMs > COLD_START_HIGH_MS ? 'high' : 'medium',
      title: `Cold start takes ${coldMs}ms`,
      description: `The app's cold start time measured by the platform (am start -W) is ${coldMs}ms, above the ${COLD_START_WARN_MS}ms guidance for a responsive launch.`,
      screenName,
      activity: cold.activity ?? '',
      stepsToReproduce: [
        `Force-stop the app: adb shell am force-stop ${pkg}`,
        'Launch the app from the launcher',
        'Observe the time until the first frame is drawn',
      ],
      expectedResult: `Cold start completes within ${COLD_START_WARN_MS}ms.`,
      actualResult: `Cold start took ${coldMs}ms (WaitTime ${cold.waitTimeMs ?? 'n/a'}ms).`,
      evidence: cold.raw.slice(0, 1500),
      rootCause: 'Heavy initialization on the main thread during Application/Activity startup — commonly synchronous I/O, large dependency graphs, or eager SDK initialization.',
      suggestedFix: 'Profile startup with Macrobenchmark/Perfetto, defer non-critical SDK initialization (App Startup library), and move blocking I/O off the main thread.',
    });
  }

  if (warmMs != null && warmMs > WARM_START_WARN_MS) {
    findings.push({
      type: 'performance',
      module: moduleLabel,
      severity: 'low',
      title: `Warm start takes ${warmMs}ms`,
      description: `Relaunching the already-resident process took ${warmMs}ms, above the ${WARM_START_WARN_MS}ms target.`,
      screenName,
      activity: warm.activity ?? '',
      stepsToReproduce: ['Launch the app', 'Press Home', 'Relaunch the app from the launcher'],
      expectedResult: `Warm start completes within ${WARM_START_WARN_MS}ms.`,
      actualResult: `Warm start took ${warmMs}ms.`,
      evidence: warm.raw.slice(0, 1200),
      rootCause: 'Activity recreation is doing more work than necessary — re-inflating layouts or re-fetching data that could be cached.',
      suggestedFix: 'Cache view state, avoid redundant network calls on resume, and verify no heavy work runs in onCreate/onResume.',
    });
  }

  const frames = parseGfxinfo(await gfxinfo(serial, pkg));
  if (frames.jankyPct != null && frames.jankyPct > JANK_WARN_PCT && (frames.totalFrames ?? 0) > 60) {
    findings.push({
      type: 'performance',
      module: moduleLabel,
      severity: frames.jankyPct > JANK_HIGH_PCT ? 'high' : 'medium',
      title: `${frames.jankyPct.toFixed(1)}% of frames are janky`,
      description: `dumpsys gfxinfo reports ${frames.jankyFrames}/${frames.totalFrames} janky frames during the exploration session.`,
      screenName,
      activity: '',
      stepsToReproduce: [
        `Reset frame stats: adb shell dumpsys gfxinfo ${pkg} reset`,
        'Navigate and scroll through the app',
        `Read frame stats: adb shell dumpsys gfxinfo ${pkg}`,
      ],
      expectedResult: `Fewer than ${JANK_WARN_PCT}% janky frames (Android vitals guidance).`,
      actualResult: `${frames.jankyPct.toFixed(1)}% janky. 95th percentile frame time: ${frames.p95 ?? 'n/a'}ms, 99th: ${frames.p99 ?? 'n/a'}ms.`,
      evidence: frames.raw,
      rootCause: 'Frames are exceeding the 16.7ms budget — typically layout thrash, overdraw, main-thread work during scroll, or unoptimized RecyclerView binding.',
      suggestedFix: 'Profile with Perfetto/Systrace during scrolling, flatten deep view hierarchies, avoid allocations in onBindViewHolder, and move parsing/decoding off the main thread.',
    });
  }

  const cpu = parseCpuinfo(await cpuinfo(serial), pkg);
  if (cpu.appPct != null && cpu.appPct > 60) {
    findings.push({
      type: 'performance',
      module: moduleLabel,
      severity: cpu.appPct > 85 ? 'high' : 'medium',
      title: `Sustained CPU usage of ${cpu.appPct}%`,
      description: `dumpsys cpuinfo attributes ${cpu.appPct}% CPU to ${pkg} while the app was being exercised.`,
      screenName,
      activity: '',
      stepsToReproduce: ['Exercise the app', 'Run: adb shell dumpsys cpuinfo'],
      expectedResult: 'CPU usage stays moderate during normal interaction.',
      actualResult: `${cpu.appPct}% of CPU attributed to the app (system total ${cpu.totalPct ?? 'n/a'}%).`,
      evidence: cpu.raw,
      rootCause: 'A busy loop, polling timer, or continuous animation/decoding is consuming CPU beyond what the UI requires.',
      suggestedFix: 'Profile with the CPU profiler, replace polling with callbacks/Flow, and ensure background work is scheduled via WorkManager rather than tight loops.',
    });
  }

  return { coldStartMs: coldMs, warmStartMs: warmMs, frames, cpu, findings };
}

export { resetGfxinfo };
