'use server';

import { revalidatePath } from 'next/cache';
import { signOut } from '@/lib/auth/actions';

export async function signOutAction() {
  await signOut();
  revalidatePath('/', 'layout');
}
