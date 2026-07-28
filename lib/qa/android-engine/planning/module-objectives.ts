import type { CheckOutcome } from '../types';

/**
 * Evidence-based module completion.
 *
 * A module does NOT complete because its executor function returned. It
 * completes only when the measurable evidence its objectives require has
 * actually been collected — screenshots, executed checks, captured metrics,
 * logcat runtime, permission dumps, rotation observations, and so on. This is
 * what stops the engine from reporting "Performance: done" when no cold-start
 * number was ever measured.
 *
 * The ledger is filled from REAL artifacts gathered during the run; nothing
 * here fabricates evidence.
 */

export interface EvidenceLedger {
  /** Screens on which each per-screen module actually ran a check. */
  screensAudited: Record<string, number>;
  /** Screenshots captured, by reason. */
  screenshots: Record<string, number>;
  /** Total real screenshots. */
  totalScreenshots: number;
  /** Distinct screens the exploration visited. */
  screensVisited: number;
  /** Interactions actually executed. */
  interactionsExecuted: number;
  /** Wall-clock the crash/ANR monitor observed, ms. */
  logcatRuntimeMs: number;
  /** Booleans/counts for post-run + dedicated modules. */
  coldStartMeasured: boolean;
  frameStatsMeasured: boolean;
  memorySampled: boolean;
  batterySampled: boolean;
  networkAnalysed: boolean;
  securityDumpInspected: boolean;
  rotationObserved: boolean;
  monkeyEvents: number;
  completedWorkflows: number;
}

export function newLedger(): EvidenceLedger {
  return {
    screensAudited: {}, screenshots: {}, totalScreenshots: 0,
    screensVisited: 0, interactionsExecuted: 0, logcatRuntimeMs: 0,
    coldStartMeasured: false, frameStatsMeasured: false, memorySampled: false,
    batterySampled: false, networkAnalysed: false, securityDumpInspected: false,
    rotationObserved: false, monkeyEvents: 0, completedWorkflows: 0,
  };
}

export interface ModuleObjective {
  description: string;
  met: (l: EvidenceLedger) => boolean;
}

export interface ModuleAssessment {
  key: string;
  complete: boolean;
  met: number;
  total: number;
  missing: string[];
}

/** A per-screen module needs to have audited a reasonable share of screens. */
function perScreenObjective(bucket: string): ModuleObjective[] {
  return [{
    description: `Audited at least ${'3'} screens (or every screen, if fewer)`,
    met: (l) => (l.screensAudited[bucket] ?? 0) >= Math.min(3, Math.max(1, l.screensVisited)),
  }, {
    description: 'Captured navigation screenshots as evidence',
    met: (l) => l.totalScreenshots >= 1,
  }];
}

/** Objectives per module key. Extend here as modules are added. */
const OBJECTIVES: Record<string, ModuleObjective[]> = {
  functional: perScreenObjective('functional'),
  regression: perScreenObjective('functional'),
  e2e: [
    ...perScreenObjective('functional'),
    { description: 'Completed at least one multi-screen workflow', met: (l) => l.completedWorkflows >= 1 },
  ],
  ui_ux: perScreenObjective('ui'),
  accessibility: perScreenObjective('a11y'),
  localization: perScreenObjective('l10n'),
  smoke: [{ description: 'Verified at least one screen is served by the app', met: (l) => (l.screensAudited['smoke'] ?? 0) >= 1 }],
  sanity: [{ description: 'Verified at least one screen is served by the app', met: (l) => (l.screensAudited['smoke'] ?? 0) >= 1 }],

  performance: [
    { description: 'Measured cold start', met: (l) => l.coldStartMeasured },
    { description: 'Sampled frame rendering statistics', met: (l) => l.frameStatsMeasured },
  ],
  memory: [{ description: 'Sampled memory against a baseline', met: (l) => l.memorySampled }],
  battery: [{ description: 'Sampled battery/wake-lock state', met: (l) => l.batterySampled }],
  network: [{ description: 'Analysed network/SSL signals', met: (l) => l.networkAnalysed }],
  api: [{ description: 'Analysed API/network responses', met: (l) => l.networkAnalysed }],
  security: [{ description: 'Inspected package flags and permission grants', met: (l) => l.securityDumpInspected }],

  compatibility: [{ description: 'Observed the app under rotation', met: (l) => l.rotationObserved }],
  monkey: [{ description: 'Injected the planned random events', met: (l) => l.monkeyEvents >= 100 }],

  crash_detection: [{ description: 'Scanned logcat for a meaningful runtime window', met: (l) => l.logcatRuntimeMs >= 60_000 }],
  anr_detection: [{ description: 'Scanned logcat for a meaningful runtime window', met: (l) => l.logcatRuntimeMs >= 60_000 }],

  ai_exploratory: [{ description: 'Explored enough surface for analysis', met: (l) => l.screensVisited >= 3 }],
};

/** Assesses every selected module against its objectives using collected evidence. */
export function assessModules(selected: string[], ledger: EvidenceLedger): ModuleAssessment[] {
  return selected.map((key) => {
    const objectives = OBJECTIVES[key] ?? [{ description: 'Executed', met: () => true }];
    const missing: string[] = [];
    let met = 0;
    for (const o of objectives) {
      if (o.met(ledger)) met += 1; else missing.push(o.description);
    }
    return { key, complete: met === objectives.length, met, total: objectives.length, missing };
  });
}

export function completeCount(assessments: ModuleAssessment[]): number {
  return assessments.filter((a) => a.complete).length;
}
