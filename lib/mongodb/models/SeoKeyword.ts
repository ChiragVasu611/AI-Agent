import { Schema, model, models } from 'mongoose';

const seoKeywordSchema = new Schema({
  projectId: { type: Schema.Types.ObjectId, ref: 'SeoProject', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  keyword: { type: String, required: true },
  type: {
    type: String,
    enum: ['primary', 'secondary', 'long_tail', 'semantic', 'related', 'question'],
    required: true,
  },
  intent: { type: String, enum: ['informational', 'navigational', 'transactional', 'commercial'], default: 'informational' },
  relevance: { type: Number, default: 50 }, // 0-100
  competitionEstimate: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  businessValue: { type: Number, default: 50 }, // 0-100
}, { timestamps: true });

seoKeywordSchema.index({ projectId: 1, keyword: 1 }, { unique: true });

export const SeoKeyword = models.SeoKeyword ?? model('SeoKeyword', seoKeywordSchema);
