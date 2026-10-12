import { NextResponse } from 'next/server';

import { adminAuthorized } from '@/app/api-guard';
import { tao1GenerateImage, tao1VisionText } from '@/app/tao1-image';
import { tao1ConnectionFromEnv } from '@/app/tao1-text';

export const runtime = 'nodejs';
export const maxDuration = 300;

// ADMIN PROBE (AI2 2026-10-12): POST {kind:'image', prompt} or {kind:'vision', image (data URL), question} with X-Atlas-Admin: runs one TAO-1 image or vision call and returns
// the size, timing, usage and the source URL (never the key). For checking the image path (Chutes through TAO-1) before it is wired into builds.
export async function POST(request: Request) {
  if (!adminAuthorized(request)) return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  const conn = tao1ConnectionFromEnv();
  if (!conn) return NextResponse.json({ error: 'No TAO1_API_KEY.' }, { status: 503 });
  const body = await request.json().catch(() => ({})) as { kind?: string; prompt?: string; image?: string; question?: string; chute?: string; payload?: Record<string, unknown> };
  if (body.kind === 'chutes-raw') {
    // one raw call to a whitelisted chute with the given JSON body: returns the status and the first part of an error body, or the image type and size
    const urls: Record<string, string> = { qwen: 'https://vonkaiser-qwen-image-2512.chutes.ai/generate', z: 'https://vonkaiser-z-image-turbo.chutes.ai/generate' };
    const key = process.env.CHUTES_API_KEY?.trim();
    if (!key || !body.chute || !urls[body.chute]) return NextResponse.json({ error: 'No CHUTES_API_KEY or unknown chute (qwen | z).' }, { status: 400 });
    const t0 = Date.now();
    const r = await fetch(urls[body.chute], { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body.payload ?? {}) });
    const type = r.headers.get('content-type') ?? '';
    const buf = Buffer.from(await r.arrayBuffer());
    return NextResponse.json({ status: r.status, ms: Date.now() - t0, type, bytes: buf.length, text: /json|text/.test(type) || !r.ok ? buf.toString('utf8').slice(0, 500) : null });
  }
  try {
    if (body.kind === 'image' && body.prompt) {
      const r = await tao1GenerateImage(conn, body.prompt.slice(0, 4000));
      return NextResponse.json({ ok: true, ms: r.ms, bytes: r.bytes, mime: r.mime, width: r.width, height: r.height, sourceUrl: r.sourceUrl, usage: r.usage });
    }
    if (body.kind === 'vision' && body.image && body.question) {
      const r = await tao1VisionText(conn, 'Answer with one JSON object only.', body.question.slice(0, 4000), body.image);
      return NextResponse.json({ ok: true, ms: r.ms, usage: r.usage, text: r.text.slice(0, 4000) });
    }
    return NextResponse.json({ error: 'Send {kind:"image",prompt} or {kind:"vision",image,question}.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'failed' }, { status: 502 });
  }
}
