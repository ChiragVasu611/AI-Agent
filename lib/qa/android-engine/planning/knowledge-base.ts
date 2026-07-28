import { QaAppKnowledge } from '@/lib/mongodb/models/QaAppKnowledge';
import type { ScreenGraph } from '../graph';
import type { FeatureMap } from './feature-map';
import type { CoverageSnapshot, Feature, Workflow } from './types';

/**
 * The Knowledge Base.
 *
 * Reads and writes the persistent QaAppKnowledge document for an app so the
 * engine gets SMARTER across runs. It reuses screen signatures, the feature
 * graph, workflows, productive shortcuts and dead ends, and it detects when
 * the APK version has changed so the LearningEngine can decide what to re-test.
 */

export interface InteractionSequence { goal: string; keys: string[]; }
export interface CrashLocation { signature: string; label: string; title: string; }
export interface BlockerLocation { kind: 'ad' | 'paywall'; screen: string; }

export interface AppKnowledge {
  packageName: string;
  appVersion: string;
  knownVersion: string;
  versionChanged: boolean;
  isFirstRun: boolean;
  runCount: number;
  screenSignatures: string[];
  features: Feature[];
  workflows: Workflow[];
  productiveActions: string[];
  interactionSequences: InteractionSequence[];
  deadEndActions: string[];
  unstableScreens: string[];
  crashLocations: CrashLocation[];
  adsPaywalls: BlockerLocation[];
  coverage: Partial<CoverageSnapshot> | null;
  coverageHistory: Array<{ version: string; overall: number; at: string; runId: string }>;
  versionHistory: Array<{ version: string; at: string; runId: string }>;
}

function reviveFeature(raw: any): Feature {
  return {
    id: String(raw.id),
    name: String(raw.name ?? ''),
    kind: raw.kind ?? 'unknown',
    source: raw.source ?? 'screen_kind',
    screens: new Set<string>(raw.screens ?? []),
    entryActions: new Set<string>(raw.entryActions ?? []),
    related: new Set<string>(raw.related ?? []),
    exercised: Boolean(raw.exercised),
    discoveredAtStep: Number(raw.discoveredAtStep ?? 0),
  };
}

function dehydrateFeature(f: Feature) {
  return {
    id: f.id, name: f.name, kind: f.kind, source: f.source,
    screens: Array.from(f.screens), entryActions: Array.from(f.entryActions),
    related: Array.from(f.related), exercised: f.exercised, discoveredAtStep: f.discoveredAtStep,
  };
}

export class KnowledgeBase {
  /** Loads prior knowledge for (user, package). Returns a first-run stub if none. */
  static async load(userId: string, packageName: string, appVersion: string): Promise<AppKnowledge> {
    const doc = await QaAppKnowledge.findOne({ userId, packageName }).lean<any>();
    if (!doc) return KnowledgeBase.emptyKnowledge(packageName, appVersion);

    const knownVersion = String(doc.appVersion ?? '');
    return {
      packageName,
      appVersion,
      knownVersion,
      versionChanged: Boolean(appVersion && knownVersion && appVersion !== knownVersion),
      isFirstRun: false,
      runCount: Number(doc.runCount ?? 0),
      screenSignatures: (doc.screens ?? []).map((s: any) => String(s.signature ?? s)).filter(Boolean),
      features: (doc.features ?? []).map(reviveFeature),
      workflows: (doc.workflows ?? []) as Workflow[],
      productiveActions: doc.productiveActions ?? [],
      interactionSequences: doc.interactionSequences ?? [],
      deadEndActions: doc.deadEndActions ?? [],
      unstableScreens: doc.unstableScreens ?? [],
      crashLocations: doc.crashLocations ?? [],
      adsPaywalls: doc.adsPaywalls ?? [],
      coverage: doc.coverage ?? null,
      coverageHistory: doc.coverageHistory ?? [],
      versionHistory: doc.versionHistory ?? [],
    };
  }

