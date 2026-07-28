import type { AppKnowledge } from './knowledge-base';
import type { GoalKind } from './types';

/**
 * The Learning Engine.
 *
 * Turns persisted knowledge into concrete advice for THIS run:
 *  • Which interaction keys are known dead ends (never navigated) → skip them.
 *  • Which screens were unstable (crashed/ANR'd before) → test them first.
 *  • Which goals are already well covered → lower their priority.
 *  • Which goals are new or newly-modified (version changed) → raise them.
 *  • Which screen signatures are already known → reused so the run doesn't
 *    burn budget rediscovering them.
 *
 * It never suppresses testing entirely — it only re-orders effort so each run
 * spends its budget where it matters most, exactly as a returning human tester
 * would ("last build the checkout crashed, and search is new — start there").
 */
export class LearningEngine {
  private deadEnds: Set<string>;
  private knownScreens: Set<string>;
  private unstable: Set<string>;
  private productive: Set<string>;
  private crashSignatures: Set<string>;
  private readonly prior: AppKnowledge;

  constructor(prior: AppKnowledge) {
    this.prior = prior;
    this.deadEnds = new Set(prior.deadEndActions);
    this.knownScreens = new Set(prior.screenSignatures);
    this.unstable = new Set(prior.unstableScreens);
    // Reused across runs to cut duplicate exploration and revisit failing areas.
    this.productive = new Set([
      ...prior.productiveActions,
      ...prior.interactionSequences.flatMap((s) => s.keys),
    ]);
    this.crashSignatures = new Set((prior.crashLocations ?? []).map((c) => c.signature));
  }

  /** True for an action that has never once changed the screen across runs. */
  isDeadEnd(actionKey: string): boolean {
    return this.deadEnds.has(actionKey);
  }

  /** True for an action known to reliably navigate — reused to skip re-derivation. */
  isProductive(actionKey: string): boolean {
    return this.productive.has(actionKey);
  }

  isKnownScreen(signature: string): boolean {
    return this.knownScreens.has(signature);
  }

  /** Unstable = previously crashed/ANR'd OR flagged unstable — revisit first. */
  isUnstable(signature: string): boolean {
    return this.unstable.has(signature) || this.crashSignatures.has(signature);
  }

  /** Goals to de-prioritise: those a prior run already covered well. */
  deprioritisedGoals(): GoalKind[] {
    if (this.prior.isFirstRun || this.prior.versionChanged) return [];
    const covered = new Set<GoalKind>();
    for (const f of this.prior.features) {
      if (f.exercised && f.kind !== 'unknown') covered.add(f.kind as GoalKind);
    }
    return Array.from(covered);
  }

  /**
   * Goals to boost: unstable areas always, plus — when the version changed —
   * everything, because any flow may be new or modified in the new build.
   */
  boostedGoals(): GoalKind[] {
    const boost = new Set<GoalKind>();
    // Features whose screens previously crashed OR were flagged unstable — the
    // failing areas a returning human tester re-checks first.
    for (const f of this.prior.features) {
      if (Array.from(f.screens).some((s) => this.isUnstable(s)) && f.kind !== 'unknown') {
        boost.add(f.kind as GoalKind);
      }
    }
    if (this.prior.versionChanged) {
      // Re-verify the primary flows on a new build.
      (['login', 'navigation', 'search', 'checkout', 'content', 'forms'] as GoalKind[]).forEach((g) => boost.add(g));
    }
    return Array.from(boost);
  }

  /** Human-readable note for the run log so the reuse decision is transparent. */
  describe(): string {
    if (this.prior.isFirstRun) return 'No prior knowledge for this app — building the feature map from scratch.';
    if (this.prior.versionChanged) {
      return `App version changed (${this.prior.knownVersion} → ${this.prior.appVersion}). `
        + `Reusing ${this.knownScreens.size} known screen signature(s); prioritising new/modified flows.`;
    }
    return `Reusing knowledge from ${this.prior.runCount} prior run(s): `
      + `${this.knownScreens.size} screens, ${this.deadEnds.size} known dead end(s), ${this.unstable.size} unstable screen(s).`;
  }
}
