import type { Interaction, ScreenState } from '../types';
import { labelOf, shortId } from '../ui-parser';
import type { Feature, GoalKind, TestingGoal } from './types';

/**
 * The Goal Planner — the single decision maker's goal model.
 *
 * Replaces blind DFS/BFS with a dynamic, prioritised queue of FEATURE-oriented
 * testing goals (Login, Search, Checkout, Settings, Profile, Camera, Sharing,
 * Payments, …) — the way a human QA engineer works. Goals are seeded from the
 * canonical set AND created dynamically as features are discovered; they are
 * reprioritised, paused, resumed, or discarded as application state changes.
 *
 * A goal is NOT satisfied because a screen was seen. It is satisfied only when
 * its expected workflow was exercised: the feature was reached AND a meaningful
 * interaction advanced it, with evidence captured. The planner never drives the
 * device — it only RANKS the candidate interactions the execution layer already
 * enumerated.
 */

interface GoalSeed { kind: GoalKind; label: string; priority: number; evidenceTarget: number; }

const SEEDS: GoalSeed[] = [
  { kind: 'onboarding', label: 'Complete onboarding', priority: 55, evidenceTarget: 1 },
  { kind: 'login', label: 'Authentication / login', priority: 90, evidenceTarget: 2 },
  { kind: 'signup', label: 'Account creation', priority: 60, evidenceTarget: 1 },
  { kind: 'navigation', label: 'Primary navigation', priority: 80, evidenceTarget: 3 },
  { kind: 'content', label: 'Core content / home', priority: 75, evidenceTarget: 3 },
  { kind: 'search', label: 'Search', priority: 78, evidenceTarget: 2 },
  { kind: 'forms', label: 'Form input & validation', priority: 65, evidenceTarget: 2 },
  { kind: 'settings', label: 'Settings', priority: 62, evidenceTarget: 2 },
  { kind: 'profile', label: 'Profile / account', priority: 60, evidenceTarget: 2 },
  { kind: 'permissions', label: 'Runtime permissions', priority: 70, evidenceTarget: 1 },
  { kind: 'camera', label: 'Camera', priority: 50, evidenceTarget: 1 },
  { kind: 'media', label: 'Media / gallery', priority: 52, evidenceTarget: 2 },
  { kind: 'checkout', label: 'Checkout / cart (no purchase)', priority: 68, evidenceTarget: 2 },
  { kind: 'notifications', label: 'Notifications', priority: 48, evidenceTarget: 1 },
  { kind: 'sharing', label: 'Sharing / invite', priority: 40, evidenceTarget: 1 },
  { kind: 'account', label: 'Account management', priority: 45, evidenceTarget: 1 },
];

/** Label/id vocabulary that indicates an interaction advances a given goal. */
const GOAL_HINTS: Record<GoalKind, RegExp> = {
  onboarding: /\b(next|skip|get started|continue|done|finish)\b/i,
  login: /\b(login|log ?in|sign ?in|continue|submit|email|password)\b/i,
  signup: /\b(sign ?up|register|create|join)\b/i,
  navigation: /\b(home|menu|tab|back|drawer|explore|browse)\b/i,
  content: /\b(home|feed|list|item|detail|read|open|view|card)\b/i,
  search: /\b(search|find|query|filter|magnif)\b/i,
  forms: /\b(submit|save|apply|send|ok|confirm|field|input)\b/i,
  settings: /\b(setting|preference|option|config|toggle|switch)\b/i,
  profile: /\b(profile|account|me|avatar|edit)\b/i,
  permissions: /\b(allow|grant|permission|enable)\b/i,
  camera: /\b(camera|capture|scan|shutter|record|photo)\b/i,
  media: /\b(gallery|photo|video|media|download|play|library)\b/i,
  checkout: /\b(cart|checkout|basket|order|add to)\b/i,
  notifications: /\b(notification|alert|inbox|bell)\b/i,
  sharing: /\b(share|invite|refer|send)\b/i,
  account: /\b(account|manage|subscription|billing)\b/i,
};

/** After this many active attempts with no progress a goal is discarded as unreachable. */
const MAX_BARREN_ATTEMPTS = 10;

export class GoalPlanner {
  private goals = new Map<GoalKind, TestingGoal>();
  private active: GoalKind | null = null;
  private deprioritise: Set<GoalKind>;
  private boost: Set<GoalKind>;
  /** Goals already given their one recovery pass — see recordProgress(). */
  private readonly recoveryTried = new Set<GoalKind>();
  private readonly recoveryQueue: GoalKind[] = [];

  constructor(opts: { deprioritise?: GoalKind[]; boost?: GoalKind[] } = {}) {
    this.deprioritise = new Set(opts.deprioritise ?? []);
    this.boost = new Set(opts.boost ?? []);
    for (const s of SEEDS) this.create(s.kind, s.label, s.priority, s.evidenceTarget, false);
  }

