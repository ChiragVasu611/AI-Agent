import type { ScreenState, UiNode } from '../types';
import { labelOf, shortId } from '../ui-parser';
import { actionKey } from '../interaction-engine';
import type { Feature, GoalKind, Workflow } from './types';

/**
 * The Feature Map.
 *
 * Where the ScreenGraph records "which screens exist and how they connect",
 * the FeatureMap records "what the app can DO". Features are inferred from
 * signals present in EVERY Android app — screen kind, bottom navigation bars,
 * navigation drawers, tab layouts, overflow menus, accessibility metadata, and
 * resource-id vocabulary — never from app-specific hardcoding. Features that
 * appear together in the same navigation surface are linked as related, and
 * the sequence of visited screens is recorded as workflows.
 */

/** Generic resource-id / label vocabulary → feature kind. Ecosystem-wide, not per-app. */
const FEATURE_VOCAB: Array<{ kind: GoalKind; re: RegExp }> = [
  { kind: 'search', re: /\b(search|find|query|explore|discover)\b/ },
  { kind: 'checkout', re: /\b(cart|checkout|basket|order|payment|billing|pay)\b/ },
  { kind: 'profile', re: /\b(profile|account|me|my ?account|avatar)\b/ },
  { kind: 'settings', re: /\b(settings|preferences|config|options)\b/ },
  { kind: 'notifications', re: /\b(notification|alerts?|inbox|activity)\b/ },
  { kind: 'camera', re: /\b(camera|capture|scan|shutter|record)\b/ },
  { kind: 'media', re: /\b(gallery|photos?|videos?|library|media|downloads?|player)\b/ },
  { kind: 'sharing', re: /\b(share|invite|refer|send to)\b/ },
  { kind: 'login', re: /\b(login|log ?in|sign ?in|auth)\b/ },
  { kind: 'signup', re: /\b(sign ?up|register|create account|join)\b/ },
  { kind: 'content', re: /\b(home|feed|for you|dashboard|browse|list|catalog)\b/ },
];

/** Map a screen kind straight onto a goal kind where they align 1:1. */
const KIND_TO_GOAL: Partial<Record<ScreenState['kind'], GoalKind>> = {
  login: 'login', signup: 'signup', settings: 'settings', profile: 'profile',
  search: 'search', checkout: 'checkout', camera: 'camera', gallery: 'media',
  product: 'content', home: 'content', dashboard: 'content', list: 'content',
  onboarding: 'onboarding',
};

function classifyLabel(text: string): GoalKind | null {
  const hay = text.toLowerCase();
  for (const { kind, re } of FEATURE_VOCAB) if (re.test(hay)) return kind;
  return null;
}

/** Detects a bottom navigation bar and returns its item nodes (generic geometry + class). */
function bottomNavItems(state: ScreenState): UiNode[] {
  const h = state.screenHeight;
  const bar = state.nodes.filter(
    (n) => /BottomNavigation|TabLayout|BottomBar|navigation_bar|nav_host/i.test(`${n.className} ${n.resourceId}`)
      && n.bounds.top > h * 0.8,
  );
  if (bar.length > 0) {
    return state.nodes.filter(
      (n) => n.clickable && n.enabled && n.bounds.top > h * 0.8 && labelOf(n).length > 0,
    );
  }
  // Fallback: a horizontal row of >=3 clickable, labelled items anchored to the bottom.
  const bottomClickables = state.nodes.filter(
    (n) => n.clickable && n.enabled && n.bounds.top > h * 0.85 && labelOf(n).length > 0,
  );
  return bottomClickables.length >= 3 ? bottomClickables : [];
}

/** Drawer / tab items when a DrawerLayout or TabLayout is present. */
function navContainerItems(state: ScreenState): UiNode[] {
  const hasNav = state.nodes.some((n) => /DrawerLayout|NavigationView|TabLayout|ViewPager/i.test(n.className));
  if (!hasNav) return [];
  return state.nodes.filter((n) => n.clickable && n.enabled && labelOf(n).length > 0).slice(0, 12);
}

export class FeatureMap {
  private features = new Map<string, Feature>();
  private workflows = new Map<string, Workflow>();
  /** Ordered trail of visited screen labels, used to derive workflows. */
  private trail: string[] = [];

  /** Restores previously-persisted features so cross-run knowledge is reused. */
  seed(features: Feature[], workflows: Workflow[]): void {
    for (const f of features) this.features.set(f.id, f);
    for (const w of workflows) this.workflows.set(w.id, w);
  }

