import { Schema, model, models } from 'mongoose';

const designProjectSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true },
  brief: { type: String, required: true },
  referenceUrl: { type: String, default: null },
  platform: { type: String, enum: ['mobile', 'web', 'both'], required: true },
  style: { type: String, default: 'modern' },
  status: {
    type: String,
    enum: ['queued', 'researching', 'strategizing', 'wireframing', 'designing', 'systemizing', 'adapting', 'auditing', 'handoff', 'completed', 'failed'],
    default: 'queued',
    index: true,
  },
  progress: { type: Number, default: 0 },
  score: { type: Number, default: null },
  figmaExportUrl: { type: String, default: null },
  designSystemUrl: { type: String, default: null },
  prototypeUrl: { type: String, default: null },
  handoffUrl: { type: String, default: null },
  summary: { type: String, default: null },

  /** Deterministic requirement-analysis + screen-discovery plan, built before any AI call. */
  plan: { type: Schema.Types.Mixed, default: null },
  /** Whether any pipeline stage actually used a live AI call vs. the deterministic fallback. */
  aiEnhanced: { type: Boolean, default: false },
  uxScore: { type: Number, default: null },
  uiScore: { type: Number, default: null },
  accessibilityScore: { type: Number, default: null },
  consistencyScore: { type: Number, default: null },
  responsiveScore: { type: Number, default: null },
  reviewIssues: { type: Schema.Types.Mixed, default: [] },
}, { timestamps: true });

export const DesignProject = models.DesignProject ?? model('DesignProject', designProjectSchema);
