import { generateSeoAnalysis, parseJsonLoose } from './ai-provider';

export interface KeywordInput {
  businessCategory: string;
  industry: string;
  targetAudience: string;
  targetCountry: string;
  focusKeywords: string[];
}

export interface GeneratedKeyword {
  keyword: string;
  type: 'primary' | 'secondary' | 'long_tail' | 'semantic' | 'related' | 'question';
  intent: 'informational' | 'navigational' | 'transactional' | 'commercial';
  relevance: number;
  competitionEstimate: 'low' | 'medium' | 'high';
  businessValue: number;
}

const QUESTION_STARTERS = ['what is', 'how to choose', 'why use', 'is it worth', 'how much does'];
const COMMERCIAL_MODIFIERS = ['best', 'top', 'affordable', 'premium', 'trusted'];
const LONG_TAIL_MODIFIERS = ['for small business', 'for beginners', 'near me', 'for enterprise', 'that actually works'];
const SEMANTIC_SUFFIXES = ['solutions', 'services', 'platform', 'software', 'tools', 'company'];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h);
}

function competitionFor(keyword: string): 'low' | 'medium' | 'high' {
  const words = keyword.trim().split(/\s+/).length;
  if (words >= 5) return 'low';
  if (words >= 3) return 'medium';
  return 'high';
}

function dedupe(keywords: GeneratedKeyword[]): GeneratedKeyword[] {
  const seen = new Set<string>();
  return keywords.filter((k) => {
    const key = k.keyword.toLowerCase().trim();
    if (seen.has(key) || !key) return false;
    seen.add(key);
    return true;
  });
}

function deterministicKeywords(input: KeywordInput): GeneratedKeyword[] {
  const base = input.focusKeywords.length > 0
    ? input.focusKeywords
    : [input.businessCategory, input.industry].filter(Boolean);

  if (base.length === 0) return [];

  const out: GeneratedKeyword[] = [];

  base.forEach((term, i) => {
    const clean = term.trim();
    if (!clean) return;
    const rank = i === 0 ? 95 : Math.max(60, 95 - i * 10);

    out.push({
      keyword: clean, type: 'primary', intent: 'commercial',
      relevance: rank, competitionEstimate: competitionFor(clean), businessValue: rank,
    });

    SEMANTIC_SUFFIXES.slice(0, 2).forEach((suffix) => {
      const kw = `${clean} ${suffix}`;
      out.push({
        keyword: kw, type: 'secondary', intent: 'commercial',
        relevance: rank - 8, competitionEstimate: competitionFor(kw), businessValue: rank - 10,
      });
    });

    LONG_TAIL_MODIFIERS.slice(0, 2).forEach((mod) => {
      const kw = `${clean} ${mod}`;
      out.push({
        keyword: kw, type: 'long_tail', intent: 'transactional',
        relevance: rank - 15, competitionEstimate: 'low', businessValue: rank - 5,
      });
    });

    if (input.targetAudience) {
      const kw = `${clean} for ${input.targetAudience.toLowerCase()}`;
      out.push({
        keyword: kw, type: 'related', intent: 'commercial',
        relevance: rank - 12, competitionEstimate: competitionFor(kw), businessValue: rank - 8,
      });
    }

    COMMERCIAL_MODIFIERS.slice(0, 2).forEach((mod) => {
      const kw = `${mod} ${clean}`;
      out.push({
        keyword: kw, type: 'semantic', intent: 'commercial',
        relevance: rank - 20, competitionEstimate: competitionFor(kw), businessValue: rank - 15,
      });
    });

    QUESTION_STARTERS.slice(0, 2).forEach((q) => {
      const kw = `${q} ${clean}`;
      out.push({
        keyword: kw, type: 'question', intent: 'informational',
        relevance: rank - 25, competitionEstimate: 'low', businessValue: rank - 20,
      });
    });
  });

  return dedupe(out).map((k) => ({ ...k, relevance: Math.max(5, Math.min(100, k.relevance)), businessValue: Math.max(5, Math.min(100, k.businessValue)) }));
}

export async function generateKeywords(input: KeywordInput, apiKey: string | null): Promise<{ keywords: GeneratedKeyword[]; source: 'ai' | 'deterministic' }> {
  const fallback = deterministicKeywords(input);
  if (!apiKey && !process.env.OPENROUTER_API_KEY) return { keywords: fallback, source: 'deterministic' };

  const systemPrompt = 'You are an SEO/ASO keyword strategist. Given a business profile, generate a diverse keyword set as JSON. '
    + 'Respond ONLY with minified JSON: {"keywords":[{"keyword":string,"type":"primary"|"secondary"|"long_tail"|"semantic"|"related"|"question",'
    + '"intent":"informational"|"navigational"|"transactional"|"commercial","relevance":number(0-100),'
    + '"competitionEstimate":"low"|"medium"|"high","businessValue":number(0-100)}]}. '
    + 'Generate 15-25 keywords covering every type. Do not invent search-volume numbers — reason about intent and specificity instead.';
  const userPrompt = `Business category: ${input.businessCategory || 'unspecified'}\nIndustry: ${input.industry || 'unspecified'}\n`
    + `Target audience: ${input.targetAudience || 'unspecified'}\nTarget country: ${input.targetCountry}\n`
    + `Focus keywords: ${input.focusKeywords.join(', ') || 'none provided — infer from category/industry'}`;

  try {
    const content = await generateSeoAnalysis(apiKey, { systemPrompt, userPrompt, maxTokens: 1800 });
    const parsed = parseJsonLoose(content);
    const list = Array.isArray((parsed as any)?.keywords) ? (parsed as any).keywords : null;
    if (!list || list.length === 0) return { keywords: fallback, source: 'deterministic' };

    const VALID_TYPES = new Set(['primary', 'secondary', 'long_tail', 'semantic', 'related', 'question']);
    const VALID_INTENTS = new Set(['informational', 'navigational', 'transactional', 'commercial']);
    const VALID_COMPETITION = new Set(['low', 'medium', 'high']);

    const keywords: GeneratedKeyword[] = dedupe(
      list
        .filter((k: any) => k && typeof k.keyword === 'string' && VALID_TYPES.has(k.type))
        .map((k: any) => ({
          keyword: String(k.keyword).trim(),
          type: k.type,
          intent: VALID_INTENTS.has(k.intent) ? k.intent : 'informational',
          relevance: Math.max(0, Math.min(100, Number(k.relevance) || hashCode(k.keyword) % 40 + 40)),
          competitionEstimate: VALID_COMPETITION.has(k.competitionEstimate) ? k.competitionEstimate : competitionFor(k.keyword),
          businessValue: Math.max(0, Math.min(100, Number(k.businessValue) || 50)),
        })),
    );
    return keywords.length > 0 ? { keywords, source: 'ai' } : { keywords: fallback, source: 'deterministic' };
  } catch {
    return { keywords: fallback, source: 'deterministic' };
  }
}
