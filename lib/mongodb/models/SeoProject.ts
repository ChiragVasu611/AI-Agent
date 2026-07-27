import { Schema, model, models } from 'mongoose';

const seoProjectSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true },
  companyName: { type: String, default: '' },
  projectType: {
    type: String,
    enum: ['website', 'android', 'ios', 'flutter', 'react_native', 'hybrid', 'web_app'],
    required: true,
  },
  websiteUrl: { type: String, default: null },
  playStoreUrl: { type: String, default: null },
  appStoreUrl: { type: String, default: null },
  targetCountry: { type: String, default: 'United States' },
  language: { type: String, default: 'English' },
  businessCategory: { type: String, default: '' },
  industry: { type: String, default: '' },
  targetAudience: { type: String, default: '' },
  competitorNames: { type: [String], default: [] },
  focusKeywords: { type: [String], default: [] },

  // AI Project Analysis — generated once at creation, regenerable on demand.
  businessType: { type: String, default: null },
  productType: { type: String, default: null },
  userIntent: { type: String, default: null },
  targetMarket: { type: String, default: null },
  businessGoals: { type: [String], default: [] },
  conversionGoals: { type: [String], default: [] },
  businessSummary: { type: String, default: null },
  seoStrategy: { type: String, default: null },
  asoStrategy: { type: String, default: null },
  growthRoadmap: { type: String, default: null },
  analysisSource: { type: String, enum: ['ai', 'deterministic', null], default: null },

  // Health scores (0-100), recomputed after each audit.
  seoScore: { type: Number, default: null },
  asoScore: { type: Number, default: null },
  technicalScore: { type: Number, default: null },
  contentScore: { type: Number, default: null },
  accessibilityScore: { type: Number, default: null },
  performanceScore: { type: Number, default: null },
  metadataScore: { type: Number, default: null },
  mobileScore: { type: Number, default: null },
  uxScore: { type: Number, default: null },

  lastAuditAt: { type: Date, default: null },
}, { timestamps: true });

export const SeoProject = models.SeoProject ?? model('SeoProject', seoProjectSchema);
