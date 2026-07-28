'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaIssueBoard } from '@/lib/mongodb/models/QaIssueBoard';
import { QaIssueCard } from '@/lib/mongodb/models/QaIssueCard';
import { User } from '@/lib/mongodb/models/User';
import { ActivityLog } from '@/lib/mongodb/models/ActivityLog';
import { recomputeBoardRollups, backfillIssueBoards } from '@/lib/issue-boards/sync';
import { notifyDevelopers, notifyQa, notifyUser } from '@/lib/issue-boards/notify';
import {
  ISSUE_STATUSES, ISSUE_STATUS_LABEL, PRIORITY_LABEL, type IssueStatus,
} from '@/lib/issue-boards/constants';

/**
 * Developer/QA workflow actions for AI Issue Boards.
 *
 * Cards are only ever moved and annotated here — never duplicated and never
 * recreated. Every mutation appends to the card's activity timeline, so a
 * card's full history (assigned → in progress → ready for QA → closed →
 * reopened → …) is always reconstructible.
 */

function paths(boardId: string, cardId?: string) {
  revalidatePath('/app-factory/issue-boards');
  revalidatePath(`/app-factory/issue-boards/${boardId}`);
  if (cardId) revalidatePath(`/app-factory/issue-boards/${boardId}/issues/${cardId}`);
  revalidatePath('/app-factory');
}

async function loadCard(cardId: string) {
  await connectToDatabase();
  const card = await QaIssueCard.findById(cardId).catch(() => null);
  return card;
}

/**
 * Drag & drop: move a card to a column and persist the new ordering.
 *
 * `orderedIds` is the full list of card ids in the destination column after the
 * drop, so the position the developer dropped it into is the position that
 * survives a reload.
 */
export async function moveIssueCard(cardId: string, toStatus: string, orderedIds: string[] = []) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };
  if (!ISSUE_STATUSES.includes(toStatus as IssueStatus)) return { error: 'Unknown column.' };

  const card = await loadCard(cardId);
  if (!card) return { error: 'Issue not found.' };

  const from = String(card.status) as IssueStatus;
  const to = toStatus as IssueStatus;
  const actorName = user.fullName || user.email;

  if (from !== to) {
    card.status = to;

    if (to === 'assigned' && !card.firstAssignedAt) card.firstAssignedAt = new Date();
    if (to === 'ready_for_qa') card.readyForQaAt = new Date();
    if (to === 'closed') card.closedAt = new Date();
    // Leaving Closed means the fix did not hold — clear the closure stamp so
    // resolution reporting never counts a re-opened issue as resolved.
    if (from === 'closed' && to !== 'closed') card.closedAt = null;
    if (to === 'reopened') card.reopenCount = (card.reopenCount ?? 0) + 1;

    card.activity.push({
      type: to === 'reopened' ? 'reopened' : to === 'closed' ? 'closed' : 'status_changed',
      message: `Moved from ${ISSUE_STATUS_LABEL[from]} to ${ISSUE_STATUS_LABEL[to]}.`,
      fromStatus: from,
      toStatus: to,
      actorUserId: user.id,
      actorName,
      createdAt: new Date(),
    });

    // A QA verdict on work that was waiting for retest is worth recording
    // separately from the plain column change.
    if (from === 'ready_for_qa' && (to === 'closed' || to === 'reopened')) {
      card.activity.push({
        type: 'qa_retested',
        message: to === 'closed'
          ? 'QA retested the issue and confirmed the fix.'
          : 'QA retested the issue and the defect still reproduces.',
        fromStatus: from,
        toStatus: to,
        actorUserId: user.id,
        actorName,
        createdAt: new Date(),
      });
    }
  }

  // Reordering within/into the column.
  const ids = orderedIds.filter(Boolean);
  if (ids.length > 0) {
    await Promise.all(ids.map((id, index) => QaIssueCard.updateOne(
      { _id: id, boardId: card.boardId },
      { order: index + 1 },
    )));
    const idx = ids.indexOf(String(card._id));
    if (idx >= 0) card.order = idx + 1;
  }

  await card.save();
  await recomputeBoardRollups(String(card.boardId));

  if (from !== to) {
    const board = await QaIssueBoard.findById(card.boardId).lean<any>();
    const owner = String(board?.ownerUserId ?? '');
    const ref = `${card.issueKey} — ${card.title}`;

    if (to === 'ready_for_qa') {
      await notifyQa(owner, 'issue_board.ready_for_qa', 'Issue ready for QA retest',
        `${ref} was moved to Ready for QA by ${actorName}. The developer has completed the fix.`);
    } else if (to === 'closed') {
      await notifyQa(owner, 'issue_board.closed', 'Issue closed', `${ref} was closed by ${actorName}.`);
      await notifyUser(card.assignedToUserId ? String(card.assignedToUserId) : null,
        'issue_board.closed', 'Your issue was closed', `${ref} was verified and closed by ${actorName}.`);
    } else if (to === 'reopened') {
      await notifyDevelopers(owner, 'issue_board.reopened', 'QA reopened an issue',
        `${ref} still reproduces after the fix and was reopened by ${actorName}.`);
    } else {
      await notifyDevelopers(owner, 'issue_board.card_updated', 'Issue card updated',
        `${ref} moved to ${ISSUE_STATUS_LABEL[to]} by ${actorName}.`);
    }
  }

  await ActivityLog.create({
    userId: user.id, action: 'issue_board.card.moved', entity: 'qa_issue_card', entityId: cardId,
    meta: { from, to },
  }).catch(() => null);

  paths(String(card.boardId), cardId);
  return { ok: true };
}

