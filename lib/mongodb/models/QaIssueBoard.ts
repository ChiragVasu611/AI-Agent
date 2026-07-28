import { Schema, model, models } from 'mongoose';

/**
 * One AI Issue Board per completed execution — never more, never fewer.
 *
 * `runId` is unique, which is what makes board creation idempotent: the sync
 * engine can be invoked repeatedly (on completion, on backfill, on every list
 * request) without ever producing a duplicate board. Boards are never deleted
 * when a newer execution arrives, so the full execution history is preserved.
 */
const qaIssueBoardSchema = new Schema({
  /** The user who ran the execution. Kept for provenance; boards are readable
   *  workspace-wide so a developer can act on a board a QA engineer created. */
  ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  runId: { type: Schema.Types.ObjectId, ref: 'QaTestRun', required: true, unique: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'QaProject', required: true, index: true },

  // ---- Identity: "<Project> - <Application> - Execution #<id>" ----
  boardName: { type: String, required: true, index: true },
  projectName: { type: String, default: '' },
  applicationName: { type: String, default: '' },
  /** Numeric run number of the source execution. */
  executionNumber: { type: Number, required: true, index: true },
  /** Zero-padded display form, e.g. "084". */
  executionId: { type: String, required: true, index: true },

  // ---- Execution snapshot (frozen at board creation) ----
  moduleType: { type: String, enum: ['catalog', 'uploaded'], default: 'catalog', index: true },
  platform: { type: String, default: '' },
  deviceName: { type: String, default: '' },
  buildVersion: { type: String, default: '' },
  executedByName: { type: String, default: '' },
  executedAt: { type: Date, default: null, index: true },
  /** Terminal status of the execution itself (passed / failed / partial). */
  runStatus: { type: String, default: '' },

  totalCases: { type: Number, default: 0 },
  passedCases: { type: Number, default: 0 },
  failedCases: { type: Number, default: 0 },
  blockedCases: { type: Number, default: 0 },
  totalIssues: { type: Number, default: 0 },

  // ---- Live rollups, recomputed whenever a card changes ----
  status: { type: String, enum: ['open', 'in_progress', 'ready_for_qa', 'resolved'], default: 'open', index: true },
  openIssues: { type: Number, default: 0 },
  assignedIssues: { type: Number, default: 0 },
  inProgressIssues: { type: Number, default: 0 },
  readyForQaIssues: { type: Number, default: 0 },
  reopenedIssues: { type: Number, default: 0 },
  closedIssues: { type: Number, default: 0 },
  criticalIssues: { type: Number, default: 0 },
  highPriorityIssues: { type: Number, default: 0 },
  /** Distinct assignee names, so the board list can filter by developer. */
  assignedDevelopers: { type: [String], default: [] },
  severities: { type: [String], default: [] },
  priorities: { type: [String], default: [] },

  lastActivityAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

qaIssueBoardSchema.index({ projectName: 1, applicationName: 1 });

export const QaIssueBoard = models.QaIssueBoard ?? model('QaIssueBoard', qaIssueBoardSchema);