  /** A first-run knowledge stub with everything empty. */
  static emptyKnowledge(packageName: string, appVersion: string): AppKnowledge {
    return {
      packageName, appVersion, knownVersion: '', versionChanged: false, isFirstRun: true,
      runCount: 0, screenSignatures: [], features: [], workflows: [],
      productiveActions: [], interactionSequences: [], deadEndActions: [],
      unstableScreens: [], crashLocations: [], adsPaywalls: [],
      coverage: null, coverageHistory: [], versionHistory: [],
    };
  }

  /** Persists everything the run learned, merged with prior knowledge. */
  static async save(opts: {
    userId: string;
    packageName: string;
    appName: string;
    appVersion: string;
    runId: string;
    graph: ScreenGraph;
    features: FeatureMap;
    coverage: CoverageSnapshot;
    productiveActions: string[];
    interactionSequences: InteractionSequence[];
    deadEndActions: string[];
    unstableScreens: string[];
    crashLocations: CrashLocation[];
    adsPaywalls: BlockerLocation[];
    metrics: Record<string, unknown>;
    prior: AppKnowledge;
    at: Date;
  }): Promise<void> {
    const screens = opts.graph.allNodes().map((n) => ({
      signature: n.signature, label: n.label, kind: n.kind, activity: n.activity,
      visitCount: n.visitCount, exhausted: n.exhausted,
    }));

    // A version bump keeps prior signatures as history but the new run's data wins.
    const mergedProductive = unique([...opts.prior.productiveActions, ...opts.productiveActions]);
    const mergedDeadEnds = unique([...opts.prior.deadEndActions, ...opts.deadEndActions])
      .filter((k) => !mergedProductive.includes(k)); // a key that ever navigated isn't a dead end
    const mergedUnstable = unique([...opts.prior.unstableScreens, ...opts.unstableScreens]);
    const mergedSequences = dedupeSequences([...opts.prior.interactionSequences, ...opts.interactionSequences]);
    const mergedCrashes = dedupeBy([...opts.prior.crashLocations, ...opts.crashLocations], (c) => `${c.signature}|${c.title}`);
    const mergedBlockers = dedupeBy([...opts.prior.adsPaywalls, ...opts.adsPaywalls], (b) => `${b.kind}|${b.screen}`);

    const at = opts.at.toISOString();
    const versionHistory = appendCapped(
      opts.prior.versionHistory,
      { version: opts.appVersion, at, runId: opts.runId },
      (v) => v.version, 25,
    );
    const coverageHistory = [
      ...opts.prior.coverageHistory,
      { version: opts.appVersion, overall: opts.coverage.overall, at, runId: opts.runId },
    ].slice(-50);

    await QaAppKnowledge.updateOne(
      { userId: opts.userId, packageName: opts.packageName },
      {
        $set: {
          appName: opts.appName,
          appVersion: opts.appVersion,
          screens,
          features: opts.features.allFeatures().map(dehydrateFeature),
          workflows: opts.features.allWorkflows(),
          productiveActions: mergedProductive.slice(0, 2000),
          interactionSequences: mergedSequences.slice(0, 400),
          deadEndActions: mergedDeadEnds.slice(0, 2000),
          unstableScreens: mergedUnstable.slice(0, 500),
          crashLocations: mergedCrashes.slice(0, 300),
          adsPaywalls: mergedBlockers.slice(0, 300),
          coverage: opts.coverage,
          coverageHistory,
          versionHistory,
          metrics: opts.metrics,
          lastRunId: opts.runId,
          lastRunAt: opts.at,
        },
        $inc: { runCount: 1 },
        $setOnInsert: { userId: opts.userId, packageName: opts.packageName },
      },
      { upsert: true },
    );
  }
}

function unique(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean)));
}

function dedupeBy<T>(arr: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) { const k = key(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}

function dedupeSequences(seqs: InteractionSequence[]): InteractionSequence[] {
  return dedupeBy(seqs.filter((s) => s.keys.length > 0), (s) => `${s.goal}:${s.keys.join('>')}`);
}

/** Appends `entry` unless the same identity already exists, keeping the last `cap`. */
function appendCapped<T>(arr: T[], entry: T, id: (x: T) => string, cap: number): T[] {
  const last = arr[arr.length - 1];
  if (last && id(last) === id(entry)) return arr.slice(-cap); // same version repeated — no new row
  return [...arr, entry].slice(-cap);
}
