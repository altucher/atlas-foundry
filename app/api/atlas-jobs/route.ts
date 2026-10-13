import { createHash } from 'node:crypto';

import { after, NextResponse } from 'next/server';

import { cacheKeyForPrompt, hasSharedAtlasStore, loadGalleryAtlas } from '@/app/atlas-store';
import { countActiveJobs, isActive, jobsAuthorized, pseudonym, readJob, usageOfBuilds, writeJob, type JobRecord } from '@/app/atlas-jobs';
import { isBlockedKey, refusedSubject } from '@/app/blocked-atlases';
import { callPipeline, loraAsyncOn, runJobTail, warmLoraEndpoint } from '@/app/jobs-pipeline';

export const runtime = 'nodejs';
export const maxDuration = 800;

// POST /api/atlas-jobs {subject, caller?} with x-atlas-jobs-key. Answers:
//   200 {state:'done', id, atlasKey, cached:true}     already in the gallery (draft or complete, current version)
//   202 {state, id, billable:true}                     a build started: THIS caller pays the usage that GET reports
//   202 {state, id, joined:true, billable:false}       an identical build is already running; the joiner pays nothing (the starter pays)
//   422 {state:'refused'}                              weapon-like subject
//   429 {state:'busy', retryAfterSec}                  ATLAS_JOBS_MAX_CONCURRENT builds already running (default 3)
// The caller is the jtao server; pass `caller` (an opaque per-user id) so the anti-bot burst limit applies per end user, not to the server.
export async function POST(request: Request) {
  if (!process.env.ATLAS_JOBS_KEY) return NextResponse.json({ error: 'Jobs are not enabled on this deployment.' }, { status: 503 });
  if (!jobsAuthorized(request)) return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  if (!hasSharedAtlasStore()) return NextResponse.json({ error: 'No shared store configured.' }, { status: 503 });
  const body = await request.json().catch(() => ({})) as { subject?: unknown; caller?: unknown; session?: unknown };
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  if (subject.length < 2 || subject.length > 160) return NextResponse.json({ error: 'subject must be 2 to 160 characters.' }, { status: 400 });
  const id = cacheKeyForPrompt(subject);
  if (refusedSubject(subject) || refusedSubject(id.replace(/-/g, ' ')) || isBlockedKey(id)) {
    return NextResponse.json({ state: 'refused', id, error: 'This subject is not available for explode builds.' }, { status: 422 });
  }
  const existingAtlas = await loadGalleryAtlas(id);
  // any saved atlas counts, also one from an older research version: it opens fine, and rebuilding it would charge the user for something that already exists
  if (existingAtlas) {
    return NextResponse.json({ state: 'done', id, atlasKey: id, cached: true, billable: false, stage: existingAtlas.buildStage ?? 'complete' });
  }
  const existing = await readJob(id);
  if (existing && isActive(existing)) return NextResponse.json({ ...existing, joined: true, billable: false }, { status: 202 });
  const maxConcurrent = Math.max(1, Number(process.env.ATLAS_JOBS_MAX_CONCURRENT ?? 3) || 3);
  if (await countActiveJobs() >= maxConcurrent) {
    return NextResponse.json({ state: 'busy', id, retryAfterSec: 30, error: 'Too many builds are running. Try again shortly.' }, { status: 429, headers: { 'Retry-After': '30' } });
  }
  const caller = typeof body.caller === 'string' && body.caller ? body.caller.slice(0, 120) : 'jtao';
  const session = typeof body.session === 'string' && body.session ? body.session.slice(0, 120) : undefined;
  const now = new Date().toISOString();
  // the stored record (public blob) carries pseudonyms only, never the raw user id
  const callerPseudonym = pseudonym(caller);
  const sessionPseudonym = session ? pseudonym(session) : undefined;
  const job: JobRecord = { id, subject, state: 'queued', stage: 'cache', message: 'Starting', startedAt: now, updatedAt: now, caller: callerPseudonym, session: sessionPseudonym, buildIds: [] };
  await writeJob(job);
  const origin = new URL(request.url).origin;
  const callerAddress = `jobs-${createHash('sha256').update(caller).digest('hex').slice(0, 16)}`;
  after(() => runJob(job, origin, callerAddress, `${callerPseudonym}${sessionPseudonym ? `:${sessionPseudonym}` : ''}`.slice(0, 60)));
  return NextResponse.json({ ...job, billable: true }, { status: 202 });
}