/** Assign (or unassign) a developer. Moves a New card to Assigned automatically. */
export async function assignIssueCard(cardId: string, assigneeUserId: string | null) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };

  const card = await loadCard(cardId);
  if (!card) return { error: 'Issue not found.' };

  const actorName = user.fullName || user.email;

  if (!assigneeUserId) {
    const previous = card.assignedToName;
    card.assignedToUserId = null;
    card.assignedToName = '';
    card.assignedToEmail = '';
    card.activity.push({
      type: 'unassigned',
      message: `Unassigned${previous ? ` from ${previous}` : ''}.`,
      actorUserId: user.id, actorName, createdAt: new Date(),
    });
  } else {
    const assignee = await User.findById(assigneeUserId).select('fullName email').lean<any>().catch(() => null);
    if (!assignee) return { error: 'That user no longer exists.' };

    const name = assignee.fullName || assignee.email;
    card.assignedToUserId = assignee._id;
    card.assignedToName = name;
    card.assignedToEmail = assignee.email;
    if (!card.firstAssignedAt) card.firstAssignedAt = new Date();

    const from = String(card.status) as IssueStatus;
    if (from === 'new') {
      card.status = 'assigned';
      card.activity.push({
        type: 'status_changed',
        message: `Moved from ${ISSUE_STATUS_LABEL.new} to ${ISSUE_STATUS_LABEL.assigned}.`,
        fromStatus: from, toStatus: 'assigned',
        actorUserId: user.id, actorName, createdAt: new Date(),
      });
    }

    card.activity.push({
      type: 'assigned',
      message: `Assigned to ${name}.`,
      actorUserId: user.id, actorName, createdAt: new Date(),
    });

    await notifyUser(String(assignee._id), 'issue_board.assigned', 'New issue assigned to you',
      `${card.issueKey} — ${card.title} (${card.severity}/${card.priority.toUpperCase()}) was assigned to you by ${actorName}.`);
  }

  await card.save();
  await recomputeBoardRollups(String(card.boardId));
  paths(String(card.boardId), cardId);
  return { ok: true };
}

export interface IssueFieldUpdate {
  priority?: string;
  severity?: string;
  dueDate?: string | null;
  labels?: string[];
}

/** Priority / severity / due date / labels. */
export async function updateIssueCard(cardId: string, update: IssueFieldUpdate) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };

  const card = await loadCard(cardId);
  if (!card) return { error: 'Issue not found.' };

  const actorName = user.fullName || user.email;
  let priorityChanged = false;

  if (update.priority && ['p1', 'p2', 'p3', 'p4'].includes(update.priority) && update.priority !== card.priority) {
    const before = card.priority;
    card.priority = update.priority;
    priorityChanged = true;
    card.activity.push({
      type: 'priority_changed',
      message: `Priority changed from ${PRIORITY_LABEL[before] ?? before} to ${PRIORITY_LABEL[update.priority] ?? update.priority}.`,
      actorUserId: user.id, actorName, createdAt: new Date(),
    });
  }

  if (update.severity && ['critical', 'high', 'medium', 'low'].includes(update.severity) && update.severity !== card.severity) {
    const before = card.severity;
    card.severity = update.severity;
    card.activity.push({
      type: 'severity_changed',
      message: `Severity changed from ${before} to ${update.severity}.`,
      actorUserId: user.id, actorName, createdAt: new Date(),
    });
  }

  if (update.dueDate !== undefined) {
    const next = update.dueDate ? new Date(update.dueDate) : null;
    card.dueDate = next;
    card.activity.push({
      type: 'due_date_changed',
      message: next ? `Due date set to ${next.toLocaleDateString('en-US')}.` : 'Due date cleared.',
      actorUserId: user.id, actorName, createdAt: new Date(),
    });
  }

  if (update.labels) {
    const labels = Array.from(new Set(update.labels.map((l) => l.trim()).filter(Boolean))).slice(0, 10);
    card.labels = labels;
    card.activity.push({
      type: 'label_changed',
      message: labels.length > 0 ? `Labels set to ${labels.join(', ')}.` : 'All labels removed.',
      actorUserId: user.id, actorName, createdAt: new Date(),
    });
  }

  await card.save();
  await recomputeBoardRollups(String(card.boardId));

  if (priorityChanged) {
    const board = await QaIssueBoard.findById(card.boardId).lean<any>();
    await notifyDevelopers(String(board?.ownerUserId ?? ''), 'issue_board.priority_changed',
      'Issue priority changed',
      `${card.issueKey} — ${card.title} is now ${PRIORITY_LABEL[card.priority] ?? card.priority} (changed by ${actorName}).`);
  }

  paths(String(card.boardId), cardId);
  return { ok: true };
}

