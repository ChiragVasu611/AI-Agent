import { Schema, model, models } from 'mongoose';

/**
 * Persistent application knowledge for the autonomous Android engine.
 *
 * One document per (userId, packageName). It accumulates what the engine has
 * learned about an app ACROSS runs: screen signatures, the inferred feature
 * graph, workflows, interactions that reliably navigate, dead ends, blockers
 * (ads/paywalls/login walls), coverage reached, and headline metrics.
 *
 * The `appVersion` field records the version the knowledge was last built
 * against. When a new run reports the same version the knowledge is reused
 * wholesale; when the version changes the engine reuses the unchanged screen
 * signatures and re-prioritises anything new or modified (see LearningEngine).
 *
 * Nothing here is a bug or a fabricated result — it is purely navigational and
 * coverage memory used to plan smarter runs.
 */
const qaAppKnowledgeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    packageName: { type: String, required: true, index: true },
    appName: { type: String, default: '' },
    appVersion: { type: String, default: '' },

    /** Every screen signature ever observed, with its stable metadata. */
    screens: { type: Schema.Types.Mixed, default: [] },
    /** Inferred feature graph (features + relationships). */
    features: { type: Schema.Types.Mixed, default: [] },
    /** Named multi-screen workflows and whether they were ever completed. */
    workflows: { type: Schema.Types.Mixed, default: [] },
    /** Interaction keys that reliably navigated (reusable shortcuts). */
    productiveActions: { type: [String], default: [] },
    /** Ordered interaction-key sequences that completed a goal's workflow. */
    interactionSequences: { type: Schema.Types.Mixed, default: [] },
    /** Interaction keys that never changed the screen (avoid re-trying). */
    deadEndActions: { type: [String], default: [] },
    /** Screens/flows where a blocker (ad/paywall/login) was hit. */
    blockers: { type: Schema.Types.Mixed, default: [] },
    /** Known ad / paywall locations, so future runs anticipate them. */
    adsPaywalls: { type: Schema.Types.Mixed, default: [] },
    /** Signatures associated with a crash/ANR — treated as unstable, tested first. */
    unstableScreens: { type: [String], default: [] },
    /** Where crashes/ANRs happened: { signature, label, title }. */
    crashLocations: { type: Schema.Types.Mixed, default: [] },

    /** Last coverage snapshot reached (0..1 per dimension). */
    coverage: { type: Schema.Types.Mixed, default: {} },
    /** Append-only coverage history: { version, overall, at, runId }. */
    coverageHistory: { type: Schema.Types.Mixed, default: [] },
    /** Append-only version history: { version, at, runId }. */
    versionHistory: { type: Schema.Types.Mixed, default: [] },
    /** Headline metrics from the most recent run (cold start, memory, etc.). */
    metrics: { type: Schema.Types.Mixed, default: {} },

    runCount: { type: Number, default: 0 },
    lastRunId: { type: String, default: null },
    lastRunAt: { type: Date, default: null },
  },
  { timestamps: true },
);

qaAppKnowledgeSchema.index({ userId: 1, packageName: 1 }, { unique: true });

export const QaAppKnowledge =
  models.QaAppKnowledge ?? model('QaAppKnowledge', qaAppKnowledgeSchema);
