import { Schema, model, models } from 'mongoose';

const jobSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true },
  department: { type: String, required: true, index: true },
  employmentType: { type: String, enum: ['full_time', 'part_time', 'contract', 'internship'], default: 'full_time' },
  workMode: { type: String, enum: ['onsite', 'remote', 'hybrid'], default: 'onsite' },
  experienceMinYears: { type: Number, default: 0 },
  experienceMaxYears: { type: Number, default: 0 },
  salaryMin: { type: Number, default: null },
  salaryMax: { type: Number, default: null },
  salaryCurrency: { type: String, default: 'USD' },
  requiredSkills: { type: [String], default: [] },
  preferredSkills: { type: [String], default: [] },
  description: { type: String, default: '' },
  responsibilities: { type: String, default: '' },
  qualifications: { type: String, default: '' },
  benefits: { type: String, default: '' },
  hiringManager: { type: String, required: true },
  openings: { type: Number, default: 1 },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  closingDate: { type: Date, default: null },
  status: { type: String, enum: ['open', 'closed', 'draft'], default: 'open', index: true },
}, { timestamps: true });

export const Job = models.Job ?? model('Job', jobSchema);
