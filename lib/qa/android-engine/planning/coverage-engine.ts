import type { ScreenGraph } from '../graph';
import type { FeatureMap } from './feature-map';
import type { CoverageSnapshot } from './types';

/**
 * The Coverage Engine.
 *
 * Turns raw exploration state into five coverage ratios and one weighted
 * overall figure, and — crucially — decides when the run is actually DONE.
 *
 * The old engine stopped as soon as the screen graph had no untried actions
 * ("all screens visited"). That under-tests apps: whole features stay unseen
 * behind state changes, and selected modules may not yet have the evidence
 * they need. This engine keeps going until coverage goals are met, no
 * meaningful action remains AND no re-exploration is pending, or the run hits
 * its wall-clock / step ceiling.
 */

export interface CoverageWeights {
  screen: number;
  feature: number;
  workflow: number;
  interaction: number;
  module: number;
}

const DEFAULT_WEIGHTS: CoverageWeights = {
  screen: 0.2, feature: 0.25, workflow: 0.2, interaction: 0.2, module: 0.15,
};

export class CoverageEngine {
  private modulesSelected: number;
  private modulesComplete = 0;
  private target: number;
  private weights: CoverageWeights;

  constructor(opts: { modulesSelected: number; target?: number; weights?: Partial<CoverageWeights> }) {
    this.modulesSelected = Math.max(1, opts.modulesSelected);
    // A pragmatic bar — real apps rarely reach 1.0, so the deadline/step limits
    // remain the ultimate stop, but we won't quit early below this.
    this.target = opts.target ?? 0.85;
    this.weights = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
  }

  /** Records how many selected modules have collected sufficient evidence. */
  setModulesComplete(n: number): void {
    this.modulesComplete = Math.min(this.modulesSelected, Math.max(0, n));
  }

  snapshot(graph: ScreenGraph, features: FeatureMap): CoverageSnapshot {
    const nodes = graph.allNodes();
    const screensDiscovered = nodes.length;
    const screensExhausted = nodes.filter((n) => n.exhausted).length;
    const interactionsTried = nodes.reduce((s, n) => s + n.triedActions.size, 0);
    // Deferred (budget-parked) actions are untried work and must sit in the
    // denominator — otherwise a screen whose long tail was parked reads as
    // fully interacted-with, inflating overall coverage past the target and
    // stopping the run on the strength of work that never happened.
    const interactionsPending = nodes.reduce(
      (s, n) => s + n.pendingActions.size + n.deferredActions.size, 0,
    );

    const featuresDiscovered = features.featureCount();
    const featuresExercised = features.exercisedCount();
    const workflowsKnown = features.workflowCount();
    const workflowsComplete = features.completeWorkflowCount();

    const screen = ratio(screensExhausted, screensDiscovered);
    const interaction = ratio(interactionsTried, interactionsTried + interactionsPending);
    const feature = ratio(featuresExercised, featuresDiscovered);
    const workflow = ratio(workflowsComplete, workflowsKnown);
    const module = ratio(this.modulesComplete, this.modulesSelected);

    const w = this.weights;
    const overall =
      screen * w.screen + feature * w.feature + workflow * w.workflow
      + interaction * w.interaction + module * w.module;

    return {
      screen, feature, workflow, interaction, module, overall,
      detail: {
        screensDiscovered, screensExhausted, interactionsTried, interactionsPending,
        featuresDiscovered, featuresExercised, workflowsKnown, workflowsComplete,
        modulesSelected: this.modulesSelected, modulesComplete: this.modulesComplete,
      },
    };
  }

  /**
   * The stop decision. Continue while coverage is below target AND there is
   * still meaningful work (a pending action somewhere, an unmet goal, or a
   * pending re-exploration). Never stop merely because every screen was seen.
   */
  shouldContinue(
    snap: CoverageSnapshot,
    opts: { pendingActions: number; unmetGoals: number; reexplorePending: boolean },
  ): boolean {
    if (snap.overall >= this.target) return false;
    const workRemains = opts.pendingActions > 0 || opts.unmetGoals > 0 || opts.reexplorePending;
    return workRemains;
  }

  get targetCoverage(): number { return this.target; }

  static format(snap: CoverageSnapshot): string {
    const pct = (n: number) => `${Math.round(n * 100)}%`;
    return (
      `Coverage — overall ${pct(snap.overall)} · `
      + `screen ${pct(snap.screen)} · feature ${pct(snap.feature)} · `
      + `workflow ${pct(snap.workflow)} · interaction ${pct(snap.interaction)} · module ${pct(snap.module)}`
    );
  }
}

function ratio(num: number, den: number): number {
  if (den <= 0) return 0;
  return Math.min(1, num / den);
}
