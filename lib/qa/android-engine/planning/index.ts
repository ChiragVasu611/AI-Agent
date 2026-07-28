import type { Interaction, ScreenState } from '../types';
import type { ScreenGraph } from '../graph';
import { FeatureMap } from './feature-map';
import { GoalPlanner } from './goal-planner';
import { CoverageEngine } from './coverage-engine';
import { AiPlanner } from './ai-planner';
import { LearningEngine } from './learning-engine';
import type { AppKnowledge, InteractionSequence, CrashLocation, BlockerLocation } from './knowledge-base';
import type { ActionDecision, CoverageSnapshot, Feature, GoalKind, StateChangeKind } from './types';

export { KnowledgeBase } from './knowledge-base';
export type { AppKnowledge, InteractionSequence, CrashLocation, BlockerLocation } from './knowledge-base';
export { newLedger, assessModules, completeCount } from './module-objectives';
export type { EvidenceLedger, ModuleAssessment } from './module-objectives';
export type { CoverageSnapshot } from './types';
export { CoverageEngine } from './coverage-engine';

type Logger = (level: 'debug' | 'info' | 'warn' | 'error', message: string) => Promise<void>;

/**
 * Which goals a given state change can unlock. Re-exploration is TARGETED —
 * only the affected workflows are re-opened, never the whole app, and the app
 * is never restarted just because state changed.
 */
const AFFECTED_BY_CHANGE: Record<StateChangeKind, GoalKind[]> = {
  login: ['content', 'navigation', 'profile', 'settings', 'account', 'checkout', 'notifications', 'media', 'search'],
  permission: ['camera', 'media', 'content'],
  settings: ['settings', 'content', 'navigation'],
  purchase: ['checkout', 'account', 'content'],
  rotation: [], // layout-level; handled by the compatibility module, no goal reopen
  language: ['content', 'navigation', 'settings'],
  offline: ['content', 'search', 'checkout'],
  online: ['content', 'search', 'checkout'],
};

/** Backtracks in a row with no action before the planner concedes the run is done. */
const MAX_BARREN_BACKTRACKS = 16;

/**
 * PlanningSession — the SINGLE decision maker.
 *
 * The explorer no longer decides anything: every iteration it hands the
 * current screen and the enumerated candidate actions to {@link decide}, which
 * returns exactly one of act / backtrack / stop. The explorer only performs the
 * mechanical device work that decision implies. This composes the Goal Planner,
 * Feature Map, Coverage Engine, AI Planner and Learning Engine, and it records
 * the successful interaction sequences, crash locations and ad/paywall
 * locations that feed the Knowledge Base for future runs.
 */
export class PlanningSession {
  readonly goals: GoalPlanner;
  readonly featureMap: FeatureMap;
  readonly coverage: CoverageEngine;
  readonly ai: AiPlanner;
  readonly learning: LearningEngine;

  private readonly productive = new Set<string>();
  private readonly deadEnds = new Set<string>();
  private readonly unstable = new Set<string>();
  private readonly crashes: CrashLocation[] = [];
  private readonly blockers: BlockerLocation[] = [];
  private readonly versionChanged: boolean;
  private reexploreBudget = 0;
  private barrenBacktracks = 0;
  private lastSnapshot: CoverageSnapshot | null = null;
  private readonly log: Logger;

  constructor(opts: {
    prior: AppKnowledge;
    modulesSelected: number;
    apiKey: string | null;
    log: Logger;
    coverageTarget?: number;
  }) {
    this.log = opts.log;
    this.versionChanged = opts.prior.versionChanged;
    this.learning = new LearningEngine(opts.prior);
    this.goals = new GoalPlanner({
      deprioritise: this.learning.deprioritisedGoals(),
      boost: this.learning.boostedGoals(),
    });
    this.featureMap = new FeatureMap();
    this.featureMap.seed(opts.prior.features, opts.prior.workflows);
    this.coverage = new CoverageEngine({ modulesSelected: opts.modulesSelected, target: opts.coverageTarget });
    this.ai = new AiPlanner({ apiKey: opts.apiKey, log: opts.log });
  }

  /** Observe a screen: grow features, create/activate goals for it. */
  onScreen(state: ScreenState, step: number): { features: Feature[]; unstable: boolean } {
    const features = this.featureMap.observe(state, step);
    if (features.length) this.goals.onFeaturesDiscovered(features);
    this.goals.onScreen(state);
    return { features, unstable: this.learning.isUnstable(state.signature) };
  }

  /**
   * THE decision. Given the current screen and the candidate actions the
   * execution layer enumerated, decide whether to act (and on what), backtrack
   * toward unmet goals, or stop. This is the only planning entry point the
   * explorer calls to drive the loop.
   */
  async decide(state: ScreenState, candidates: Interaction[], graph: ScreenGraph): Promise<ActionDecision> {
    if (candidates.length > 0) {
      this.barrenBacktracks = 0;
      return this.chooseAction(state, candidates);
    }

    // Nothing to do on this screen — is the RUN done, or just this screen?
    const keepGoing = this.shouldContinue(graph);
    const frontier = graph.frontier().length > 0;
    if (keepGoing && (frontier || this.reexplorePending) && this.barrenBacktracks < MAX_BARREN_BACKTRACKS) {
      this.barrenBacktracks += 1;
      return {
        kind: 'backtrack',
        reason: this.reexplorePending
          ? 'Re-exploring affected workflows after a state change.'
          : 'Screen exhausted — navigating toward screens with unmet goals.',
        source: this.reexplorePending ? 'reexplore' : 'coverage',
      };
    }
    return {
      kind: 'stop',
      reason: this.barrenBacktracks >= MAX_BARREN_BACKTRACKS
        ? 'No new ground reachable after repeated backtracking.'
        : 'Coverage goals met or no meaningful actions remain.',
      source: 'coverage',
    };
  }

