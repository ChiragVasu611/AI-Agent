import { generateSeoAnalysis, parseJsonLoose } from './ai-provider';

export interface ProjectAnalysisInput {
  name: string;
  companyName: string;
  projectType: string;
  businessCategory: string;
  industry: string;
  targetAudience: string;
  targetCountry: string;
  language: string;
  focusKeywords: string[];
  websiteUrl: string | null;
  playStoreUrl: string | null;
  appStoreUrl: string | null;
}

export interface ProjectAnalysisResult {
  businessType: string;
  productType: string;
  userIntent: string;
  targetMarket: string;
  businessGoals: string[];
  conversionGoals: string[];
  businessSummary: string;
  seoStrategy: string;
  asoStrategy: string;
  growthRoadmap: string;
  source: 'ai' | 'deterministic';
}

const PROJECT_TYPE_LABEL: Record<string, string> = {
  website: 'Website',
  android: 'Android Application',
  ios: 'iOS Application',
  flutter: 'Flutter Application',
  react_native: 'React Native Application',
  hybrid: 'Hybrid Application',
  web_app: 'Web Application',
};

const HAS_APP = new Set(['android', 'ios', 'flutter', 'react_native', 'hybrid']);
const HAS_WEB = new Set(['website', 'web_app', 'hybrid']);

function deterministicAnalysis(input: ProjectAnalysisInput): ProjectAnalysisResult {
  const typeLabel = PROJECT_TYPE_LABEL[input.projectType] ?? input.projectType;
  const category = input.businessCategory || 'general business';
  const industry = input.industry || category;
  const audience = input.targetAudience || 'a broad general audience';
  const keywords = input.focusKeywords.length > 0 ? input.focusKeywords.join(', ') : `${category} solutions`;
  const isApp = HAS_APP.has(input.projectType) || !!input.playStoreUrl || !!input.appStoreUrl;
  const isWeb = HAS_WEB.has(input.projectType) || !!input.websiteUrl;

  const businessType = `${industry} ${isApp && isWeb ? 'company with both a web and mobile presence' : isApp ? 'mobile app business' : 'web-based business'}`;
  const productType = `${typeLabel} targeting ${category}`;
  const userIntent = `Users searching in the ${category} space are typically looking to research, compare, and ultimately act on ${keywords} — spanning informational research through to transactional intent.`;
  const targetMarket = `${audience} in ${input.targetCountry}, primarily communicating in ${input.language}.`;

  const businessGoals = [
    `Increase organic visibility for ${category} in ${input.targetCountry}`,
    isApp ? 'Improve app store ranking and install conversion rate' : 'Improve website search ranking and traffic quality',
    'Build topical authority and trust within the industry',
    'Reduce customer acquisition cost through owned organic channels',
  ];

  const conversionGoals = isApp && isWeb
    ? ['App installs', 'Store page conversion rate', 'Website sign-ups', 'Trial-to-paid conversion']
    : isApp
      ? ['App installs', 'Store page conversion rate', 'In-app activation']
      : ['Website sign-ups', 'Lead form submissions', 'Trial-to-paid conversion'];

  const businessSummary = `${input.companyName || input.name} operates a ${businessType.toLowerCase()} in the ${industry} industry, `
    + `serving ${audience.toLowerCase()} in ${input.targetCountry}. The ${typeLabel.toLowerCase()} is positioned around ${keywords}, `
    + `with growth expected to come from a combination of organic search${isApp ? ' and app store discovery' : ''}.`;

  const seoStrategy = isWeb
    ? `Focus on topical-cluster content around "${keywords}", strengthen technical SEO fundamentals (crawlability, structured data, `
      + `Core Web Vitals), and build internal linking that funnels informational traffic toward transactional pages. `
      + `Prioritize ${input.targetCountry}-specific search intent and ${input.language}-language content quality.`
    : `Even without a marketing website, maintain a minimal indexable web presence (landing page, press mentions, developer docs) `
      + `so branded and category searches surface authoritative results that funnel into the app stores.`;

  const asoStrategy = isApp
    ? `Optimize the store listing title and short description around "${keywords}", refresh screenshots to lead with the strongest `
      + `value proposition for ${audience.toLowerCase()}, and iterate keyword fields based on category competition in ${input.targetCountry}. `
      + `Track category ranking and conversion rate (impressions → installs) as the primary ASO health signals.`
    : `Not applicable — no app store presence configured for this project yet. Add a Play Store or App Store URL to unlock ASO analysis.`;

  const growthRoadmap = `Weeks 1-2: fix critical technical/metadata issues surfaced by the audit. `
    + `Weeks 3-6: publish keyword-targeted content and optimize ${isApp ? 'store listing assets' : 'landing pages'}. `
    + `Weeks 7-12: build authority (backlinks/reviews/mentions), expand into secondary keyword clusters, and re-audit to measure score lift.`;

  return {
    businessType, productType, userIntent, targetMarket, businessGoals, conversionGoals,
    businessSummary, seoStrategy, asoStrategy, growthRoadmap, source: 'deterministic',
  };
}

