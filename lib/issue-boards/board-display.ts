import type { BoardStatus } from '@/lib/issue-boards/constants';

/**
 * Presentation-only helpers for the AI Issue Boards card grid.
 *
 * These are deliberately kept separate from the persisted `BoardStatus`
 * vocabulary (open/in_progress/ready_for_qa/resolved) in constants.ts — the
 * board list groups those four states into three simpler display buckets
 * (Running/Active/Complete) for the quick-filter tabs, without changing what
 * is actually stored or how the detailed Status filter works elsewhere.
 */

export type BoardTab = 'all' | 'running' | 'active' | 'complete';

export const BOARD_TABS: Array<{ key: BoardTab; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Running' },
  { key: 'active', label: 'Active' },
  { key: 'complete', label: 'Complete' },
];

/** Which persisted statuses a quick-filter tab corresponds to. Empty = no filter. */
export function statusesForTab(tab: BoardTab): BoardStatus[] {
  switch (tab) {
    case 'running': return ['in_progress'];
    case 'active': return ['open', 'ready_for_qa'];
    case 'complete': return ['resolved'];
    default: return [];
  }
}

export interface DisplayStatusMeta {
  tab: BoardTab;
  label: string;
  dot: string;
  badge: string;
  bar: string;
}

/** How each persisted board status renders on the card: tab bucket, badge, dot, progress-bar color. */
export const DISPLAY_STATUS_META: Record<BoardStatus, DisplayStatusMeta> = {
  in_progress: {
    tab: 'running', label: 'Running',
    dot: 'bg-indigo-500', badge: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400', bar: 'bg-indigo-500',
  },
  open: {
    tab: 'active', label: 'Active',
    dot: 'bg-emerald-500', badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500',
  },
  ready_for_qa: {
    tab: 'active', label: 'Active',
    dot: 'bg-emerald-500', badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500',
  },
  resolved: {
    tab: 'complete', label: 'Complete',
    dot: 'bg-slate-400', badge: 'bg-slate-400/15 text-slate-500 dark:text-slate-400', bar: 'bg-slate-400',
  },
};

/** Colored pill for the platform tag on a card — a stand-in for the "environment" tag in the reference design. */
export const PLATFORM_TAG: Record<string, string> = {
  android: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  ios: 'bg-slate-400/15 text-slate-500 dark:text-slate-300',
  web: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  cross_platform: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
};

export function platformLabel(platform: string): string {
  if (!platform) return 'Unknown';
  if (platform === 'ios') return 'iOS';
  if (platform === 'cross_platform') return 'Cross-platform';
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

/** A stable, varied accent per board (avatar + View button) — independent of status, purely for visual variety. */
const ACCENTS = [
  { avatarBg: 'bg-violet-500/15', avatarText: 'text-violet-600 dark:text-violet-400', button: 'bg-violet-600 hover:bg-violet-600/90 text-white' },
  { avatarBg: 'bg-cyan-500/15', avatarText: 'text-cyan-600 dark:text-cyan-400', button: 'bg-teal-600 hover:bg-teal-600/90 text-white' },
  { avatarBg: 'bg-emerald-500/15', avatarText: 'text-emerald-600 dark:text-emerald-400', button: 'bg-emerald-600 hover:bg-emerald-600/90 text-white' },
  { avatarBg: 'bg-amber-500/15', avatarText: 'text-amber-600 dark:text-amber-400', button: 'bg-orange-500 hover:bg-orange-500/90 text-white' },
  { avatarBg: 'bg-pink-500/15', avatarText: 'text-pink-600 dark:text-pink-400', button: 'bg-pink-600 hover:bg-pink-600/90 text-white' },
  { avatarBg: 'bg-sky-500/15', avatarText: 'text-sky-600 dark:text-sky-400', button: 'bg-sky-600 hover:bg-sky-600/90 text-white' },
  { avatarBg: 'bg-fuchsia-500/15', avatarText: 'text-fuchsia-600 dark:text-fuchsia-400', button: 'bg-fuchsia-600 hover:bg-fuchsia-600/90 text-white' },
  { avatarBg: 'bg-lime-500/15', avatarText: 'text-lime-700 dark:text-lime-400', button: 'bg-lime-600 hover:bg-lime-600/90 text-white' },
] as const;

export function accentFor(id: string): typeof ACCENTS[number] {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[hash % ACCENTS.length];
}

/** "Checkout Service" -> "CS"; single-word names use the first two letters. */
export function initials2(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** "Just now" / "12 min ago" / "1h 04m ago" / falls back to a short date past 24h. */
export function formatRelativeShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${String(remMinutes).padStart(2, '0')}m ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
