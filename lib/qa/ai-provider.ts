/**
 * QA module's AI client. Uses the user's own OpenRouter key (free or paid —
 * configurable in QA Settings) when set, falling back to the shared
 * OPENROUTER_API_KEY env var. No key is ever hardcoded.
 */
const FREE_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';

export interface QaAiRequest {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

export async function generateQaAnalysis(apiKey: string | null, req: QaAiRequest): Promise<string> {
  const key = apiKey || process.env.OPENROUTER_API_KEY || '';
  if (!key) {
    throw new Error('No OpenRouter API key configured. Add one in QA Settings, or set OPENROUTER_API_KEY.');
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL ?? 'http://localhost:3000',
      'X-Title': 'Enterprise AI Agent Framework — QA Command Center',
    },
    body: JSON.stringify({
      model: FREE_MODEL,
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.userPrompt },
      ],
      temperature: 0.5,
      max_tokens: req.maxTokens ?? 1400,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter API ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

export function parseJsonLoose(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}
