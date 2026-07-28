import { Schema } from 'mongoose';
import { defineModel } from '@/lib/mongodb/define-model';

const qaProjectSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true },
  sourceType: {
    type: String,
    // 'installed_app' targets an app already present on a connected device, so
    // it carries appPackageName but no uploaded binary (binaryPath stays null).
    enum: ['apk', 'aab', 'ipa', 'flutter', 'react_native', 'hybrid', 'web_app', 'play_store_url', 'app_store_url', 'web_url', 'installed_app'],
    required: true,
  },
  sourceRef: { type: String, required: true }, // URL or uploaded file name
  platform: { type: String, enum: ['android', 'ios', 'web', 'cross_platform'], required: true },

  // Real metadata extracted from an uploaded APK/AAB/IPA binary via app-info-parser.
  appPackageName: { type: String, default: null },
  appDisplayName: { type: String, default: null },
  appVersionName: { type: String, default: null },
  appVersionCode: { type: String, default: null },
  appIconDataUrl: { type: String, default: null },
  sourceFileName: { type: String, default: null },
  fileSizeBytes: { type: Number, default: null },

  // Absolute path to the uploaded binary persisted on disk (APK/IPA). Needed to
  // install the real app onto a connected device during a real-device run.
  binaryPath: { type: String, default: null },
}, { timestamps: true });

export const QaProject = defineModel('QaProject', qaProjectSchema);