  private create(kind: GoalKind, label: string, priority: number, evidenceTarget: number, dynamic: boolean): TestingGoal {
    let p = priority;
    if (this.deprioritise.has(kind)) p -= 30; // learned: already well covered
    if (this.boost.has(kind)) p += 25;        // learned: unstable / new in this version
    const g: TestingGoal = {
      id: `goal:${kind}`, kind, label, priority: p, status: 'pending',
      reached: false, progressed: false, evidenceCount: 0, evidenceTarget,
      relatedScreens: new Set(), sequence: [], attempts: 0, dynamic, note: '',
    };
    this.goals.set(kind, g);
    return g;
  }

  /**
   * Dynamically creates goals for freshly discovered features and raises the
   * priority of goals whose features are showing up — goals are born from
   * live application state, not just the static seed set.
   */
  onFeaturesDiscovered(features: Feature[]): void {
    for (const f of features) {
      if (f.kind === 'unknown') continue;
      const existing = this.goals.get(f.kind);
      if (!existing) {
        const seed = SEEDS.find((s) => s.kind === f.kind);
        const g = this.create(f.kind, seed?.label ?? f.name, seed?.priority ?? 55, seed?.evidenceTarget ?? 1, true);
        g.note = `Discovered from feature "${f.name}".`;
      } else if (existing.status === 'pending') {
        existing.priority += 4; // seeing the feature makes it more worth testing now
      } else if (existing.status === 'paused') {
        existing.status = 'pending'; // the feature reappeared — resume it
      }
    }
  }

  private goalFor(kind: string): TestingGoal | undefined {
    return this.goals.get(kind as GoalKind);
  }

  /** Activates the goal matching the current screen and marks it reached. */
  onScreen(state: ScreenState): TestingGoal | null {
    const match = this.matchGoal(state);
    if (!match) {
      // No goal owns this screen. Clear the active goal rather than leaving the
      // previous one selected, so the next interaction's outcome is not credited
      // to a goal the user never navigated to.
      this.active = null;
      return null;
    }
    this.active = match.kind;
    if (match.status === 'pending' || match.status === 'paused') match.status = 'active';
    match.reached = true;
    match.relatedScreens.add(state.signature);
    return match;
  }

  /**
   * Which goal the current screen belongs to.
   *
   * Screen KIND is authoritative when the classifier recognised one. Otherwise
   * the screen's own controls are matched against goal vocabulary — and the
   * candidate goals are tried in PRIORITY order, highest first.
   *
   * Both details matter. Matching used to run over every label on the screen
   * (body copy included) in `Object.entries(GOAL_HINTS)` order, which is
   * declaration order — so `onboarding` was tested first and any screen
   * containing "next", "continue" or "done" was credited to onboarding, while
   * anything with the word "open" or "view" fell to `content`. Goal progress was
   * therefore attributed almost arbitrarily, and goals were marked satisfied by
   * interactions that had nothing to do with them.
   */
  private matchGoal(state: ScreenState): TestingGoal | undefined {
    const direct: Partial<Record<string, GoalKind>> = {
      login: 'login', signup: 'signup', settings: 'settings', profile: 'profile',
      search: 'search', checkout: 'checkout', camera: 'camera', gallery: 'media',
      onboarding: 'onboarding', permission_dialog: 'permissions',
    };
    const byKind = direct[state.kind];
    if (byKind && this.goals.has(byKind)) return this.goals.get(byKind);

    // Only interactive controls and the screen's title carry goal meaning; a
    // paragraph of marketing copy does not.
    const controlText = state.nodes
      .filter((n) => n.clickable || n.checkable || n.bounds.top < state.screenHeight * 0.15)
      .map((n) => labelOf(n))
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (controlText) {
      for (const g of this.orderedUnmet()) {
        if (GOAL_HINTS[g.kind]?.test(controlText)) return g;
      }
    }

    // No recognisable goal on this screen. Fall back to the broad content goal
    // only when it is still unmet, so a satisfied goal is never re-credited.
    const content = this.goals.get('content');
    return content && content.status !== 'satisfied' ? content : undefined;
  }

  /**
   * Records that an interaction was executed while the active goal was in play.
   * Feature completion is workflow-based: reached + at least one navigating
   * interaction (evidence) satisfies the goal.
   */
  recordProgress(state: ScreenState, action: Interaction, navigated: boolean): void {
    if (!this.active) return;
    const g = this.goals.get(this.active);
    if (!g) return;
    g.attempts += 1;
    if (navigated) {
      g.progressed = true;
      g.evidenceCount += 1;
      g.sequence.push(action.key);
      if (g.sequence.length > 12) g.sequence.shift();
    }
    if (g.reached && g.progressed && g.evidenceCount >= g.evidenceTarget && g.status === 'active') {
      g.status = 'satisfied';
      g.note = `Workflow exercised: reached + ${g.evidenceCount} navigating interaction(s).`;
    } else if (g.attempts >= MAX_BARREN_ATTEMPTS && g.evidenceCount === 0 && g.status === 'active') {
      // Repeatedly active but never advanced. Give it ONE recovery pass — the
      // usual cause is a blocker (ad/paywall/pop-up) that has since been
      // cleared, or a screen that needed a scroll to reveal its real controls —
      // before writing the goal off, so a transient obstacle doesn't
      // permanently cost the run a feature.
      if (!this.recoveryTried.has(g.kind)) {
        this.recoveryTried.add(g.kind);
        g.status = 'pending';
        g.attempts = 0;
        g.note = `No progress in ${MAX_BARREN_ATTEMPTS} attempts — re-queued for one recovery pass.`;
        this.recoveryQueue.push(g.kind);
      } else {
        g.status = 'unreachable';
        g.note = `Unreachable: ${MAX_BARREN_ATTEMPTS} attempts before and after a recovery pass produced no navigation.`;
      }
    }
  }