export async function runProjectAnalysis(input: ProjectAnalysisInput, apiKey: string | null): Promise<ProjectAnalysisResult> {
  const fallback = deterministicAnalysis(input);
  if (!apiKey && !process.env.OPENROUTER_API_KEY) return fallback;

  const systemPrompt = 'You are a senior SEO/ASO growth strategist. Given a project profile, produce a JSON object analyzing the business '
    + 'and a growth strategy. Respond ONLY with minified JSON: {"businessType":string,"productType":string,"userIntent":string,'
    + '"targetMarket":string,"businessGoals":string[3-5],"conversionGoals":string[2-4],"businessSummary":string(2-3 sentences),'
    + '"seoStrategy":string(3-5 sentences),"asoStrategy":string(3-5 sentences, or explain not applicable if no app store presence),'
    + '"growthRoadmap":string(a Weeks 1-2 / 3-6 / 7-12 phased plan)}. Be specific to the project, not generic.';
  const userPrompt = `Project: "${input.name}" (${input.companyName || 'no company name given'})\n`
    + `Type: ${PROJECT_TYPE_LABEL[input.projectType] ?? input.projectType}\n`
    + `Business category: ${input.businessCategory || 'unspecified'}\nIndustry: ${input.industry || 'unspecified'}\n`
    + `Target audience: ${input.targetAudience || 'unspecified'}\nTarget country: ${input.targetCountry}\nLanguage: ${input.language}\n`
    + `Focus keywords: ${input.focusKeywords.join(', ') || 'none provided'}\n`
    + `Website: ${input.websiteUrl || 'none'}\nPlay Store: ${input.playStoreUrl || 'none'}\nApp Store: ${input.appStoreUrl || 'none'}`;

  try {
    const content = await generateSeoAnalysis(apiKey, { systemPrompt, userPrompt, maxTokens: 1200 });
    const parsed = parseJsonLoose(content);
    if (!parsed || typeof parsed.businessSummary !== 'string') return fallback;
    return {
      businessType: String(parsed.businessType ?? fallback.businessType),
      productType: String(parsed.productType ?? fallback.productType),
      userIntent: String(parsed.userIntent ?? fallback.userIntent),
      targetMarket: String(parsed.targetMarket ?? fallback.targetMarket),
      businessGoals: Array.isArray(parsed.businessGoals) ? parsed.businessGoals.map(String) : fallback.businessGoals,
      conversionGoals: Array.isArray(parsed.conversionGoals) ? parsed.conversionGoals.map(String) : fallback.conversionGoals,
      businessSummary: String(parsed.businessSummary),
      seoStrategy: String(parsed.seoStrategy ?? fallback.seoStrategy),
      asoStrategy: String(parsed.asoStrategy ?? fallback.asoStrategy),
      growthRoadmap: String(parsed.growthRoadmap ?? fallback.growthRoadmap),
      source: 'ai',
    };
  } catch {
    return fallback;
  }
}
