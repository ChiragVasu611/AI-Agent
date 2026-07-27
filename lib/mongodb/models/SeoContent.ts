import { Schema, model, models } from 'mongoose';

const seoContentSchema = new Schema({
  projectId: { type: Schema.Types.ObjectId, ref: 'SeoProject', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: {
    type: String,
    enum: [
      'seo_title', 'meta_description', 'blog_idea', 'landing_page', 'faq',
      'product_description', 'app_description', 'release_notes', 'social_caption',
    ],
    required: true,
  },
  title: { type: String, default: '' },
  body: { type: String, required: true },
  source: { type: String, enum: ['ai', 'deterministic'], default: 'deterministic' },

  reviewScore: { type: Number, default: null },
  reviewFindings: [{
    category: String,
    item: String,
    status: { type: String, enum: ['pass', 'fail', 'warn'] },
    severity: { type: String, enum: ['critical', 'high', 'medium', 'low'] },
    detail: String,
    recommendation: String,
  }],
  reviewedAt: { type: Date, default: null },
}, { timestamps: true });

export const SeoContent = models.SeoContent ?? model('SeoContent', seoContentSchema);
