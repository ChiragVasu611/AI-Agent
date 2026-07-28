import { Notification } from '@/lib/mongodb/models/Notification';
import { User } from '@/lib/mongodb/models/User';

/**
 * Notifications for the AI Issue Boards module.
 *
 * Every helper is best-effort: a notification failure must never abort an
 * execution, a board sync, or a card move.
 */

const DEV_ROLES = ['developer'];
const QA_ROLES = ['qa'];

async function userIdsForRoles(roles: string[]): Promise<string[]> {
  try {
    const users = await User.find({ role: { $in: roles }, isActive: true }).select('_id').lean<any[]>();
    return users.map((u) => String(u._id));
  } catch {
    return [];
  }
}

async function push(userIds: string[], type: string, title: string, message: string) {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return;
  try {
    await Notification.insertMany(unique.map((userId) => ({ userId, type, title, message })));
  } catch (e) {
    console.error('Issue board notification failed', e);
  }
}

/** Every developer, plus whoever ran the execution. */
export async function notifyDevelopers(ownerUserId: string, type: string, title: string, message: string) {
  const devs = await userIdsForRoles(DEV_ROLES);
  await push([...devs, ownerUserId], type, title, message);
}

/** Every QA engineer, plus the board owner (usually the QA who executed). */
export async function notifyQa(ownerUserId: string, type: string, title: string, message: string) {
  const qa = await userIdsForRoles(QA_ROLES);
  await push([...qa, ownerUserId], type, title, message);
}

export async function notifyUser(userId: string | null | undefined, type: string, title: string, message: string) {
  if (!userId) return;
  await push([String(userId)], type, title, message);
}
