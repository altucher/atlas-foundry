import { POST as generateAtlas } from '@/app/api/generate-atlas/route';
import { usageOfBuilds, writeJob, type JobRecord } from '@/app/atlas-jobs';

export type StreamResult = { status: number; payload: Record<string, unknown>; buildId?: string };

export async function callPipeline(origin: string, callerAddress: string, subject: string, phase: 'draft' | 'enrich' | 'reexplode', who: string, onProgress: (stage: string, message: string) => void): Promise<StreamResult> {
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

/** the LoRA exploded-view endpoint scales to zero and a cold worker takes minutes: ask it for a tiny throwaway image at job start so the worker is up by the time the draft is ready */
export function warmLoraEndpoint() {
  const endpoint = process.env.ATLAS_LORA_ENDPOINT?.trim();
  const apiKey = process.env.RUNPOD_API_KEY?.trim();
  if (process.env.ATLAS_EXPLODED_PROVIDER?.trim().toLowerCase() !== 'lora' || !endpoint || !apiKey) return;
  void fetch(`https://api.runpod.ai/v2/${encodeURIComponent(endpoint)}/run`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ input: { prompt: 'Axonometric exploded technical diagram of a small cube, white background, no text.', width: 512, height: 512, seed: 1 } }) }).catch(() => undefined);
}


/** the LoRA exploded view runs as its own follow-up function after the job is done (set ATLAS_LORA_ASYNC=0 to render it inside the job instead) */
export function loraAsyncOn() {
  return process.env.ATLAS_EXPLODED_PROVIDER?.trim().toLowerCase() === 'lora' && Boolean(process.env.ATLAS_LORA_ENDPOINT?.trim()) && Boolean(process.env.RUNPOD_API_KEY?.trim()) && process.env.ATLAS_LORA_ASYNC !== '0';
}

const STAGE_LINES: Record<string, string> = { cache: 'Checking the gallery', research: 'Researching the parts', recovery: 'Researching the parts', inventory: 'Mapping the parts', vendor: 'Finding the suppliers', render: 'Drawing the exploded view', mapping: 'Placing the part labels', save: 'Saving the atlas' };

/**
 * Everything after the draft: supplier research and the exploded-view pass run IN PARALLEL (the LoRA endpoint's cold start overlaps the supplier research), both merge into the freshest saved
 * copy, then the job is finished with its final usage. Runs inline in the job function (ATLAS_JOBS_TAIL unset, no LoRA) or in its own function (tail route) so that suppliers are not lost to the 720 s cap.
 */
export async function runJobTail(job: JobRecord, ctx: { origin: string; callerAddress: string; who: string; capAt: number; enrichmentPending: boolean; hasExploded: boolean }) {
  const { origin, callerAddress, who, capAt, enrichmentPending } = ctx;
  let hasExploded = ctx.hasExploded;
  let lastWrite = 0;
  const update = async (patch: Partial<JobRecord>, force = false) => {
    Object.assign(job, patch);
    if (!force && Date.now() - lastWrite < 4000) return;
    lastWrite = Date.now();
    try { await writeJob(job); } catch (error) { console.warn('atlas job write failed', error); }
  };
  const progress = (stage: string) => { const line = STAGE_LINES[stage]; if (line) void update({ stage, message: line }); };
  const TIMED_OUT = Symbol('timed out');
  const within = <T,>(work: Promise<T>): Promise<T | typeof TIMED_OUT> => Promise.race([work, new Promise<typeof TIMED_OUT>((resolve) => setTimeout(() => resolve(TIMED_OUT), Math.max(1000, capAt - Date.now())))]);
  try {
    const rounds = loraAsyncOn() ? Math.max(1, Number(process.env.ATLAS_JOBS_REEXPLODE_ROUNDS ?? 1) || 1) : Math.max(0, Number(process.env.ATLAS_JOBS_REEXPLODE_ROUNDS ?? 1) || 0);
    const runEnrich = async () => {
      if (!enrichmentPending) return;
      await update({ state: 'enriching', stage: 'vendor', message: 'Finding the suppliers' }, true);
      const enrichRun = capAt - Date.now() < 90_000 ? TIMED_OUT : await within(callPipeline(origin, callerAddress, job.subject, 'enrich', who, progress));
      if (enrichRun === TIMED_OUT) {
        job.warning = `${job.warning ? `${job.warning} ` : ''}Supplier research did not finish in time; the atlas is ready without it.`;
        return;
      }
      if (enrichRun.buildId) job.buildIds = [...(job.buildIds ?? []), enrichRun.buildId];
      if (enrichRun.status === 200 && enrichRun.payload.suppliersUnavailable === true) job.warning = `${job.warning ? `${job.warning} ` : ''}Suppliers unavailable: no supplier relationships could be established for this subject.`;
      if (enrichRun.status !== 200) job.warning = `${job.warning ? `${job.warning} ` : ''}Supplier research did not finish: ${String(enrichRun.payload.error ?? enrichRun.status).slice(0, 160)}`;
    };
    // quality first (founder 10-12): an atlas without an exploded view gets more rounds (each up to ATLAS_LORA_ATTEMPTS / 3 renders) before it is left assembled-only
    const runExploded = async () => {
      for (let round = 0; !hasExploded && round < rounds; round += 1) {
        if (capAt - Date.now() < 150_000) break;
        const againRun = await within(callPipeline(origin, callerAddress, job.subject, 'reexplode', who, progress));
        if (againRun === TIMED_OUT) break;
        if (againRun.buildId) job.buildIds = [...(job.buildIds ?? []), againRun.buildId];
        hasExploded = againRun.status === 200 && Boolean((againRun.payload.atlas as { explodedImage?: unknown } | undefined)?.explodedImage);
        if (hasExploded) job.warning = job.warning?.replace(/Exploded image:[^.]*\.?\s*/i, '').trim() || undefined;
      }
    };
    await Promise.all([runEnrich(), runExploded()]);
    const usage = await usageOfBuilds(job.buildIds ?? [], { explodedDelivered: hasExploded });
    if (job.tail) job.tail = { ...job.tail, state: 'done' };
    await update({ state: 'done', stage: 'done', message: 'Done', usage, finishedAt: new Date().toISOString() }, true);
  } catch (error) {
    console.error('atlas job tail failed', error);
    const usage = await usageOfBuilds(job.buildIds ?? [], { explodedDelivered: hasExploded }).catch(() => undefined);
    await update({ usage, state: 'done', stage: 'done', message: 'Done', warning: `${job.warning ? `${job.warning} ` : ''}The suppliers pass ended early.`, finishedAt: new Date().toISOString() }, true);
  }
}
