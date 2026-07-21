/**
 * Local, rule-based resume parsing — no external AI API is used anywhere in this
 * module. Text extraction uses pdf-parse/mammoth (pure local libraries); field
 * extraction is regex/keyword heuristics. This is intentionally not NLP-perfect,
 * but it is real, deterministic, and fully auditable.
 */
import mammoth from 'mammoth';

const SKILLS_DICTIONARY = [
  'JavaScript', 'TypeScript', 'React', 'React Native', 'Next.js', 'Vue', 'Angular', 'Node.js', 'Express',
  'Python', 'Django', 'Flask', 'FastAPI', 'Java', 'Spring', 'Spring Boot', 'C++', 'C#', '.NET', 'Go', 'Rust',
  'PHP', 'Laravel', 'Ruby', 'Rails', 'Swift', 'Kotlin', 'SQL', 'PostgreSQL', 'MySQL', 'MongoDB', 'Redis',
  'GraphQL', 'REST API', 'Docker', 'Kubernetes', 'AWS', 'Azure', 'GCP', 'Terraform', 'CI/CD', 'Jenkins',
  'Git', 'GitHub Actions', 'Linux', 'Bash', 'HTML', 'CSS', 'Tailwind', 'Sass', 'Webpack', 'Vite',
  'Machine Learning', 'Deep Learning', 'TensorFlow', 'PyTorch', 'Data Science', 'Pandas', 'NumPy',
  'Excel', 'Power BI', 'Tableau', 'Figma', 'Adobe XD', 'Sketch', 'Agile', 'Scrum', 'Kanban', 'JIRA',
  'Project Management', 'Product Management', 'Leadership', 'Communication', 'Problem Solving',
  'Team Management', 'Sales', 'Marketing', 'SEO', 'Content Writing', 'Customer Service', 'Negotiation',
  'Accounting', 'Finance', 'HR Management', 'Recruiting', 'Payroll',
];

const LANGUAGE_LIST = [
  'English', 'Spanish', 'French', 'German', 'Mandarin', 'Chinese', 'Hindi', 'Arabic', 'Portuguese',
  'Russian', 'Japanese', 'Korean', 'Italian', 'Bengali', 'Punjabi', 'Urdu', 'Gujarati', 'Marathi', 'Tamil', 'Telugu',
];

const DEGREE_KEYWORDS = [
  'Bachelor', 'Master', 'PhD', 'Ph.D', 'MBA', 'B.Tech', 'M.Tech', 'B.Sc', 'M.Sc', 'BSc', 'MSc',
  'B.E.', 'M.E.', 'Associate Degree', 'Diploma', 'BCA', 'MCA',
];

const CERT_KEYWORDS = ['Certified', 'Certificate', 'Certification', 'AWS Certified', 'PMP', 'Scrum Master'];

const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE_TOKEN = `(?:${MONTH}\\.?\\s+\\d{4}|\\d{4})`;
const DATE_RANGE_RE = new RegExp(`(${DATE_TOKEN})\\s*(?:-|–|—|to)\\s*(Present|Current|${DATE_TOKEN})`, 'gi');

export interface ParsedExperienceEntry {
  company: string;
  title: string;
  startDate: string;
  endDate: string;
  description: string;
}

export interface ParsedEducationEntry {
  school: string;
  degree: string;
  field: string;
  startDate: string;
  endDate: string;
}

export interface ParsedResume {
  name: string;
  email: string;
  phone: string;
  address: string;
  skills: string[];
  experience: ParsedExperienceEntry[];
  totalExperienceYears: number;
  education: ParsedEducationEntry[];
  certifications: string[];
  languages: string[];
  projects: string[];
  companiesWorked: string[];
}

export async function extractTextFromFile(buffer: Buffer, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) {
    // pdf-parse v2 uses a class-based API (PDFParse), not the v1 `pdf(buffer)` function.
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text ?? '';
    } finally {
      await parser.destroy();
    }
  }
  if (lower.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? '';
  }
  return buffer.toString('utf-8');
}

function yearFromToken(token: string): number {
  const match = token.match(/\d{4}/);
  return match ? Number(match[0]) : new Date().getFullYear();
}

function extractEmail(text: string): string {
  const m = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m?.[0] ?? '';
}

function extractPhone(text: string): string {
  const m = text.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/);
  return m?.[0]?.trim() ?? '';
}

function extractName(text: string, email: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    if (line.includes('@') || /resume|curriculum|cv\b/i.test(line)) continue;
    if (line.length > 2 && line.length < 60 && /^[A-Za-z][A-Za-z.\-'\s]+$/.test(line)) {
      return line;
    }
  }
  return email ? email.split('@')[0] : 'Unknown Candidate';
}

function extractAddress(text: string): string {
  const line = text.split('\n').find((l) => /address\s*:/i.test(l));
  if (line) return line.replace(/address\s*:/i, '').trim();
  const cityStateZip = text.match(/[A-Za-z\s]+,\s*[A-Za-z]{2,}\s*\d{4,6}/);
  return cityStateZip?.[0]?.trim() ?? '';
}

function extractSkills(text: string): string[] {
  const found = new Set<string>();
  for (const skill of SKILLS_DICTIONARY) {
    const re = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(text)) found.add(skill);
  }
  return Array.from(found);
}