  private async chooseAction(state: ScreenState, candidates: Interaction[]): Promise<ActionDecision> {
    // Learning: drop known dead ends unless that leaves nothing.
    const live = candidates.filter((c) => !this.learning.isDeadEnd(c.key));
    const pool = live.length > 0 ? live : candidates;

    const ranked = this.goals.rank(state, pool, (k) => this.learning.isProductive(k));
    let chosen = ranked[0]?.interaction ?? pool[0];
    let source: ActionDecision['source'] = this.reexplorePending ? 'reexplore' : 'goal';
    let reason = ranked[0] ? `Advances goal "${ranked[0].goal}".` : 'First available action.';

    if (this.ai.shouldConsult(state, pool)) {
      const pick = await this.ai.chooseNext(state, pool, this.goals.orderedUnmet(), {
        coverageOverall: this.lastSnapshot?.overall,
        knownScreen: this.learning.isKnownScreen(state.signature),
        versionChanged: this.versionChanged,
        deadEndsHere: candidates.length - pool.length,
        isPriorProductive: (k) => this.learning.isProductive(k),
      });
      if (pick) { chosen = pool[pick.index]; source = 'ai'; reason = `AI: ${pick.reason}`; }
    }

    return { kind: 'act', interaction: chosen, reason, source };
  }

  /** Record the outcome of an executed action against the active goal. */
  recordResult(state: ScreenState, action: Interaction, navigated: boolean): void {
    this.goals.recordProgress(state, action, navigated);
    if (navigated) {
      this.productive.add(action.key);
      this.deadEnds.delete(action.key);
      this.featureMap.markExercised(action.key);
      for (const g of this.goals.all()) {
        if (g.status === 'satisfied') this.featureMap.completeWorkflowsFor(g.kind);
      }
    } else if (!this.productive.has(action.key)) {
      this.deadEnds.add(action.key);
    }
    if (this.reexploreBudget > 0) this.reexploreBudget -= 1;
  }

  /** Remember a crash/ANR location so future runs test it first (failing-feature focus). */
  recordCrashLocation(signature: string, label: string, title: string): void {
    this.unstable.add(signature);
    this.crashes.push({ signature, label, title });
  }

  markUnstable(signature: string): void { this.unstable.add(signature); }

  /** Remember an ad/paywall location so future runs anticipate the blocker. */
  recordBlocker(kind: 'ad' | 'paywall', screen: string): void {
    this.blockers.push({ kind, screen });
  }

  /**
   * Adaptive, TARGETED re-exploration. A state change re-opens only the
   * workflows it could have unlocked, grants a re-exploration budget, and does
   * NOT restart the app — the explorer keeps navigating the live session.
   */
  noteStateChange(kind: StateChangeKind, log?: Logger): void {
    const affected = AFFECTED_BY_CHANGE[kind] ?? [];
    const reopened = this.goals.reopen(affected);
    if (reopened > 0) this.reexploreBudget = Math.max(this.reexploreBudget, reopened * 4);
    void (log ?? this.log)('info',
      `State change (${kind}) → re-exploring ${reopened} affected workflow(s): ${affected.join(', ') || '(none)'}.`);
  }

  get reexplorePending(): boolean { return this.reexploreBudget > 0; }

  snapshot(graph: ScreenGraph): CoverageSnapshot {
    this.lastSnapshot = this.coverage.snapshot(graph, this.featureMap);
    return this.lastSnapshot;
  }

  shouldContinue(graph: ScreenGraph): boolean {
    const snap = this.snapshot(graph);
    const pendingActions = graph.frontier().reduce((s, n) => s + n.pendingActions.size, 0);
    return this.coverage.shouldContinue(snap, {
      pendingActions,
      unmetGoals: this.goals.unmetCount(),
      reexplorePending: this.reexplorePending,
    });
  }

  setModuleCompletion(count: number): void { this.coverage.setModulesComplete(count); }

  // ------- Knowledge accessors used by the engine to persist after the run.
  productiveActions(): string[] { return Array.from(this.productive); }
  deadEndActions(): string[] { return Array.from(this.deadEnds); }
  unstableScreens(): string[] { return Array.from(this.unstable); }
  crashLocations(): CrashLocation[] { return [...this.crashes]; }
  adsPaywalls(): BlockerLocation[] { return [...this.blockers]; }
  lastCoverage(): CoverageSnapshot | null { return this.lastSnapshot; }

  /** The successful interaction sequence each satisfied goal produced. */
  interactionSequences(): InteractionSequence[] {
    return this.goals.all()
      .filter((g) => g.sequence.length > 0)
      .map((g) => ({ goal: g.kind, keys: g.sequence.slice() }));
  }

  summary(): string {
    return [this.goals.summary(), this.featureMap.summary(), `AI planner calls: ${this.ai.callsMade}.`, this.learning.describe()].join('\n');
  }
}
