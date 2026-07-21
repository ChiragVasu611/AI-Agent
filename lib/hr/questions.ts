/** Deterministic, template-based interview question generation. No external AI API. */
import type { Candidate, InterviewQuestionItem, Job, QuestionCategory } from '@/lib/types';

const HR_QUESTIONS = [
  'Tell me about yourself and your career journey so far.',
  'Why are you interested in this role and our company?',
  'What are your salary expectations?',
  'What is your notice period at your current organization?',
  'Where do you see yourself in the next 3-5 years?',
  'Why are you looking to leave your current role?',
];

const BEHAVIORAL_QUESTIONS = [
  'Describe a time you disagreed with a teammate. How did you resolve it?',
  'Tell me about a time you failed at something. What did you learn?',
  'Describe a situation where you had to meet a tight deadline.',
  'Tell me about a time you had to give difficult feedback to a colleague.',
  'Describe a time you took initiative without being asked.',
];

const SCENARIO_QUESTIONS = [
  'If you inherited a project with no documentation and the original owner had left, how would you approach it?',
  'A stakeholder asks for a feature that conflicts with technical best practices — how do you handle it?',
  'You discover a critical bug in production right before a release deadline. What do you do?',
  'Two team members disagree on the technical approach to a problem — how do you help resolve it?',
];

const SKILL_TECHNICAL_QUESTIONS: Record<string, string[]> = {
  javascript: ['Explain the difference between `let`, `const`, and `var`.', 'What is a closure and how have you used one?', 'Explain the JavaScript event loop.'],
  typescript: ['What are generics in TypeScript and when would you use them?', 'Explain the difference between `interface` and `type`.'],
  react: ['Explain the React component lifecycle / effect dependencies.', 'How do you optimize performance in a large React app?', 'What are React hooks and why were they introduced?'],
  'node.js': ['How does Node.js handle asynchronous I/O?', 'Explain the event loop in Node.js.'],
  python: ['Explain list comprehensions and when you would use them.', 'What is the GIL and how does it affect concurrency?'],
  java: ['Explain the difference between an abstract class and an interface.', 'How does garbage collection work in the JVM?'],
  sql: ['Explain the difference between INNER JOIN and LEFT JOIN.', 'How would you optimize a slow-running query?'],
  aws: ['Explain the difference between EC2 and Lambda.', 'How would you design a highly available architecture on AWS?'],
  docker: ['Explain the difference between an image and a container.', 'How do you optimize a Dockerfile for smaller image size?'],
  'machine learning': ['Explain the bias-variance tradeoff.', 'How do you handle an imbalanced dataset?'],
  'project management': ['How do you handle scope creep in a project?', 'Describe how you prioritize a backlog.'],
  leadership: ['How do you motivate an underperforming team member?', 'Describe your approach to delegating tasks.'],
};

const CODING_QUESTIONS = [
  'Write a function to reverse a linked list.',
  'Given an array of integers, find two numbers that add up to a target value.',
  'Implement a function to check if a string is a valid palindrome.',
  'Write a function to find the longest substring without repeating characters.',
  'Implement a debounce function in JavaScript.',
];

function pick<T>(arr: T[], n: number): T[] {
  return arr.slice(0, n);
}

export function generateInterviewQuestions(
  job: Pick<Job, 'title' | 'requiredSkills' | 'experienceMinYears'>,
  candidate?: Pick<Candidate, 'skills'>,
): InterviewQuestionItem[] {
  const questions: InterviewQuestionItem[] = [];

  pick(HR_QUESTIONS, 3).forEach((q) => questions.push({ category: 'hr', question: q }));
  pick(BEHAVIORAL_QUESTIONS, 3).forEach((q) => questions.push({ category: 'behavioral', question: q }));
  pick(SCENARIO_QUESTIONS, 2).forEach((q) => questions.push({ category: 'scenario', question: q }));

  const skillPool = candidate?.skills?.length ? candidate.skills : job.requiredSkills;
  const technical: string[] = [];
  skillPool.forEach((skill) => {
    const bank = SKILL_TECHNICAL_QUESTIONS[skill.toLowerCase()];
    if (bank) technical.push(...bank);
  });
  if (technical.length === 0) {
    technical.push(
      `Walk me through how you would approach a typical ${job.title} project from start to finish.`,
      `What tools or frameworks do you rely on most as a ${job.title}, and why?`,
    );
  }
  pick(Array.from(new Set(technical)), 5).forEach((q) => questions.push({ category: 'technical', question: q }));

  const includeCoding = skillPool.some((s) => /developer|engineer|programmer/i.test(job.title))
    || SKILL_TECHNICAL_QUESTIONS[skillPool[0]?.toLowerCase() ?? ''];
  if (includeCoding || job.experienceMinYears >= 0) {
    pick(CODING_QUESTIONS, 2).forEach((q) => questions.push({ category: 'coding', question: q }));
  }

  return questions;
}

export const QUESTION_CATEGORY_LABEL: Record<QuestionCategory, string> = {
  hr: 'HR',
  technical: 'Technical',
  behavioral: 'Behavioral',
  coding: 'Coding',
  scenario: 'Scenario-Based',
};
