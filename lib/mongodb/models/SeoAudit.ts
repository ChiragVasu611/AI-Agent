import { Schema, model, models } from 'mongoose';

/**
 * Covers both a real Playwright-driven website SEO audit (type: 'website')
 * and a user-metadata-driven App Store Optimization audit (type: 'aso') —
 * one model, discriminated by `type`, since both produce the same shape:
 * a list of scored findings plus a severity/category breakdown.
 */
const seoAuditSchema = new Schema({
  projectId: { type: Schema.Types.ObjectId, ref: 'SeoProject', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['website', 'aso'], required: true },
  target: { type: String, required: true }, // URL audited, or "ASO metadata"
  status: { type: String, enum: ['queued', 'running', 'completed', 'failed'], default: 'queued' },
  errorMessage: { type: String, default: null },

  findings: [{
    category: String,
    item: String,
    status: { type: String, enum: ['pass', 'fail', 'warn'] },
    severity: { type: String, enum: ['critical', 'high', 'medium', 'low'] },
    detail: String,
    recommendation: String,
  }],

  counts: {
    critical: { type: Number, default: 0 },
    high: { type: Number, default: 0 },
    medium: { type: Number, default: 0 },
    low: { type: Number, default: 0 },
    passed: { type: Number, default: 0 },
  },

  scoreBreakdown: { type: Schema.Types.Mixed, default: null },
  rawMeta: { type: Schema.Types.Mixed, default: null }, // extracted title/meta/headings/etc, or submitted ASO fields

  completedAt: { type: Date, default: null },
}, { timestamps: true });

export const SeoAudit = models.SeoAudit ?? model('SeoAudit', seoAuditSchema);
