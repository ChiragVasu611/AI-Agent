import { Schema, model, models } from 'mongoose';

const seoCompetitorSchema = new Schema({
  projectId: { type: Schema.Types.ObjectId, ref: 'SeoProject', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true },
  url: { type: String, default: null },

  missingOpportunities: { type: [String], default: [] },
  improvementSuggestions: { type: [String], default: [] },
  competitiveAdvantages: { type: [String], default: [] },

  comparison: { type: Schema.Types.Mixed, default: null }, // title/meta/heading counts side-by-side, when url provided
  status: { type: String, enum: ['queued', 'completed', 'failed'], default: 'queued' },
}, { timestamps: true });

export const SeoCompetitor = models.SeoCompetitor ?? model('SeoCompetitor', seoCompetitorSchema);
