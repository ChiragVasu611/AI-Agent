import { Schema, model, models, type InferSchemaType } from 'mongoose';

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  fullName: { type: String, default: '' },
  role: {
    type: String,
    enum: ['super_admin', 'company_admin', 'hr', 'qa', 'developer', 'designer', 'marketing', 'finance', 'employee', 'guest'],
    default: 'employee',
  },
  resetToken: { type: String, default: null },
  resetTokenExpires: { type: Date, default: null },
  qaOpenRouterApiKey: { type: String, default: null },
  qaApiKeyTier: { type: String, enum: ['free', 'paid', null], default: null },
  uiuxAiEnabled: { type: Boolean, default: true },
  uiuxOpenRouterApiKey: { type: String, default: null },
  uiuxApiKeyTier: { type: String, enum: ['free', 'paid', null], default: null },
}, { timestamps: true });

export type UserDoc = InferSchemaType<typeof userSchema>;

export const User = models.User ?? model('User', userSchema);
