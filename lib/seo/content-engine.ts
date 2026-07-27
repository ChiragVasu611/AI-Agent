import { generateSeoAnalysis } from './ai-provider';

export type ContentType =
  | 'seo_title' | 'meta_description' | 'blog_idea' | 'landing_page' | 'faq'
  | 'product_description' | 'app_description' | 'release_notes' | 'social_caption';

export interface ContentContext {
  name: string;
  companyName: string;
  businessCategory: string;
  industry: string;
  targetAudience: string;
  targetCountry: string;
  focusKeywords: string[];
}

const TYPE_LABEL: Record<ContentType, string> = {
  seo_title: 'SEO Title',
  meta_description: 'Meta Description',
  blog_idea: 'Blog Idea',
  landing_page: 'Landing Page Copy',
  faq: 'FAQ',
  product_description: 'Product Description',
  app_description: 'App Description',
  release_notes: 'Release Notes',
  social_caption: 'Social Media Caption',
};

function deterministicContent(type: ContentType, ctx: ContentContext): { title: string; body: string } {
  const brand = ctx.companyName || ctx.name;
  const kw = ctx.focusKeywords[0] || ctx.businessCategory || ctx.industry || 'our solution';
  const audience = ctx.targetAudience || 'your team';

  switch (type) {
    case 'seo_title':
      return { title: `${TYPE_LABEL[type]} — ${kw}`, body: `${brand} | ${kw.replace(/\b\w/g, (c) => c.toUpperCase())} for ${audience}` };
    case 'meta_description':
      return { title: TYPE_LABEL[type], body: `${brand} helps ${audience.toLowerCase()} with ${kw}. Discover features, pricing, and why teams in ${ctx.targetCountry} choose us today.` };
    case 'blog_idea':
      return {
        title: TYPE_LABEL[type],
        body: [
          `1. "The Complete Guide to ${kw} in ${new Date().getFullYear()}"`,
          `2. "5 Mistakes ${audience} Make with ${kw} (and How to Fix Them)"`,
          `3. "${kw} vs. Alternatives: What ${audience} Should Know"`,
          `4. "How ${brand} Approaches ${kw} for ${ctx.industry || ctx.businessCategory}"`,
          `5. "${kw} Checklist for ${audience} in ${ctx.targetCountry}"`,
        ].join('\n'),
      };
    case 'landing_page':
      return {
        title: TYPE_LABEL[type],
        body: `Headline: The ${kw} platform built for ${audience}\n\nSubheadline: ${brand} helps ${audience.toLowerCase()} achieve results faster with ${kw}, without the complexity.\n\nCTA: Get Started Free`,
      };
    case 'faq':
      return {
        title: TYPE_LABEL[type],
        body: [
          `Q: What is ${brand}?\nA: ${brand} is a ${ctx.businessCategory || ctx.industry} solution focused on ${kw} for ${audience.toLowerCase()}.`,
          `Q: Who is ${brand} for?\nA: ${brand} is built for ${audience.toLowerCase()} in ${ctx.targetCountry}.`,
          `Q: How does ${brand} help with ${kw}?\nA: By combining ${kw}-focused features with a workflow designed for ${audience.toLowerCase()}.`,
        ].join('\n\n'),
      };
    case 'product_description':
      return { title: TYPE_LABEL[type], body: `${brand} is the ${kw} solution built for ${audience.toLowerCase()}. It combines simplicity with powerful ${ctx.businessCategory || ctx.industry} features so teams in ${ctx.targetCountry} can move faster.` };
    case 'app_description':
      return { title: TYPE_LABEL[type], body: `${brand} brings ${kw} to ${audience.toLowerCase()} in one simple app. Built for ${ctx.industry || ctx.businessCategory}, ${brand} helps you get results without the learning curve. Download today and see why users in ${ctx.targetCountry} love it.` };
    case 'release_notes':
      return { title: TYPE_LABEL[type], body: `What's New:\n- Improved ${kw} performance and reliability\n- Bug fixes and stability improvements\n- Minor UI refinements based on user feedback` };
    case 'social_caption':
      return { title: TYPE_LABEL[type], body: `Struggling with ${kw}? ${brand} makes it simple for ${audience.toLowerCase()}. Try it today. #${(ctx.businessCategory || ctx.industry || 'growth').replace(/\s+/g, '')}` };
    default:
      return { title: TYPE_LABEL[type], body: '' };
  }
}

export async function generateContent(
  type: ContentType, ctx: ContentContext, apiKey: string | null,
): Promise<{ title: string; body: string; source: 'ai' | 'deterministic' }> {
  const fallback = deterministicContent(type, ctx);
  if (!apiKey && !process.env.OPENROUTER_API_KEY) return { ...fallback, source: 'deterministic' };

  const systemPrompt = `You are an expert SEO/ASO copywriter. Write a "${TYPE_LABEL[type]}" for the given business. `
    + 'Respond ONLY with minified JSON: {"title":string,"body":string}. Keep it realistic, specific, and free of placeholder brackets.';
  const userPrompt = `Business: ${ctx.companyName || ctx.name}\nCategory: ${ctx.businessCategory || 'unspecified'}\n`
    + `Industry: ${ctx.industry || 'unspecified'}\nTarget audience: ${ctx.targetAudience || 'unspecified'}\n`
    + `Target country: ${ctx.targetCountry}\nFocus keywords: ${ctx.focusKeywords.join(', ') || 'none provided'}\nContent type: ${TYPE_LABEL[type]}`;

  try {
    const content = await generateSeoAnalysis(apiKey, { systemPrompt, userPrompt, maxTokens: 500 });
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return { ...fallback, source: 'deterministic' };
    const parsed = JSON.parse(match[0]);
    if (!parsed?.body) return { ...fallback, source: 'deterministic' };
    return { title: String(parsed.title ?? fallback.title), body: String(parsed.body), source: 'ai' };
  } catch {
    return { ...fallback, source: 'deterministic' };
  }
}
