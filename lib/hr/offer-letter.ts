/** Template-based offer letter generation. No external AI API. */
export function generateOfferLetter(opts: {
  candidateName: string;
  jobTitle: string;
  department: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  companyName?: string;
}): string {
  const { candidateName, jobTitle, department, salaryMin, salaryMax, salaryCurrency, companyName = 'the company' } = opts;
  const salaryLine = salaryMin || salaryMax
    ? `an annual compensation of ${salaryCurrency} ${(salaryMin ?? salaryMax)?.toLocaleString()}${salaryMax && salaryMin && salaryMax !== salaryMin ? ` - ${salaryCurrency} ${salaryMax.toLocaleString()}` : ''}`
    : 'compensation to be discussed';
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return `Dear ${candidateName},

We are pleased to offer you the position of ${jobTitle} in the ${department} department at ${companyName}. This offer reflects our confidence in your skills and experience, and we are excited about the contributions you will bring to our team.

Position: ${jobTitle}
Department: ${department}
Compensation: ${salaryLine}
Offer Date: ${today}

This offer is contingent upon successful completion of any pre-employment requirements. Please review the terms and confirm your acceptance at your earliest convenience.

We look forward to welcoming you to the team.

Sincerely,
Hiring Team
${companyName}`;
}
