import { after, NextResponse } from 'next/server';

import { isSafeCacheKey } from '@/app/atlas-store';
import { jobsAuthorized, readJob, writeJob, type JobRecord } from '@/app/atlas-jobs';
import { runJobTail } from '@/app/jobs-pipeline';

export const runtime = 'nodejs';
export const maxDuration = 800;

// POST /api/atlas-jobs/<id>/tail (jobs key, called by the job function after the draft): runs the suppliers pass and the exploded-view pass in THIS function, with its own time budget (740 s),
// then finishes the job. It claims the job (tail queued -> running), answers 202 at once and works in after().
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!process.env.ATLAS_JOBS_KEY) return NextResponse.json({ error: 'Jobs are not enabled on this deployment.' }, { status: 503 });
  if (!jobsAuthorized(request)) return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  const { id } = await context.params;
  if (!isSafeCacheKey(id)) return NextResponse.json({ error: 'Bad job id.' }, { status: 400 });
  // The caller (the job function, authenticated by the jobs key) sends the job record it just wrote: the blob store can serve an older copy for a moment, and trusting that copy stranded a job
  // (the tail saw it not yet 'enriching', answered 200 without running, the job function ended). The record in the body is authoritative; the stored one is only a fallback.
  const body = await request.json().catch(() => ({})) as { callerAddress?: unknown; who?: unknown; job?: JobRecord };
  const sent = body.job && typeof body.job === 'object' && body.job.id === id ? body.job : null;
  const job = sent ?? await readJob(id);
  if (!job) return NextResponse.json({ error: 'No such job.' }, { status: 404 });
  if (job.state !== 'enriching' || job.tail?.state !== 'queued') return NextResponse.json({ state: job.state, tail: job.tail?.state ?? 'none' }, { status: 200 });

  const callerAddress = typeof body.callerAddress === 'string' ? body.callerAddress.slice(0, 80) : 'jobs-tail';
  const who = typeof body.who === 'string' ? body.who.slice(0, 60) : '';
  const origin = new URL(request.url).origin;
  const tail = job.tail;
  await writeJob({ ...job, tail: { ...tail, state: 'running', startedAt: new Date().toISOString() } });
  const capMs = Number(process.env.ATLAS_JOBS_TAIL_CAP_MS) || 740_000;
  after(() => runJobTail({ ...job, tail: { ...tail, state: 'running' } }, { origin, callerAddress, who, capAt: Date.now() + capMs, enrichmentPending: tail.enrichmentPending, hasExploded: tail.hasExploded }));
  return NextResponse.json({ state: 'running' }, { status: 202 });
}
