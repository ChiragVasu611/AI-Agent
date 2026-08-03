import { Schema, model, models } from 'mongoose';

const qaScreenshotSchema = new Schema({
  runId: { type: Schema.Types.ObjectId, ref: 'QaTestRun', required: true, index: true },
  screenName: { type: String, required: true },
  testStep: { type: String, default: '' },
  imageDataUrl: { type: String, required: true },

  /**
   * Which test case and step this frame belongs to.
   *
   * The Live Device panel serves the newest frame while the text tiles come from
   * the run document, so without an identity on the image there is no way for
   * either side to notice they are describing different moments — and they
   * routinely were, because a frame is written after a step's device work while
   * the step text is published before it. Stamping the frame lets the panel
   * label what it is actually showing, and lets the API confirm the two halves
   * refer to the same step.
   */
  testCaseId: { type: String, default: '' },
  stepNumber: { type: Number, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

// The live panel reads the newest frame for a run on a tight poll; without the
// sort key in the index every poll pulls the run's frames and sorts in memory.
qaScreenshotSchema.index({ runId: 1, createdAt: -1 });

export const QaScreenshot = models.QaScreenshot ?? model('QaScreenshot', qaScreenshotSchema);
