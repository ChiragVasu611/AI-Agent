import type { Interaction, ScreenState } from '../types';

/**
 * Shared types for the planning layer.
 *
 * The planning layer sits ABOVE the existing explorer. The explorer remains
 * the execution layer (it observes screens, resolves blockers, and drives
 * gestures through adb); the planning layer decides WHAT to do next and WHEN
 * the run is actually finished. None of these types ever describe a bug — the
 * AI/goal layer only ever selects the next action.
 */

/** The canonical testing goals a human QA engineer works through. */
export type GoalKind =
  | 'onboarding' | 'login' | 'signup' | 'navigation' | 'search' | 'content'
  | 'forms' | 'settings' | 'profile' | 'permissions' | 'camera' | 'media'
  | 'checkout' | 'notifications' | 'sharing' | 'account';

export type GoalStatus =
  | 'pending' | 'active' | 'paused' | 'satisfied' | 'blocked' | 'unreachable';

/**
 * One item in the planner's dynamic, prioritised goal queue.
 *
 * A goal is FEATURE-oriented, not screen-oriented, and completes only when its
 * expected user workflow has actually been exercised: its feature screen was
 * reached (`reached`) AND a meaningful interaction advanced it (`progressed`),
 * with evidence captured along the way.
 */
export interface TestingGoal {
  id: string;
  kind: GoalKind;
  label: string;
  /** Higher runs first. Recomputed as coverage and features are discovered. */
  priority: number;
  status: GoalStatus;
  /** The feature's screen was reached. */
  reached: boolean;
  /** A meaningful interaction advanced the feature's workflow (navigating). */
  progressed: boolean;
  /** Navigating interactions performed while this goal was active (evidence). */
  evidenceCount: number;
  /** Evidence needed before the goal counts as satisfied. */
  evidenceTarget: number;
  /** Screen signatures where this goal was pursued. */
  relatedScreens: Set<string>;
  /** Ordered interaction keys that advanced this goal — the successful sequence. */
  sequence: string[];
  attempts: number;
  /** True when the goal was created from a discovered feature at runtime. */
  dynamic: boolean;
  note: string;
}

/** A feature inferred from the UI — richer than a screen node. */
export interface Feature {
  id: string;
  name: string;
  kind: GoalKind | 'unknown';
  /** How the feature was discovered. */
  source: 'screen_kind' | 'bottom_nav' | 'drawer' | 'tabs' | 'menu' | 'resource_id' | 'accessibility';
  /** Screen signatures that expose this feature. */
  screens: Set<string>;
  /** Interaction keys that lead into the feature. */
  entryActions: Set<string>;
  /** Related feature ids (co-located in the same nav/menu). */
  related: Set<string>;
  /** True once the feature was actually exercised (not just discovered). */
  exercised: boolean;
  discoveredAtStep: number;
}

/** A named multi-screen flow (e.g. Home → Search → Results → Detail). */
export interface Workflow {
  id: string;
  name: string;
  goal: GoalKind;
  /** Ordered screen labels making up the flow. */
  steps: string[];
  complete: boolean;
}

/** Five coverage dimensions plus a weighted overall figure, each 0..1. */
export interface CoverageSnapshot {
  screen: number;
  feature: number;
  workflow: number;
  interaction: number;
  module: number;
  overall: number;
  /** Raw counters behind the ratios, for the run log. */
  detail: {
    screensDiscovered: number;
    screensExhausted: number;
    interactionsTried: number;
    interactionsPending: number;
    featuresDiscovered: number;
    featuresExercised: number;
    workflowsKnown: number;
    workflowsComplete: number;
    modulesSelected: number;
    modulesComplete: number;
  };
}

/** The planner's answer to "what should the explorer do on this screen?". */
export interface ActionDecision {
  kind: 'act' | 'backtrack' | 'stop';
  interaction?: Interaction;
  reason: string;
  source: 'goal' | 'feature' | 'coverage' | 'ai' | 'heuristic' | 'reexplore';
}

/** A change that can unlock previously-unavailable functionality. */
export type StateChangeKind =
  | 'login' | 'permission' | 'settings' | 'purchase' | 'rotation'
  | 'language' | 'offline' | 'online';

/** Compact view of a screen the planner reasons about (kept cheap to build). */
export interface ScreenView {
  signature: string;
  label: string;
  kind: ScreenState['kind'];
  activity: string;
}
