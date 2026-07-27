import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Manually-formatted date — deterministic across server and client regardless
 * of host/ICU locale differences, unlike toLocaleDateString() which can
 * render "7/22/2026" on the server and "22/07/2026" on the client even with
 * an explicit locale argument, causing a hydration mismatch.
 */
export function formatDate(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function formatDateTime(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  const hours24 = d.getUTCHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  const suffix = hours24 < 12 ? 'AM' : 'PM';
  return `${formatDate(d)}, ${hours12}:${minutes} ${suffix}`;
}
