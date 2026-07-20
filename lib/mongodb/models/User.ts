import { Schema, model, models, type InferSchemaType } from 'mongoose';

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  fullName: { type: String, default: '' },
  role: { type: String, enum: ['admin', 'user', 'manager'], default: 'user' },
  resetToken: { type: String, default: null },
  resetTokenExpires: { type: Date, default: null },
}, { timestamps: true });

export type UserDoc = InferSchemaType<typeof userSchema>;

export const User = models.User ?? model('User', userSchema);
