import { after, NextResponse } from 'next/server';

import { isSafeCacheKey } from '@/app/atlas-store';
import { jobsAuthorized, readJob, writeJob, type JobRecord } from '@/app/atlas-jobs';
import { callPipeline } from '@/app/jobs-pipeline';

export const runtime = 'nodejs';
export const maxDuration = 800;

// POST /api/atlas-jobs/<id>/exploded (jobs key): the follow-up that draws the exploded view of a finished LoRA build in its own function, so a cold GPU (minutes) never holds the job.
// It claims the job (queued -> rendering), answers 202 at once and works in after(); the result is the atlas record gaining its exploded view, plus job.exploded.state done|failed.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!process.env.ATLAS_JOBS_KEY) return NextResponse.json({ error: 'Jobs are not enabled on this deployment.' }, { status: 503 });
  if (!jobsAuthorized(request)) return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  const { id } = await context.params;
  if (!isSafeCacheKey(id)) return NextResponse.json({ error: 'Bad job id.' }, { status: 400 });
  const job = await readJob(id);
  if (!job) return NextResponse.json({ error: 'No such job.' }, { status: 404 });
  if (job.exploded?.state !== 'queued') return NextResponse.json({ state: job.exploded?.state ?? 'none' }, { status: 200 });
  const body = await request.json().catch(() => ({})) as { callerAddress?: unknown; who?: unknown };
  const callerAddress = typeof body.callerAddress === 'string' ? body.callerAddress.slice(0, 80) : 'jobs-exploded';
  const who = typeof body.who === 'string' ? body.who.slice(0, 60) : '';
  const origin = new URL(request.url).origin;
  const startedAt = new Date().toISOString();
  await writeJob({ ...job, exploded: { state: 'rendering', startedAt, message: 'Drawing the exploded view' } });
  after(() => renderExploded(job, origin, callerAddress, who, startedAt));
  return NextResponse.json({ state: 'rendering' }, { status: 202 });
}

async function renderExploded(job: JobRecord, origin: string, callerAddress: string, who: string, startedAt: string) {
  const deadline = Date.now() + 740_000;
  let delivered = false;
  let message = 'The exploded view could not be drawn; the atlas stays with its assembled view.';
  try {
    for (let round = 0; !delivered && round < 2 && deadline - Date.now() > 120_000; round += 1) {
      const run = await callPipeline(origin, callerAddress, job.subject, 'reexplode', who, () => undefined);
      delivered = run.status === 200 && Boolean((run.payload.atlas as { explodedImage?: unknown } | undefined)?.explodedImage);
      if (!delivered && run.payload.error) message = String(run.payload.error).slice(0, 160);
    }
  } catch (error) {
    console.warn('exploded follow-up failed', error);
  }
  const latest = await readJob(job.id).catch(() => null);
  await writeJob({ ...(latest ?? job), exploded: { state: delivered ? 'done' : 'failed', startedAt, finishedAt: new Date().toISOString(), message: delivered ? 'Exploded view added' : message } }).catch((error) => console.warn('exploded job write failed', error));
}