async function runJob(job: JobRecord, origin: string, callerAddress: string, who: string) {
  warmLoraEndpoint();
  let lastWrite = 0;
  const update = async (patch: Partial<JobRecord>, force = false) => {
    Object.assign(job, patch);
    if (!force && Date.now() - lastWrite < 4000) return;
    lastWrite = Date.now();
    try { await writeJob(job); } catch (error) { console.warn('atlas job write failed', error); }
  };
  // short user-facing stage lines (jtao shows `message` as is): the pipeline's own progress text is long and technical, so it is replaced by one line per stage
  const STAGE_LINES: Record<string, string> = {
    cache: 'Checking the gallery',
    research: 'Researching the parts',
    recovery: 'Researching the parts',
    inventory: 'Mapping the parts',
    vendor: 'Finding the suppliers',
    render: 'Drawing the exploded view',
    mapping: 'Placing the part labels',
    save: 'Saving the atlas',
  };
  const progress = (stage: string) => { const line = STAGE_LINES[stage]; if (line) void update({ stage, message: line }); };
  // total time cap (Master 10-13): the job ships what it has well before the 800 s function limit instead of dying with nothing; work still running behind the cap is not billed
  const capMs = Number(process.env.ATLAS_JOBS_TOTAL_CAP_MS) || 720_000;
  const capAt = Date.parse(job.startedAt) + capMs;
  const TIMED_OUT = Symbol('timed out');
  const within = <T,>(work: Promise<T>): Promise<T | typeof TIMED_OUT> => Promise.race([work, new Promise<typeof TIMED_OUT>((resolve) => setTimeout(() => resolve(TIMED_OUT), Math.max(1000, capAt - Date.now())))]);
  try {
    await update({ state: 'drafting', stage: 'research', message: 'Researching the parts' }, true);
    const draftRun = await within(callPipeline(origin, callerAddress, job.subject, 'draft', who, progress));
    if (draftRun === TIMED_OUT) {
      await update({ state: 'failed', error: 'The build ran out of time before an atlas was ready. Nothing was delivered.', finishedAt: new Date().toISOString() }, true);
      return;
    }
    const draft = draftRun;
    if (draft.buildId) job.buildIds = [...(job.buildIds ?? []), draft.buildId];
    if (draft.status !== 200 || !draft.payload.atlas) {
      const usage = await usageOfBuilds(job.buildIds ?? []);
      await update({ usage, state: 'failed', error: String(draft.payload.error ?? `The build failed (${draft.status}).`).slice(0, 300), finishedAt: new Date().toISOString() }, true);
      return;
    }
    await update({ state: 'draft_ready', atlasKey: job.id, stage: 'draft', message: 'Ready to open; finding the suppliers', warning: typeof draft.payload.imageWarning === 'string' ? draft.payload.imageWarning.slice(0, 300) : undefined }, true);
    const tailAsync = loraAsyncOn() || process.env.ATLAS_JOBS_TAIL === '1';
    const hasExploded0 = Boolean((draft.payload.atlas as { explodedImage?: unknown }).explodedImage);
    const enrichmentPending = Boolean(draft.payload.enrichmentPending);
    if (!tailAsync) {
      await runJobTail(job, { origin, callerAddress, who, capAt, enrichmentPending, hasExploded: hasExploded0 });
      return;
    }
    // The suppliers pass and the exploded view run in their OWN function (own 800 s, not the 720 s left of this one): this function hands over and ends; the job stays 'enriching' until the tail finishes it
    job.tail = { state: 'queued', enrichmentPending, hasExploded: hasExploded0 };
    await update({ state: 'enriching', stage: enrichmentPending ? 'vendor' : 'render', message: enrichmentPending ? 'Finding the suppliers' : 'Drawing the exploded view' }, true);
    const handoff = await fetch(`${origin}/api/atlas-jobs/${encodeURIComponent(job.id)}/tail`, { method: 'POST', headers: { 'x-atlas-jobs-key': process.env.ATLAS_JOBS_KEY ?? '', 'content-type': 'application/json' }, body: JSON.stringify({ callerAddress, who }) }).catch((error) => { console.warn('job tail not started', error); return null; });
    if (!handoff || !handoff.ok) await runJobTail(job, { origin, callerAddress, who, capAt, enrichmentPending, hasExploded: hasExploded0 });
  } catch (error) {
    console.error('atlas job failed', error);
    const usage = await usageOfBuilds(job.buildIds ?? []).catch(() => undefined);
    await update({ usage, state: 'failed', error: error instanceof Error ? error.message.slice(0, 300) : 'The build failed.', finishedAt: new Date().toISOString() }, true);
  }
}
