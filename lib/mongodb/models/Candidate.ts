import { Schema, model, models } from 'mongoose';

const experienceEntrySchema = new Schema({
  company: String,
  title: String,
  startDate: String,
  endDate: String,
  description: String,
}, { _id: false });

const educationEntrySchema = new Schema({
  school: String,
  degree: String,
  field: String,
  startDate: String,
  endDate: String,
}, { _id: false });

const candidateSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, index: true },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  address: { type: String, default: '' },
  photoUrl: { type: String, default: null },
  skills: { type: [String], default: [], index: true },
  experience: { type: [experienceEntrySchema], default: [] },
  totalExperienceYears: { type: Number, default: 0 },
  education: { type: [educationEntrySchema], default: [] },
  certifications: { type: [String], default: [] },
  languages: { type: [String], default: [] },
  projects: { type: [String], default: [] },
  companiesWorked: { type: [String], default: [] },
  portfolioUrl: { type: String, default: '' },
  linkedinUrl: { type: String, default: '' },
  githubUrl: { type: String, default: '' },
  notes: { type: String, default: '' },
  resumeFileName: { type: String, default: null },
  resumeText: { type: String, default: '' },
  resumeTextHash: { type: String, default: null, index: true },
}, { timestamps: true });

export const Candidate = models.Candidate ?? model('Candidate', candidateSchema);
