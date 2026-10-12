import { NextResponse } from 'next/server';

import { isSafeCacheKey } from '@/app/atlas-store';
import { isActive, jobsAuthorized, readJob, writeJob } from '@/app/atlas-jobs';

export const runtime = 'nodejs';

// GET /api/atlas-jobs/<id> with x-atlas-jobs-key: the job record (state queued|drafting|draft_ready|enriching|done|failed, stage, message, atlasKey once a draft exists, usage when done).
// A job whose record has gone quiet for 25 minutes is reported as failed (its function was cut off); the atlas draft, if one was saved, stays usable.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!process.env.ATLAS_JOBS_KEY) return NextResponse.json({ error: 'Jobs are not enabled on this deployment.' }, { status: 503 });
  if (!jobsAuthorized(request)) return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  const { id } = await context.params;
  if (!isSafeCacheKey(id)) return NextResponse.json({ error: 'Bad id.' }, { status: 400 });
  const job = await readJob(id);
  if (!job) return NextResponse.json({ error: 'No such job.' }, { status: 404 });
  if (['queued', 'drafting', 'draft_ready', 'enriching'].includes(job.state) && !isActive(job)) {
    const dead = { ...job, state: 'failed' as const, error: job.error ?? 'The build stopped responding.', finishedAt: new Date().toISOString() };
    await writeJob(dead).catch(() => undefined);
    return NextResponse.json(dead, { headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json(job, { headers: { 'Cache-Control': 'no-store' } });
}
