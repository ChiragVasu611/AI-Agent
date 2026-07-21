import { Schema, model, models } from 'mongoose';

const designDocumentSchema = new Schema({
  projectId: { type: Schema.Types.ObjectId, ref: 'DesignProject', required: true, unique: true, index: true },
  screens: { type: Schema.Types.Mixed, default: [] },
  versions: {
    type: [{ screens: Schema.Types.Mixed, savedAt: { type: Date, default: Date.now } }],
    default: [],
  },
}, { timestamps: true });

export const DesignDocument = models.DesignDocument ?? model('DesignDocument', designDocumentSchema);
