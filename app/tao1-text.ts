// TEXT CALLS THROUGH THE TAO-1 API (AI2 2026-10-11, Phase B): the research and supplier passes that used gpt-5.4-mini / gpt-6-astra with the OpenAI web_search tool can
// run on TAO-1 instead (https://api.jtao.ai/v1, OpenAI-compatible chat completions; TAO-1 does its own live search and picks DS or K3). This adapter takes the same
// Responses-style request the route already builds ({ instructions, input, text.format.json_schema }) and returns a payload shaped like a completed Responses
// result, so extractOutputText, the schemas, normalizeAtlas and the cost ledger work unchanged. Images and image-input calls (QA, hotspots) stay on OpenAI.
// Env: TAO1_API_KEY (server only), TAO1_BASE_URL (default https://api.jtao.ai/v1, the API door for internal keys; tao1.ai/v1 is the site's customer-key door and answers 401 to anything else), TAO1_MODEL (default tao-1), ATLAS_TEXT_PROVIDER=tao1 to turn it on.
import { Agent, fetch as undiciFetch } from 'undici';

import { currentBuildId } from '@/app/cost-ledger';

export type Tao1Connection = { baseUrl: string; apiKey: string; model: string };

const dispatcher = new Agent({ headersTimeout: 780_000, bodyTimeout: 780_000, connectTimeout: 30_000 });

export function tao1ConnectionFromEnv(): Tao1Connection | null {
  const apiKey = process.env.TAO1_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, baseUrl: (process.env.TAO1_BASE_URL?.trim() || 'https://api.jtao.ai/v1').replace(/\/+$/, ''), model: process.env.TAO1_MODEL?.trim() || 'tao-1' };
}

function extractJson(text: string): unknown {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(stripped); } catch { /* fall through to the outermost object */ }
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(stripped.slice(start, end + 1));
  throw new Error('no JSON object in the reply');
}

function requiredKeysMissing(value: unknown, schema: Record<string, unknown>) {
  if (!value || typeof value !== 'object') return ['(object)'];
  const required = Array.isArray(schema.required) ? schema.required as string[] : [];
  return required.filter((key) => !(key in (value as Record<string, unknown>)));
}

export type Tao1Usage = { prompt_tokens?: number; completion_tokens?: number };

/** one structured research call; returns a Responses-shaped completed payload */
export async function tao1StructuredCall(conn: Tao1Connection, body: Record<string, unknown>, onlyModel?: string): Promise<Record<string, unknown>> {
  const text = body.text as { format?: { schema?: Record<string, unknown>; name?: string } } | undefined;
  const schema = text?.format?.schema ?? {};
  const maxOut = typeof body.max_output_tokens === 'number' ? body.max_output_tokens : 32_000;
  const system = `${String(body.instructions ?? '')}

You have live web search: search before you answer and cite only pages you actually found. When the schema has a sources list, return as many distinct authoritative sources as the subject supports (manufacturer pages and manuals, standards, museums, universities, filings): at least 15, and at least 25 when the subject has more than 30 components, as long as each is a different real page you found. When the schema asks for coverage records, return exactly one for every component id supplied. Reply with ONE JSON object and nothing else: no prose, no code fence. It must satisfy this JSON schema exactly (every required key present, no extra keys):
${JSON.stringify(schema)}`;
  const messages: Array<{ role: string; content: string }> = [{ role: 'system', content: system }, { role: 'user', content: String(body.input ?? '') }];
  let usage: Tao1Usage = { prompt_tokens: 0, completion_tokens: 0 };
  let lastError = 'unknown';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await undiciFetch(`${conn.baseUrl}/chat/completions`, {
      dispatcher,
      method: 'POST',
      headers: { Authorization: `Bearer ${conn.apiKey}`, 'Content-Type': 'application/json' },
      // The TAO-1 API does not read a client X-Request-Id; metadata.session_id is how a call joins a ledger session (a scoped key forces its own session anyway). max_tokens and response_format are
      // hints that the live API may ignore today, so the schema is also stated in the system prompt and the reply is parsed and repaired here.
      body: JSON.stringify({ model: conn.model, ...(onlyModel ? { only_model: onlyModel } : {}), messages, max_tokens: maxOut, response_format: { type: 'json_object' }, metadata: { session_id: `explode-${currentBuildId() ?? 'adhoc'}`, source: 'explode-anything' } }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      if (response.status === 400 && /response_format/i.test(detail) && attempt === 0) { lastError = detail; continue; }
      throw new Error(`TAO-1 text call failed (${response.status}): ${detail}`);
    }
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: Tao1Usage };
    usage = { prompt_tokens: (usage.prompt_tokens ?? 0) + (payload.usage?.prompt_tokens ?? 0), completion_tokens: (usage.completion_tokens ?? 0) + (payload.usage?.completion_tokens ?? 0) };
    const content = payload.choices?.[0]?.message?.content ?? '';
    try {
      const parsed = extractJson(content);
      const missing = requiredKeysMissing(parsed, schema);
      if (missing.length) throw new Error(`missing keys: ${missing.join(', ')}`);
      return {
        status: 'completed',
        model: conn.model,
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(parsed) }] }],
        usage: { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens },
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'invalid reply';
      messages.push({ role: 'assistant', content: content.slice(0, 4000) }, { role: 'user', content: `That reply was not usable (${lastError}). Reply again with ONE complete JSON object that satisfies the schema, nothing else.` });
    }
  }
  throw new Error(`TAO-1 returned no usable JSON after 3 attempts (${lastError}).`);
}
