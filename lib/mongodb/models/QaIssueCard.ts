import { Schema, model, models } from 'mongoose';
import { ISSUE_STATUSES, ISSUE_CATEGORIES } from '@/lib/issue-boards/constants';

/** One threaded comment. `parentId` is the _id of the comment being replied to. */
const commentSchema = new Schema({
  authorUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  authorName: { type: String, default: '' },
  authorRole: { type: String, default: '' },
  /** 'qa' | 'developer' | 'note' — drives the QA Notes / Developer Notes split. */
  kind: { type: String, enum: ['qa', 'developer', 'note'], default: 'note' },
  body: { type: String, required: true },
  mentions: { type: [String], default: [] },
  attachments: {
    type: [new Schema({
      name: { type: String, default: '' },
      kind: { type: String, default: 'file' },
      dataUrl: { type: String, default: '' },
    }, { _id: false })],
    default: [],
  },
  parentId: { type: Schema.Types.ObjectId, default: null },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

/** Append-only audit trail. Entries are never edited or removed. */
const activitySchema = new Schema({
  type: { type: String, required: true },
  message: { type: String, required: true },
  fromStatus: { type: String, default: null },
  toStatus: { type: String, default: null },
  actorUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  actorName: { type: String, default: 'AI Issue Analyser' },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const attachmentSchema = new Schema({
  name: { type: String, default: '' },
  /** 'screenshot' | 'recording' | 'log' | 'file' */
  kind: { type: String, default: 'file' },
  dataUrl: { type: String, default: '' },
  addedByName: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

/**
 * One issue card on one board.
 *
 * `sourceKey` is the dedupe anchor: it is derived deterministically from the
 * execution artefact the card was created from (a bug, a failed case, or a
 * failed step), and is unique per board. A re-sync therefore updates the
 * existing card instead of creating a second one — the card keeps its column,
 * its assignee, its comments and its full activity history forever.
 */
const qaIssueCardSchema = new Schema({
  ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  boardId: { type: Schema.Types.ObjectId, ref: 'QaIssueBoard', required: true, index: true },
  runId: { type: Schema.Types.ObjectId, ref: 'QaTestRun', required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'QaProject', required: true, index: true },
  /** Source QA bug, when the card came from one. */
  bugId: { type: Schema.Types.ObjectId, ref: 'QaBug', default: null },
  sourceKey: { type: String, required: true },

  issueKey: { type: String, required: true, index: true },

  // ---- General ----
  title: { type: String, required: true },
  description: { type: String, default: '' },
  category: { type: String, enum: ISSUE_CATEGORIES as unknown as string[], default: 'functional', index: true },
  status: { type: String, enum: ISSUE_STATUSES as unknown as string[], default: 'new', index: true },
  severity: { type: String, enum: ['critical', 'high', 'medium', 'low'], default: 'medium', index: true },
  priority: { type: String, enum: ['p1', 'p2', 'p3', 'p4'], default: 'p3', index: true },
  labels: { type: [String], default: [] },
  /** Position within its column — smaller sorts first. */
  order: { type: Number, default: 0 },

  assignedToUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  assignedToName: { type: String, default: '' },
  assignedToEmail: { type: String, default: '' },
  dueDate: { type: Date, default: null },

  // ---- QA details ----
  testCaseId: { type: String, default: '' },
  module: { type: String, default: '' },
  feature: { type: String, default: '' },
  screenName: { type: String, default: '' },
  failedStepNumber: { type: Number, default: null },
  failedStepText: { type: String, default: '' },
  expectedResult: { type: String, default: '' },
  actualResult: { type: String, default: '' },
  stepsToReproduce: { type: [String], default: [] },

  // ---- Execution snapshot ----
  executionNumber: { type: Number, default: 0 },
  executionId: { type: String, default: '' },
  projectName: { type: String, default: '' },
  applicationName: { type: String, default: '' },
  moduleType: { type: String, default: '' },
  platform: { type: String, default: '' },
  deviceName: { type: String, default: '' },
  buildVersion: { type: String, default: '' },

  // ---- Evidence ----
  screenshots: { type: [String], default: [] },
  screenRecordingUrl: { type: String, default: null },
  logs: { type: String, default: '' },
  stackTrace: { type: String, default: null },
  apiRequest: { type: String, default: null },
  apiResponse: { type: String, default: null },
  attachments: { type: [attachmentSchema], default: [] },

  // ---- AI analysis ----
  aiRootCause: { type: String, default: '' },
  aiSuggestedFix: { type: String, default: '' },

  comments: { type: [commentSchema], default: [] },
  activity: { type: [activitySchema], default: [] },

  /** Denormalised counters so the compact Trello card needs no joins. */
  commentCount: { type: Number, default: 0 },
  attachmentCount: { type: Number, default: 0 },
  reopenCount: { type: Number, default: 0 },

  firstAssignedAt: { type: Date, default: null },
  readyForQaAt: { type: Date, default: null },
  closedAt: { type: Date, default: null },
}, { timestamps: true });

// The dedupe guarantee: one card per source artefact per board.
qaIssueCardSchema.index({ boardId: 1, sourceKey: 1 }, { unique: true });
qaIssueCardSchema.index({ boardId: 1, status: 1, order: 1 });

export const QaIssueCard = models.QaIssueCard ?? model('QaIssueCard', qaIssueCardSchema);
