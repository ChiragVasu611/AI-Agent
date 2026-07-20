'use server';

import crypto from 'crypto';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { User } from '@/lib/mongodb/models/User';
import { Credits } from '@/lib/mongodb/models/Credits';
import {
  hashPassword, verifyPassword, signSessionToken, setSessionCookie, clearSessionCookie, getCurrentUser,
} from './session';

export async function signUp(email: string, password: string, fullName: string) {
  await connectToDatabase();

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return { error: 'An account with this email already exists.' };

  const passwordHash = await hashPassword(password);
  const user = await User.create({ email: email.toLowerCase(), passwordHash, fullName, role: 'user' });
  await Credits.create({ userId: user._id, balance: 100 });

  const token = await signSessionToken(String(user._id));
  await setSessionCookie(token);

  return { success: true };
}

export async function signIn(email: string, password: string) {
  await connectToDatabase();

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) return { error: 'Invalid email or password.' };

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return { error: 'Invalid email or password.' };

  const token = await signSessionToken(String(user._id));
  await setSessionCookie(token);

  return { success: true };
}

export async function signOut() {
  await clearSessionCookie();
}

export async function requestPasswordReset(
  email: string,
): Promise<{ success: boolean; error?: string; resetLink?: string }> {
  await connectToDatabase();

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    // Don't reveal whether the account exists.
    return { success: true };
  }

  const token = crypto.randomBytes(32).toString('hex');
  user.resetToken = token;
  user.resetTokenExpires = new Date(Date.now() + 1000 * 60 * 30);
  await user.save();

  // No SMTP is configured yet, so hand the link straight back for display
  // instead of emailing it.
  return { success: true, resetLink: `/reset-password?token=${token}` };
}

export async function resetPassword(token: string, newPassword: string) {
  await connectToDatabase();

  const user = await User.findOne({ resetToken: token, resetTokenExpires: { $gt: new Date() } });
  if (!user) return { error: 'This reset link is invalid or has expired.' };

  user.passwordHash = await hashPassword(newPassword);
  user.resetToken = null;
  user.resetTokenExpires = null;
  await user.save();

  return { success: true };
}

export async function updateProfile(fullName: string) {
  const current = await getCurrentUser();
  if (!current) return { error: 'Not authenticated' };

  await connectToDatabase();
  await User.findByIdAndUpdate(current.id, { fullName });

  return { success: true };
}
