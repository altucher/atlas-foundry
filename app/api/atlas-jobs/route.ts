import { createHash } from 'node:crypto';

import { after, NextResponse } from 'next/server';

import { POST as generateAtlas } from '@/app/api/generate-atlas/route';
import { cacheKeyForPrompt, hasSharedAtlasStore, loadGalleryAtlas } from '@/app/atlas-store';
import { countActiveJobs, isActive, jobsAuthorized, pseudonym, readJob, usageOfBuilds, writeJob, type JobRecord } from '@/app/atlas-jobs';
import { isBlockedKey, refusedSubject } from '@/app/blocked-atlases';

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

type StreamResult = { status: number; payload: Record<string, unknown>; buildId?: string };

async function callPipeline(origin: string, callerAddress: string, subject: string, phase: 'draft' | 'enrich' | 'reexplode', who: string, onProgress: (stage: string, message: string) => void): Promise<StreamResult> {
  const response = await generateAtlas(new Request(`${origin}/api/generate-atlas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson', 'x-real-ip': callerAddress, 'x-atlas-jobs-key': process.env.ATLAS_JOBS_KEY ?? '', 'x-atlas-who': who },
    body: JSON.stringify({ prompt: subject, phase }),
  }));
  if (!response.body) return { status: response.status, payload: await response.json().catch(() => ({})) as Record<string, unknown> };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: StreamResult | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line) continue;
      try {
        const entry = JSON.parse(line) as { type?: string; stage?: string; message?: string; status?: number; payload?: Record<string, unknown>; buildId?: string };
        if (entry.type === 'progress' && entry.stage && entry.stage !== 'source') onProgress(entry.stage, entry.message ?? '');
        if (entry.type === 'result') result = { status: entry.status ?? 500, payload: entry.payload ?? {}, buildId: entry.buildId };
      } catch { /* ignore a partial line */ }
    }
  }
  return result ?? { status: 502, payload: { error: 'The build ended without a result.' } };
}

async function runJob(job: JobRecord, origin: string, callerAddress: string, who: string) {
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
    if (draft.payload.enrichmentPending) {
      await update({ state: 'enriching', stage: 'vendor', message: 'Finding the suppliers' }, true);
      const enrichRun = capAt - Date.now() < 90_000 ? TIMED_OUT : await within(callPipeline(origin, callerAddress, job.subject, 'enrich', who, progress));
      if (enrichRun === TIMED_OUT) {
        job.warning = `${job.warning ? `${job.warning} ` : ''}Supplier research did not finish in time; the atlas is ready without it.`;
      } else {
      const enrich = enrichRun;
      if (enrich.buildId) job.buildIds = [...(job.buildIds ?? []), enrich.buildId];
      if (enrich.status !== 200) job.warning = `${job.warning ? `${job.warning} ` : ''}Supplier research did not finish: ${String(enrich.payload.error ?? enrich.status).slice(0, 160)}`;
      }
    }
    // quality first (founder 10-12): an atlas whose exploded view failed the visual QA gets more rounds (each up to 3 renders) before it is left assembled-only
    const rounds = Math.max(0, Number(process.env.ATLAS_JOBS_REEXPLODE_ROUNDS ?? 1) || 0);
    let hasExploded = Boolean((draft.payload.atlas as { explodedImage?: unknown }).explodedImage);
    for (let round = 0; !hasExploded && round < rounds; round += 1) {
      await update({ stage: 'render', message: 'Drawing the exploded view' }, true);
      if (capAt - Date.now() < 150_000) break;
      const againRun = await within(callPipeline(origin, callerAddress, job.subject, 'reexplode', who, progress));
      if (againRun === TIMED_OUT) break;
      const again = againRun;
      if (again.buildId) job.buildIds = [...(job.buildIds ?? []), again.buildId];
      hasExploded = again.status === 200 && Boolean((again.payload.atlas as { explodedImage?: unknown } | undefined)?.explodedImage);
      if (hasExploded) job.warning = undefined;
    }
    const usage = await usageOfBuilds(job.buildIds ?? [], { explodedDelivered: hasExploded });
    await update({ state: 'done', stage: 'done', message: 'Done', usage, finishedAt: new Date().toISOString() }, true);
  } catch (error) {
    console.error('atlas job failed', error);
    const usage = await usageOfBuilds(job.buildIds ?? []).catch(() => undefined);
    await update({ usage, state: 'failed', error: error instanceof Error ? error.message.slice(0, 300) : 'The build failed.', finishedAt: new Date().toISOString() }, true);
  }
}
