import { NextResponse } from 'next/server';

import { adminAuthorized } from '@/app/api-guard';

export const runtime = 'nodejs';
export const maxDuration = 60;

// ADMIN DIAGNOSTIC (AI2 2026-10-11): which OpenAI organisation and project this deployment's key belongs to, and the raw upstream error a tiny call returns.
// GET with X-Atlas-Admin. It never returns the key. Calls: GET /v1/models (reads the openai-organization / openai-project response headers) and one 16-token
// /v1/responses call (the raw error type, code and message if it fails).
export async function GET(request: Request) {
  if (!adminAuthorized(request)) return NextResponse.json({ error: 'Not authorised.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'No OPENAI_API_KEY on this deployment.' }, { status: 503 });
  const pick = (headers: Headers) => Object.fromEntries(['openai-organization', 'openai-project', 'openai-version', 'x-request-id'].map((name) => [name, headers.get(name)]));
  const out: Record<string, unknown> = { keyShape: `${apiKey.slice(0, 7)}…(${apiKey.length} chars)` };
  try {
    const models = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${apiKey}` }, cache: 'no-store' });
    const body = await models.text();
    out.models = { status: models.status, headers: pick(models.headers), error: models.ok ? null : body.slice(0, 600) };
  } catch (error) {
    out.models = { error: error instanceof Error ? error.message : 'request failed' };
  }
  try {
    const model = process.env.OPENAI_DRAFT_MODEL ?? 'gpt-5.4-mini';
    const tiny = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: 'Reply with the single word ok.', max_output_tokens: 16 }),
      cache: 'no-store',
    });
    const text = await tiny.text();
    let parsed: { error?: { type?: string; code?: string; message?: string }; status?: string; usage?: unknown } = {};
    try { parsed = JSON.parse(text); } catch { /* keep the raw text below */ }
    out.responses = { status: tiny.status, headers: pick(tiny.headers), error: parsed.error ?? (tiny.ok ? null : text.slice(0, 600)), responseStatus: parsed.status ?? null, usage: parsed.usage ?? null };
  } catch (error) {
    out.responses = { error: error instanceof Error ? error.message : 'request failed' };
  }
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