  /** Goals awaiting a recovery pass, drained by the caller for logging. */
  drainRecoveryQueue(): GoalKind[] {
    const out = [...this.recoveryQueue];
    this.recoveryQueue.length = 0;
    return out;
  }

  /**
   * Per-goal verdict for the run report: what was reached, what wasn't, and the
   * concrete reason why — so an incomplete run explains itself instead of just
   * reporting a coverage percentage.
   */
  verdict(): Array<{ kind: GoalKind; label: string; status: TestingGoal['status']; reason: string }> {
    return this.all().map((g) => ({
      kind: g.kind,
      label: g.label,
      status: g.status,
      reason: g.note
        || (g.status === 'satisfied'
          ? 'Workflow exercised with navigating evidence.'
          : g.reached
            ? `Screen reached but the workflow never advanced (${g.evidenceCount}/${g.evidenceTarget} evidence).`
            : 'Never reached during this run — no screen matching the feature was discovered.'),
    }));
  }

  markBlocked(kind: GoalKind, note: string): void {
    const g = this.goals.get(kind);
    if (g) { g.status = 'blocked'; g.note = note; }
  }

  pause(kind: GoalKind, note = ''): void {
    const g = this.goals.get(kind);
    if (g && (g.status === 'active' || g.status === 'pending')) { g.status = 'paused'; g.note = note; }
  }

  resume(kind: GoalKind): void {
    const g = this.goals.get(kind);
    if (g && (g.status === 'paused' || g.status === 'blocked')) g.status = 'pending';
  }

  /**
   * Targeted re-open after a state change: only the goals a change could have
   * unlocked are re-queued (not the whole app), with their progress reset so
   * their workflows are exercised again against the new state.
   */
  reopen(kinds: GoalKind[]): number {
    let n = 0;
    for (const kind of kinds) {
      const g = this.goals.get(kind);
      if (!g || g.status === 'unreachable') continue;
      g.status = 'pending';
      g.progressed = false;
      g.evidenceCount = Math.max(0, g.evidenceCount - g.evidenceTarget);
      n += 1;
    }
    return n;
  }

  /** Ranks candidate interactions against the goal queue, best-first. */
  rank(
    state: ScreenState,
    candidates: Interaction[],
    isPriorProductive: (key: string) => boolean = () => false,
  ): Array<{ interaction: Interaction; score: number; goal: GoalKind }> {
    const ordered = this.orderedUnmet();
    const topGoal = ordered[0]?.kind ?? 'content';

    return candidates
      .map((c) => {
        const label = `${c.target ? labelOf(c.target) : ''} ${c.target ? shortId(c.target) : ''} ${c.reason}`.toLowerCase();
        let score = 1;
        let goal: GoalKind = topGoal;

        for (const g of ordered) {
          if (GOAL_HINTS[g.kind].test(label)) { score += g.priority / 20; goal = g.kind; break; }
        }
        // Feature-discovery bias.
        if (c.kind === 'type') score += 2;
        if (c.kind === 'toggle') score += 1.5;
        if (c.kind === 'swipe_right' && c.reason.includes('drawer')) score += 3;
        if (c.kind === 'tap' && c.target && labelOf(c.target).length > 0) score += 1;
        // Learning: a known-productive action is a reliable shortcut — prefer it.
        if (isPriorProductive(c.key)) score += 2.5;
        return { interaction: c, score, goal };
      })
      .sort((a, b) => b.score - a.score);
  }

  orderedUnmet(): TestingGoal[] {
    return Array.from(this.goals.values())
      .filter((g) => g.status === 'pending' || g.status === 'active' || g.status === 'paused')
      .sort((a, b) => b.priority - a.priority);
  }

  unmetCount(): number { return this.orderedUnmet().length; }
  all(): TestingGoal[] { return Array.from(this.goals.values()).sort((a, b) => b.priority - a.priority); }
  satisfiedCount(): number { return Array.from(this.goals.values()).filter((g) => g.status === 'satisfied').length; }
  activeKind(): GoalKind | null { return this.active; }

  summary(): string {
    const parts = this.all().map((g) => `${g.kind}:${g.status}${g.evidenceCount ? `(${g.evidenceCount}/${g.evidenceTarget})` : ''}`);
    return `Goals ${this.satisfiedCount()}/${this.goals.size} satisfied — ${parts.join(', ')}`;
  }
}