  private ensure(kind: GoalKind | 'unknown', name: string, source: Feature['source'], step: number): Feature {
    const id = `feat:${kind}:${name.toLowerCase().replace(/\s+/g, '_').slice(0, 40)}`;
    let f = this.features.get(id);
    if (!f) {
      f = {
        id, name, kind, source,
        screens: new Set(), entryActions: new Set(), related: new Set(),
        exercised: false, discoveredAtStep: step,
      };
      this.features.set(id, f);
    }
    return f;
  }

  /**
   * Inspects a screen and grows the feature graph. Returns the features found
   * on this screen so the goal planner can react to fresh discoveries.
   */
  observe(state: ScreenState, step: number): Feature[] {
    const found: Feature[] = [];

    // 1. The screen's own kind is a feature.
    const kindGoal = KIND_TO_GOAL[state.kind];
    if (kindGoal) {
      const f = this.ensure(kindGoal, state.label, 'screen_kind', step);
      f.screens.add(state.signature);
      found.push(f);
    }

    // 2. Navigation surfaces (bottom nav / drawer / tabs) — each item is a feature,
    //    and items sharing a surface are related to each other.
    const navItems = [...bottomNavItems(state), ...navContainerItems(state)];
    const navFeatures: Feature[] = [];
    for (const n of navItems) {
      const text = labelOf(n) || shortId(n);
      const kind = classifyLabel(text) ?? 'unknown';
      const f = this.ensure(kind, text, /Bottom|nav/i.test(n.className) ? 'bottom_nav' : 'tabs', step);
      f.screens.add(state.signature);
      f.entryActions.add(actionKey(state.signature, 'tap', n));
      navFeatures.push(f);
      found.push(f);
    }
    for (const a of navFeatures) for (const b of navFeatures) if (a.id !== b.id) a.related.add(b.id);

    // 3. Resource-id / content-desc vocabulary anywhere in the tree (menus, buttons, a11y).
    for (const n of state.nodes) {
      const hay = `${shortId(n)} ${n.contentDesc}`;
      const kind = classifyLabel(hay);
      if (kind && (n.clickable || n.contentDesc)) {
        const f = this.ensure(kind, kind, n.contentDesc ? 'accessibility' : 'resource_id', step);
        f.screens.add(state.signature);
        if (n.clickable) f.entryActions.add(actionKey(state.signature, 'tap', n));
        found.push(f);
      }
    }

    // 4. Extend the workflow trail.
    if (this.trail[this.trail.length - 1] !== state.label) {
      this.trail.push(state.label);
      if (this.trail.length > 24) this.trail.shift();
      this.recordWorkflow(kindGoal ?? classifyLabel(state.label) ?? 'navigation');
    }

    return dedupe(found);
  }

  /** Marks a feature exercised once an interaction actually engaged it. */
  markExercised(actionKeyStr: string): void {
    for (const f of Array.from(this.features.values())) {
      if (f.entryActions.has(actionKeyStr)) f.exercised = true;
    }
  }

  private recordWorkflow(goal: GoalKind): void {
    if (this.trail.length < 3) return;
    const steps = this.trail.slice(-4);
    const id = `wf:${goal}:${steps.join('>').toLowerCase().slice(0, 60)}`;
    if (!this.workflows.has(id)) {
      this.workflows.set(id, { id, name: steps.join(' → '), goal, steps, complete: false });
    }
  }

  /** Flags a workflow as completed when its terminal goal screen was reached. */
  completeWorkflowsFor(goal: GoalKind): void {
    for (const w of Array.from(this.workflows.values())) if (w.goal === goal) w.complete = true;
  }

  allFeatures(): Feature[] { return Array.from(this.features.values()); }
  allWorkflows(): Workflow[] { return Array.from(this.workflows.values()); }
  featureCount(): number { return this.features.size; }
  exercisedCount(): number { return Array.from(this.features.values()).filter((f) => f.exercised).length; }
  workflowCount(): number { return this.workflows.size; }
  completeWorkflowCount(): number { return Array.from(this.workflows.values()).filter((w) => w.complete).length; }

  summary(): string {
    const byKind = new Map<string, number>();
    for (const f of Array.from(this.features.values())) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
    const parts = Array.from(byKind.entries()).map(([k, n]) => `${k}×${n}`);
    return `Features: ${this.features.size} (${parts.join(', ')}); exercised ${this.exercisedCount()}; workflows ${this.completeWorkflowCount()}/${this.workflows.size}.`;
  }
}

function dedupe(features: Feature[]): Feature[] {
  const seen = new Set<string>();
  const out: Feature[] = [];
  for (const f of features) if (!seen.has(f.id)) { seen.add(f.id); out.push(f); }
  return out;
}
