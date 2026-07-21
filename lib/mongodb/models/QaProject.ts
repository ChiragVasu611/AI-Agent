import { Schema, model, models } from 'mongoose';

const qaProjectSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true },
  sourceType: {
    type: String,
    enum: ['apk', 'ipa', 'flutter', 'react_native', 'hybrid', 'web_app', 'play_store_url', 'app_store_url', 'web_url'],
    required: true,
  },
  sourceRef: { type: String, required: true }, // URL or uploaded file name
  platform: { type: String, enum: ['android', 'ios', 'web', 'cross_platform'], required: true },
}, { timestamps: true });

export const QaProject = models.QaProject ?? model('QaProject', qaProjectSchema);
