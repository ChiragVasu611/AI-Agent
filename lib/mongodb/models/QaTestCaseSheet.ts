import { Schema, model, models } from 'mongoose';

/**
 * One row of a test case sheet, embedded inside a version snapshot.
 * Mirrors ParsedTestCase (lib/qa/testCaseParser.ts) plus an `_id` so the
 * built-in editor can address/reorder/delete a specific row.
 */
const sheetRowSchema = new Schema({
  testCaseId: { type: String, required: true },
  module: { type: String, default: '' },
  feature: { type: String, default: '' },
  scenario: { type: String, required: true },
  preconditions: { type: String, default: '' },
  steps: { type: [String], default: [] },
  testData: { type: String, default: '' },
  expectedResult: { type: String, default: '' },
  priority: { type: String, default: 'p3' },
  severity: { type: String, default: 'medium' },
}, { _id: true });

/**
 * A version snapshot of the sheet's rows. Kept as an embedded array (not
 * separate documents) so restoring a version is just pointing
 * `currentVersionIndex` at it — no data is ever deleted, so history is
 * naturally preserved.
 */
const sheetVersionSchema = new Schema({
  version: { type: String, required: true },     // e.g. "v1.0", "v1.1", "v2.0"
  versionNumber: { type: Number, required: true }, // monotonic, for sorting
  rows: { type: [sheetRowSchema], default: [] },
  totalTestCases: { type: Number, default: 0 },
  note: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const qaTestCaseSheetSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  sheetName: { type: String, required: true },
  // Which application workflow this sheet belongs to — the Test Case
  // Repository groups sheets into separate Android / iOS / Web sections by
  // this field rather than mixing everything into one flat list.
  platform: { type: String, enum: ['android', 'ios', 'web'], default: 'android', index: true },
  projectName: { type: String, default: '' },
  applicationName: { type: String, default: '' },
  module: { type: String, default: '' }, // primary/summary module tag, kept for search only — not shown as a column

  status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
  isFavorite: { type: Boolean, default: false },

  uploadedByName: { type: String, default: '' },
  originalFileName: { type: String, default: '' },
  originalFormat: { type: String, enum: ['xlsx', 'csv'], default: 'xlsx' },

  versions: { type: [sheetVersionSchema], default: [] },
  // Index into `versions` of the version currently being edited/selected —
  // NOT necessarily the last one, since a user can restore an older version.
  currentVersionIndex: { type: Number, default: 0 },

  lastExecutedAt: { type: Date, default: null },
}, { timestamps: true });

qaTestCaseSheetSchema.index({ userId: 1, sheetName: 1 });

export const QaTestCaseSheet = models.QaTestCaseSheet ?? model('QaTestCaseSheet', qaTestCaseSheetSchema);
