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
  const body = await request.json().catch(() => ({})) as { kind?: string; prompt?: string; image?: string; question?: string };
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