function extractLanguages(text: string): string[] {
  return LANGUAGE_LIST.filter((lang) => new RegExp(`\\b${lang}\\b`, 'i').test(text));
}

const SECTION_HEADER_RE = /^(experience|work experience|employment history|education|skills|certifications?|languages?|projects?|summary|objective)\s*:?\s*$/i;

/** Returns the lines strictly between a section header matching `startRe` and the next section header. */
function sectionLines(lines: string[], startRe: RegExp): string[] {
  const startIdx = lines.findIndex((l) => startRe.test(l.trim()));
  if (startIdx === -1) return lines;
  const out: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (SECTION_HEADER_RE.test(trimmed) && !startRe.test(trimmed)) break;
    out.push(lines[i]);
  }
  return out;
}

function isPdfArtifactLine(line: string): boolean {
  return /^--+\s*.*\s*--+$/.test(line.trim()) || /^page \d+( of \d+)?$/i.test(line.trim());
}

function extractExperience(text: string): { entries: ParsedExperienceEntry[]; totalYears: number } {
  const allLines = text.split('\n');
  const lines = sectionLines(allLines, /^(experience|work experience|employment history)\s*:?\s*$/i);
  const entries: ParsedExperienceEntry[] = [];
  let totalMonths = 0;

  lines.forEach((line, idx) => {
    DATE_RANGE_RE.lastIndex = 0;
    const match = DATE_RANGE_RE.exec(line);
    if (!match) return;

    const startYear = yearFromToken(match[1]);
    const isCurrent = /present|current/i.test(match[2]);
    const endYear = isCurrent ? new Date().getFullYear() : yearFromToken(match[2]);
    totalMonths += Math.max(0, (endYear - startYear) * 12);

    const beforeDate = line.slice(0, match.index).replace(/[|,\-–—]+$/, '').trim();
    const parts = beforeDate.split(/\s{2,}|\s\|\s|,/).map((p) => p.trim()).filter(Boolean);
    const title = parts[0] ?? beforeDate;
    const company = parts[1] ?? '';

    const descLines: string[] = [];
    for (let i = idx + 1; i < Math.min(idx + 3, lines.length); i++) {
      DATE_RANGE_RE.lastIndex = 0;
      if (DATE_RANGE_RE.test(lines[i])) break; // next job entry starts here
      descLines.push(lines[i]);
    }
    const description = descLines.join(' ').trim().slice(0, 300);

    entries.push({
      company,
      title,
      startDate: match[1],
      endDate: isCurrent ? 'Present' : match[2],
      description,
    });
  });

  return { entries, totalYears: Math.round((totalMonths / 12) * 10) / 10 };
}

function extractEducation(text: string): ParsedEducationEntry[] {
  const lines = text.split('\n');
  const entries: ParsedEducationEntry[] = [];
  lines.forEach((line) => {
    const hasDegree = DEGREE_KEYWORDS.some((kw) => line.toLowerCase().includes(kw.toLowerCase()));
    if (!hasDegree) return;
    DATE_RANGE_RE.lastIndex = 0;
    const dateMatch = DATE_RANGE_RE.exec(line);
    entries.push({
      school: '',
      degree: DEGREE_KEYWORDS.find((kw) => line.toLowerCase().includes(kw.toLowerCase())) ?? '',
      field: line.trim().slice(0, 120),
      startDate: dateMatch?.[1] ?? '',
      endDate: dateMatch?.[2] ?? '',
    });
  });
  return entries;
}

function extractCertifications(text: string): string[] {
  const lines = text.split('\n');
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length < 120 && !isPdfArtifactLine(line) && !SECTION_HEADER_RE.test(line))
    .filter((line) => CERT_KEYWORDS.some((kw) => line.toLowerCase().includes(kw.toLowerCase())))
    .slice(0, 10);
}

function extractProjects(text: string): string[] {
  const lines = text.split('\n').map((l) => l.trim());
  const startIdx = lines.findIndex((l) => /^projects?\b/i.test(l));
  if (startIdx === -1) return [];
  const projectLines: string[] = [];
  for (let i = startIdx + 1; i < lines.length && projectLines.length < 8; i++) {
    const line = lines[i];
    if (!line) continue;
    if (/^(experience|education|skills|certifications|languages)\b/i.test(line)) break;
    if (line.length > 3 && !isPdfArtifactLine(line)) projectLines.push(line);
  }
  return projectLines;
}

export function parseResumeText(text: string): ParsedResume {
  const email = extractEmail(text);
  const { entries, totalYears } = extractExperience(text);
  return {
    name: extractName(text, email),
    email,
    phone: extractPhone(text),
    address: extractAddress(text),
    skills: extractSkills(text),
    experience: entries,
    totalExperienceYears: totalYears,
    education: extractEducation(text),
    certifications: extractCertifications(text),
    languages: extractLanguages(text),
    projects: extractProjects(text),
    companiesWorked: Array.from(new Set(entries.map((e) => e.company).filter(Boolean))),
  };
}

export async function hashText(text: string): Promise<string> {
  const { createHash } = await import('crypto');
  return createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
}
