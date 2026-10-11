import { NextResponse } from 'next/server';
import { list } from '@vercel/blob';

import { adminAuthorized } from '@/app/api-guard';
import { galleryRoot, hasSharedAtlasStore } from '@/app/atlas-store';
import type { UsageRecord } from '@/app/cost-ledger';

export const runtime = 'nodejs';
export const maxDuration = 60;

// ADMIN READ OF THE PER-BUILD USAGE RECORDS (AI2 2026-10-11): GET /api/admin/builds?date=YYYY-MM-DD&limit=200&detail=1 with X-Atlas-Admin. Lists the durable usage
// records (also failed and partial builds) with tokens and dollars, newest first, plus totals, so builds can be billed and audited.
export async function GET(request: Request) {
  if (!adminAuthorized(request)) return NextResponse.json({ error: 'Not authorised.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  if (!hasSharedAtlasStore()) return NextResponse.json({ error: 'No shared store configured.' }, { status: 503 });
  const url = new URL(request.url);
  const date = url.searchParams.get('date')?.trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD.' }, { status: 400 });
  const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit') ?? 200) || 200));
  const detail = url.searchParams.get('detail') === '1';
  const blobs = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `${galleryRoot()}/_usage/${date ? `${date}/` : ''}`, limit: 1000, cursor });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && blobs.length < 5000);
  blobs.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  const chosen = blobs.slice(0, limit);
  const records: Array<Omit<UsageRecord, 'calls'> & { calls?: UsageRecord['calls'] }> = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, chosen.length) }, async () => {
    while (next < chosen.length) {
      const blob = chosen[next];
      next += 1;
      try {
        const record = await (await fetch(blob.url, { cache: 'no-store' })).json() as UsageRecord;
        const { calls, ...rest } = record;
        records.push(detail ? { ...rest, calls } : rest);
      } catch {
        // an unreadable record is skipped; it stays in the store for inspection
      }
    }
  }));
  records.sort((a, b) => b.endedAt.localeCompare(a.endedAt));
  const sum = (pick: (record: (typeof records)[number]) => number) => records.reduce((total, record) => total + pick(record), 0);
  const totals = {
    builds: records.length,
    failedOrPartial: records.filter((record) => !['complete'].includes(record.outcome)).length,
    usd: records.every((record) => record.usd !== null) ? Math.round(sum((r) => r.usd ?? 0) * 1e6) / 1e6 : null,
    inputTokens: sum((r) => r.totals.inputTokens), cachedInputTokens: sum((r) => r.totals.cachedInputTokens), outputTokens: sum((r) => r.totals.outputTokens),
    images: sum((r) => r.totals.images), webSearchCalls: sum((r) => r.totals.webSearchCalls),
  };
  return NextResponse.json({ totals, records }, { headers: { 'Cache-Control': 'no-store' } });
}