export interface CommentAttachmentInput {
  name: string;
  kind?: string;
  dataUrl: string;
}

/** Threaded comment. `parentId` set = a reply inside that thread. */
export async function addIssueComment(cardId: string, input: {
  body: string;
  kind?: 'qa' | 'developer' | 'note';
  parentId?: string | null;
  attachments?: CommentAttachmentInput[];
}) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };

  const body = String(input.body ?? '').trim();
  if (!body) return { error: 'Write something first.' };

  const card = await loadCard(cardId);
  if (!card) return { error: 'Issue not found.' };

  const actorName = user.fullName || user.email;
  const mentions = Array.from(new Set((body.match(/@[\w.\-+]+/g) ?? []).map((m) => m.slice(1))));
  const attachments = (input.attachments ?? [])
    .filter((a) => a?.dataUrl)
    .slice(0, 5)
    .map((a) => ({ name: a.name || 'attachment', kind: a.kind || 'file', dataUrl: a.dataUrl }));

  const kind = input.kind ?? (user.role === 'qa' ? 'qa' : user.role === 'developer' ? 'developer' : 'note');

  card.comments.push({
    authorUserId: user.id,
    authorName: actorName,
    authorRole: user.role,
    kind,
    body,
    mentions,
    attachments,
    parentId: input.parentId || null,
    createdAt: new Date(),
  });
  card.commentCount = card.comments.length;

  card.activity.push({
    type: 'comment',
    message: `${kind === 'qa' ? 'QA' : kind === 'developer' ? 'Developer' : 'Team'} comment added by ${actorName}.`,
    actorUserId: user.id, actorName, createdAt: new Date(),
  });

  if (attachments.length > 0) {
    card.attachmentCount = (card.attachmentCount ?? 0) + attachments.length;
    card.activity.push({
      type: 'attachment_added',
      message: `${attachments.length} attachment(s) added with a comment.`,
      actorUserId: user.id, actorName, createdAt: new Date(),
    });
  }

  await card.save();
  await QaIssueBoard.findByIdAndUpdate(card.boardId, { lastActivityAt: new Date() });

  // @mentions notify the mentioned person; otherwise the assignee is told.
  if (mentions.length > 0) {
    const mentioned = await User.find({
      $or: [
        { email: { $in: mentions.map((m) => m.toLowerCase()) } },
        ...mentions.map((m) => ({ fullName: { $regex: m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })),
      ],
      isActive: true,
    }).select('_id').lean<any[]>().catch(() => []);
    for (const m of mentioned) {
      await notifyUser(String(m._id), 'issue_board.mentioned', 'You were mentioned on an issue',
        `${actorName} mentioned you on ${card.issueKey} — ${card.title}.`);
    }
  } else if (card.assignedToUserId && String(card.assignedToUserId) !== user.id) {
    await notifyUser(String(card.assignedToUserId), 'issue_board.card_updated', 'New comment on your issue',
      `${actorName} commented on ${card.issueKey} — ${card.title}.`);
  }

  paths(String(card.boardId), cardId);
  return { ok: true };
}

/** Attach evidence (screenshot, recording link, log file) to the issue itself. */
export async function addIssueAttachment(cardId: string, input: CommentAttachmentInput) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };
  if (!input?.dataUrl) return { error: 'Nothing to attach.' };

  const card = await loadCard(cardId);
  if (!card) return { error: 'Issue not found.' };

  const actorName = user.fullName || user.email;
  card.attachments.push({
    name: input.name || 'attachment',
    kind: input.kind || 'file',
    dataUrl: input.dataUrl,
    addedByName: actorName,
    createdAt: new Date(),
  });
  card.attachmentCount = (card.attachmentCount ?? 0) + 1;
  card.activity.push({
    type: 'attachment_added',
    message: `Attachment "${input.name || 'attachment'}" added.`,
    actorUserId: user.id, actorName, createdAt: new Date(),
  });

  await card.save();
  await QaIssueBoard.findByIdAndUpdate(card.boardId, { lastActivityAt: new Date() });
  paths(String(card.boardId), cardId);
  return { ok: true };
}

/**
 * Manual "check for new executions" — boards are created automatically, so this
 * only exists so a developer can force a refresh without waiting for a reload.
 */
export async function syncIssueBoardsNow() {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };

  const created = await backfillIssueBoards(100).catch((e) => {
    console.error('Manual issue board sync failed', e);
    return 0;
  });

  revalidatePath('/app-factory/issue-boards');
  return { ok: true, created };
}
