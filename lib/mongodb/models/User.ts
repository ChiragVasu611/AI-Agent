import { Schema, model, models, type InferSchemaType } from 'mongoose';

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  fullName: { type: String, default: '' },
  role: {
    type: String,
    enum: ['super_admin', 'company_admin', 'hr', 'qa', 'developer', 'designer', 'marketing', 'finance', 'seo', 'employee', 'guest'],
    default: 'employee',
  },
  isActive: { type: Boolean, default: true },
  resetToken: { type: String, default: null },
  resetTokenExpires: { type: Date, default: null },
  qaOpenRouterApiKey: { type: String, default: null },
  qaApiKeyTier: { type: String, enum: ['free', 'paid', null], default: null },
  uiuxAiEnabled: { type: Boolean, default: true },
  uiuxOpenRouterApiKey: { type: String, default: null },
  uiuxApiKeyTier: { type: String, enum: ['free', 'paid', null], default: null },
  seoAiEnabled: { type: Boolean, default: true },
  seoOpenRouterApiKey: { type: String, default: null },
  seoApiKeyTier: { type: String, enum: ['free', 'paid', null], default: null },
  seoSettings: {
    defaultCountry: { type: String, default: 'United States' },
    defaultLanguage: { type: String, default: 'English' },
    defaultProjectType: { type: String, default: 'website' },
    defaultReportFormat: { type: String, enum: ['pdf', 'excel', 'csv'], default: 'pdf' },
    notifyOnAuditComplete: { type: Boolean, default: true },
    notifyOnReportGenerated: { type: Boolean, default: true },
    notifyOnCriticalIssue: { type: Boolean, default: true },
    notifyOnOptimizationComplete: { type: Boolean, default: true },
    notifyOnProjectUpdated: { type: Boolean, default: false },
  },
}, { timestamps: true });

export type UserDoc = InferSchemaType<typeof userSchema>;

export const User = models.User ?? model('User', userSchema);
