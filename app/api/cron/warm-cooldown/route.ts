import { NextResponse } from 'next/server';

import { coolDownIfDue } from '@/app/image-fallback';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Vercel cron (vercel.json): puts the RunPod base endpoint back to workersMin 0 once its warm window has ended. Vercel sends Authorization: Bearer $CRON_SECRET; without CRON_SECRET the route refuses.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16 || request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  try { return NextResponse.json(await coolDownIfDue()); } catch (error) { console.warn('warm cooldown failed', error); return NextResponse.json({ error: 'cooldown failed' }, { status: 500 }); }
}
