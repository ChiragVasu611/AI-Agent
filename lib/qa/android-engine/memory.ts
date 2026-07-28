import type { Finding } from './types';
import { meminfo } from './device';

/**
 * Memory measurement via `dumpsys meminfo`.
 *
 * Leak detection is comparative, not absolute: the engine samples memory at a
 * baseline and again after exploration, and only reports growth when it is
 * both large in absolute terms and a significant proportion of the baseline.
 * A single high reading is never called a leak — that would be a guess.
 */

export interface MemorySample {
  totalPssKb: number | null;
  totalRssKb: number | null;
  javaHeapKb: number | null;
  nativeHeapKb: number | null;
  graphicsKb: number | null;
  raw: string;
  at: number;
}

export function parseMeminfo(out: string): MemorySample {
  const num = (re: RegExp): number | null => {
    const m = re.exec(out);
    return m ? Number(m[1]) : null;
  };
  return {
    totalPssKb: num(/TOTAL PSS:\s*(\d+)/) ?? num(/TOTAL\s+(\d+)/),
    totalRssKb: num(/TOTAL RSS:\s*(\d+)/),
    javaHeapKb: num(/Java Heap:\s*(\d+)/),
    nativeHeapKb: num(/Native Heap:\s*(\d+)/),
    graphicsKb: num(/Graphics:\s*(\d+)/),
    raw: out.split('\n').slice(0, 40).join('\n').slice(0, 3000),
    at: Date.now(),
  };
}

export async function sampleMemory(serial: string, pkg: string): Promise<MemorySample> {
  return parseMeminfo(await meminfo(serial, pkg));
}

const MB = (kb: number) => (kb / 1024).toFixed(1);

/** Growth must exceed BOTH thresholds before it is reported as a suspected leak. */
const LEAK_ABS_KB = 80 * 1024;   // 80 MB absolute growth
const LEAK_REL_PCT = 60;         // and at least +60% over baseline
const HIGH_FOOTPRINT_KB = 512 * 1024; // 512 MB resident is high for a phone app

export interface MemoryReport {
  baseline: MemorySample;
  final: MemorySample;
  growthKb: number | null;
  findings: Finding[];
}

export function analyzeMemory(
  baseline: MemorySample,
  final: MemorySample,
  moduleLabel: string,
  screenName: string,
  pkg: string,
  screensVisited: number,
): MemoryReport {
  const findings: Finding[] = [];
  const growth =
    baseline.totalPssKb != null && final.totalPssKb != null
      ? final.totalPssKb - baseline.totalPssKb
      : null;

  if (growth != null && baseline.totalPssKb) {
    const relPct = (growth / baseline.totalPssKb) * 100;
    if (growth > LEAK_ABS_KB && relPct > LEAK_REL_PCT) {
      findings.push({
        type: 'memory',
        module: moduleLabel,
        severity: growth > LEAK_ABS_KB * 2 ? 'high' : 'medium',
        title: `Memory grew ${MB(growth)} MB during exploration (possible leak)`,
        description: `Total PSS rose from ${MB(baseline.totalPssKb)} MB to ${MB(final.totalPssKb!)} MB (+${relPct.toFixed(0)}%) while navigating ${screensVisited} screen(s), and did not return to baseline.`,
        screenName,
        activity: '',
        stepsToReproduce: [
          `Baseline: adb shell dumpsys meminfo ${pkg}`,
          'Navigate through the app screens repeatedly',
          `Re-measure: adb shell dumpsys meminfo ${pkg}`,
        ],
        expectedResult: 'Memory returns close to baseline after navigating away from screens.',
        actualResult: `PSS retained at ${MB(final.totalPssKb!)} MB (Java heap ${final.javaHeapKb != null ? `${MB(final.javaHeapKb)} MB` : 'n/a'}, native ${final.nativeHeapKb != null ? `${MB(final.nativeHeapKb)} MB` : 'n/a'}).`,
        evidence: `BASELINE\n${baseline.raw}\n\nAFTER EXPLORATION\n${final.raw}`,
        rootCause: 'Retained references prevent released screens from being collected — commonly static/Application-scoped references to Activity or View, un-cancelled listeners/coroutines, or unbounded caches (bitmaps).',
        suggestedFix: 'Capture a heap dump with Android Studio Memory Profiler and inspect retained Activity instances; add LeakCanary in debug builds; ensure listeners, observers, and coroutine scopes are cancelled in onDestroy.',
      });
    }
  }

  if (final.totalPssKb != null && final.totalPssKb > HIGH_FOOTPRINT_KB) {
    findings.push({
      type: 'memory',
      module: moduleLabel,
      severity: 'medium',
      title: `High memory footprint: ${MB(final.totalPssKb)} MB PSS`,
      description: `The app's resident memory reached ${MB(final.totalPssKb)} MB, which risks background eviction and low-memory kills on entry-level devices.`,
      screenName,
      activity: '',
      stepsToReproduce: ['Use the app normally', `Run: adb shell dumpsys meminfo ${pkg}`],
      expectedResult: 'Footprint stays modest so the OS keeps the process resident.',
      actualResult: `TOTAL PSS ${MB(final.totalPssKb)} MB${final.graphicsKb != null ? `, Graphics ${MB(final.graphicsKb)} MB` : ''}.`,
      evidence: final.raw,
      rootCause: 'Large in-memory caches, full-resolution bitmaps, or many retained screens.',
      suggestedFix: 'Downsample images to display size, bound caches with LruCache, and release heavy resources in onTrimMemory.',
    });
  }

  return { baseline, final, growthKb: growth, findings };
}
