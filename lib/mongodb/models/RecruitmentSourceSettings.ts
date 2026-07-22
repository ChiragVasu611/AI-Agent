import { Schema, model, models } from 'mongoose';

const careerPortalSchema = new Schema({
  enabled: { type: Boolean, default: true },
  portalUrl: { type: String, default: '' },
  companyName: { type: String, default: '' },
  companyLogoUrl: { type: String, default: '' },
  resumeUploadEnabled: { type: Boolean, default: true },
  supportedResumeTypes: { type: [String], default: ['pdf', 'docx'] },
  maxResumeSizeMb: { type: Number, default: 5 },
  defaultApplicationStatus: { type: String, default: 'applied' },
  autoResumeParsing: { type: Boolean, default: true },
  autoAiScreening: { type: Boolean, default: true },
}, { _id: false });

const linkedinSchema = new Schema({
  enabled: { type: Boolean, default: false },
  companyPageUrl: { type: String, default: '' },
  careersPageUrl: { type: String, default: '' },
  defaultApplyUrl: { type: String, default: '' },
  utmTrackingEnabled: { type: Boolean, default: true },
  campaignName: { type: String, default: '' },
  sourceName: { type: String, default: 'linkedin' },
}, { _id: false });

const emailSchema = new Schema({
  enabled: { type: Boolean, default: false },
  emailAddress: { type: String, default: '' },
  displayName: { type: String, default: '' },
  protocol: { type: String, enum: ['imap', 'pop3'], default: 'imap' },
  incomingServer: { type: String, default: '' },
  port: { type: Number, default: 993 },
  username: { type: String, default: '' },
  password: { type: String, default: '' },
  useSsl: { type: Boolean, default: true },
  fetchIntervalMinutes: { type: Number, default: 15 },
  inboxFolder: { type: String, default: 'INBOX' },
  allowedResumeTypes: { type: [String], default: ['pdf', 'docx'] },
  maxAttachmentSizeMb: { type: Number, default: 5 },
  autoResumeParsing: { type: Boolean, default: true },
  autoCandidateCreation: { type: Boolean, default: true },
  autoAiScreening: { type: Boolean, default: true },
  duplicateDetection: { type: Boolean, default: true },
  lastFetchedAt: { type: Date, default: null },
  lastTestResult: { type: String, default: null },
  lastTestAt: { type: Date, default: null },
}, { _id: false });

const whatsappSchema = new Schema({
  enabled: { type: Boolean, default: false },
  whatsappNumber: { type: String, default: '' },
  displayName: { type: String, default: '' },
  inviteLink: { type: String, default: '' },
  submissionInstructions: { type: String, default: '' },
  welcomeMessage: { type: String, default: '' },
  autoReply: { type: Boolean, default: true },
  resumeProcessingEnabled: { type: Boolean, default: true },
  supportedResumeTypes: { type: [String], default: ['pdf', 'docx'] },
  maxFileSizeMb: { type: Number, default: 5 },
  lastTestResult: { type: String, default: null },
  lastTestAt: { type: Date, default: null },
}, { _id: false });

const recruitmentSourceSettingsSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  careerPortal: { type: careerPortalSchema, default: () => ({}) },
  linkedin: { type: linkedinSchema, default: () => ({}) },
  email: { type: emailSchema, default: () => ({}) },
  whatsapp: { type: whatsappSchema, default: () => ({}) },
}, { timestamps: true });

export const RecruitmentSourceSettings = models.RecruitmentSourceSettings
  ?? model('RecruitmentSourceSettings', recruitmentSourceSettingsSchema);
