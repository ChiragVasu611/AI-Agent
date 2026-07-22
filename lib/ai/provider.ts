export type AIModel =
  | 'nvidia/nemotron-3-super-120b-a12b:free'
  | 'nvidia/nemotron-3-ultra-550b-a55b:free';

export interface AIRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface AIResponse {
  content: string;
  model: AIModel;
  usage?: { promptTokens: number; completionTokens: number };
  raw?: unknown;
}

export interface AIProvider {
  name: string;
  generate(req: AIRequest, model: AIModel, overrideApiKey?: string | null): Promise<AIResponse>;
}

/**
 * OpenRouterProvider - centralised abstraction over the NVIDIA Nemotron models
 * served through OpenRouter's OpenAI-compatible API.
 *
 * A per-model API key is supported so the free Ultra and Super models can use
 * separate keys/quotas:
 *   - OPENROUTER_API_KEY_ULTRA  → nemotron-3-ultra
 *   - OPENROUTER_API_KEY_SUPER  → nemotron-3-super
 *   - OPENROUTER_API_KEY        → fallback for either
 * A missing key throws — there is no mock fallback.
 *
 * Swapping providers later (OpenAI, Anthropic, self-hosted) only requires
 * implementing the AIProvider interface and binding it in getAIProvider().
 * Business logic in the agent pipeline never imports a concrete provider.
 */
export class OpenRouterProvider implements AIProvider {
  name = 'openrouter';
  private fallbackKey: string;
  private ultraKey: string;
  private superKey: string;
  private baseUrl = 'https://openrouter.ai/api/v1';

  constructor() {
    this.fallbackKey = process.env.OPENROUTER_API_KEY ?? '';
    this.ultraKey = process.env.OPENROUTER_API_KEY_ULTRA ?? this.fallbackKey;
    this.superKey = process.env.OPENROUTER_API_KEY_SUPER ?? this.fallbackKey;
  }

  private keyFor(model: AIModel): string {
    if (model.includes('ultra')) return this.ultraKey;
    if (model.includes('super')) return this.superKey;
    return this.fallbackKey;
  }

  async generate(req: AIRequest, model: AIModel, overrideApiKey?: string | null): Promise<AIResponse> {
    const apiKey = overrideApiKey || this.keyFor(model);

    if (!apiKey) {
      throw new Error(
        `No OpenRouter API key configured for model "${model}". Set OPENROUTER_API_KEY_ULTRA / OPENROUTER_API_KEY_SUPER or OPENROUTER_API_KEY, or add your own key in Settings.`,
      );
    }

    // Fail fast instead of hanging the pipeline if the model stalls.
    const timeoutMs = req.timeoutMs ?? Number(process.env.OPENROUTER_TIMEOUT_MS ?? 90_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          // Optional attribution headers recommended by OpenRouter.
          'HTTP-Referer': process.env.OPENROUTER_SITE_URL ?? 'http://localhost:3000',
          'X-Title': 'Enterprise AI Agent Framework',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: req.systemPrompt },
            { role: 'user', content: req.userPrompt },
          ],
          temperature: req.temperature ?? 0.4,
          max_tokens: req.maxTokens ?? 2048,
        }),
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        throw new Error(`OpenRouter request for "${model}" timed out after ${timeoutMs}ms`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter API ${res.status}: ${text}`);
    }

    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? '';
    return {
      content,
      model,
      usage: {
        promptTokens: data?.usage?.prompt_tokens ?? 0,
        completionTokens: data?.usage?.completion_tokens ?? 0,
      },
      raw: data,
    };
  }
}

let _provider: AIProvider | null = null;
export function getAIProvider(): AIProvider {
  if (!_provider) _provider = new OpenRouterProvider();
  return _provider;
}
