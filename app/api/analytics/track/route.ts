import { NextResponse } from 'next/server';

import { recordAnalyticsEvent } from '@/app/analytics';

export const runtime = 'nodejs';

const windows = new Map<string, number[]>();

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin) {
    const originHost = new URL(origin).host;
    const requestHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host;
    if (originHost !== requestHost) return NextResponse.json({ error: 'Invalid origin.' }, { status: 403 });
  }
  if (Number(request.headers.get('content-length') ?? 0) > 8_192) return NextResponse.json({ error: 'Payload too large.' }, { status: 413 });
  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const now = Date.now();
  const recent = (windows.get(client) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= 180) return new Response(null, { status: 204 });
  recent.push(now);
  windows.set(client, recent);
  try {
    const body = await request.json() as Record<string, unknown>;
    await recordAnalyticsEvent(body, request.headers);
  } catch (error) {
    console.warn('Analytics event was not stored', error);
  }
  return new Response(null, { status: 204 });
}
