import { head, put } from '@vercel/blob';

import { galleryRoot, hasSharedAtlasStore } from '@/app/atlas-store';

// IMAGE BACKEND RESILIENCE (Master 10-13): when Chutes answers 429/500 (at capacity) the assembled image falls back to OUR RunPod base endpoint (Qwen-Image-2512 + Lightning, mode 'base'),
// and the FIRST capacity error also asks that endpoint to keep one worker warm for 60 minutes (workersMin 1) so later builds land on a warm GPU; the cron route /api/cron/warm-cooldown
// puts it back to workersMin 0 (and the original workersMax). Every switch is logged to a small blob so the cost can be read. Needs RUNPOD_API_KEY + ATLAS_BASE_ENDPOINT + ATLAS_BASE_WARM=1.

/** the RunPod image endpoint: the always-warm live endpoint (ATLAS_LIVE_ENDPOINT) or the shared base endpoint (ATLAS_BASE_ENDPOINT) */
export const imageEndpoint = () => (process.env.ATLAS_LIVE_ENDPOINT?.trim() || process.env.ATLAS_BASE_ENDPOINT?.trim() || '');

export function fallbackConfigured() {
  return process.env.ATLAS_BASE_WARM === '1' && Boolean(process.env.RUNPOD_API_KEY?.trim()) && Boolean(process.env.ATLAS_BASE_ENDPOINT?.trim());
}

/** founder 10-13: live user images come from OUR Qwen-Image-2512 first (ATLAS_IMAGE_PRIMARY=runpod), Chutes only as the fallback */
export function primaryRunpodOn() {
  return process.env.ATLAS_IMAGE_PRIMARY?.trim().toLowerCase() === 'runpod' && Boolean(process.env.RUNPOD_API_KEY?.trim()) && Boolean(imageEndpoint());
}

type Workers = { idle: number; ready: number; running: number; initializing: number; inProgress: number; inQueue: number };
const healthCache = new Map<string, { at: number; workers: Workers | null }>();

/** worker counts of a RunPod endpoint (cached 5 s, 3 s timeout); null = unknown, and an unknown state never blocks a call */
export async function endpointWorkers(endpoint: string, apiKey: string): Promise<Workers | null> {
  const hit = healthCache.get(endpoint);
  if (hit && Date.now() - hit.at < 5000) return hit.workers;
  let workers: Workers | null = null;
  try {
    const response = await fetch(`https://api.runpod.ai/v2/${endpoint}/health`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const body = await response.json() as { workers?: Partial<Workers>; jobs?: { inProgress?: number; inQueue?: number } };
      const w = body.workers ?? {};
      workers = { idle: w.idle ?? 0, ready: w.ready ?? 0, running: w.running ?? 0, initializing: w.initializing ?? 0, inProgress: body.jobs?.inProgress ?? 0, inQueue: body.jobs?.inQueue ?? 0 };
    }
  } catch { workers = null; }
  healthCache.set(endpoint, { at: Date.now(), workers });
  return workers;
}

/** Master 10-13: a person is waiting for the assembled image, so our endpoint is used only when a worker is free right now (idle or ready); otherwise straight to Chutes instead of queueing up to 150 s. ATLAS_LIVE_HEALTH_CHECK=0 turns the check off. */
export async function liveHasFreeWorker() {
  if (process.env.ATLAS_LIVE_HEALTH_CHECK === '0') return true;
  const workers = await endpointWorkers(imageEndpoint(), process.env.RUNPOD_API_KEY?.trim() ?? '');
  if (workers === null) return true;
  // a queue that is not draining (3+ queued, nothing in progress) means the endpoint is stuck: Chutes at once
  if (workers.inQueue >= 3 && workers.inProgress === 0) return false;
  // a warm worker that just finished a job reports 'running', not 'idle' (engines 10-13): free when idle/ready, or when more workers are 'running' than jobs are in progress
  return workers.idle + workers.ready > 0 || workers.running > workers.inProgress;
}

/** the exploded view is not a user wait (75 s LoRA cap): skip the LoRA when the endpoint has no worker at all or none even starting its first job */
export async function loraEndpointUsable(endpoint: string, apiKey: string) {
  if (process.env.ATLAS_LIVE_HEALTH_CHECK === '0') return true;
  const workers = await endpointWorkers(endpoint, apiKey);
  if (workers === null) return true;
  if (workers.inQueue >= 3 && workers.inProgress === 0) return false;
  return workers.idle + workers.ready + workers.running > 0;
}

export function isCapacityError(error: unknown) {
  return /HTTP (429|500|502|503)|at maximum capacity|No infrastructure available/i.test(String(error instanceof Error ? error.message : error));
}

const WARM_MS = 60 * 60 * 1000;
const stateUrl = () => `${galleryRoot()}/_ops/warm-state.json`;
const logUrl = () => `${galleryRoot()}/_ops/warm-log.json`;

type WarmState = { until: string; originalMax: number; startedAt: string; reason: string };

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const blob = await head(path);
    const response = await fetch(`${blob.url}?t=${Date.now()}`, { cache: 'no-store' });
    return response.ok ? await response.json() as T : null;
  } catch { return null; }
}
async function writeJson(path: string, value: unknown) {
  await put(path, JSON.stringify(value), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 30 });
}
async function logSwitch(entry: Record<string, unknown>) {
  console.warn('runpod base endpoint switch', JSON.stringify(entry));
  if (!hasSharedAtlasStore()) return;
  const log = (await readJson<Array<Record<string, unknown>>>(logUrl())) ?? [];
  await writeJson(logUrl(), [...log, { at: new Date().toISOString(), ...entry }].slice(-200)).catch(() => undefined);
}

async function runpodRest(method: 'GET' | 'PATCH', body?: Record<string, unknown>) {
  const response = await fetch(`https://rest.runpod.io/v1/endpoints/${encodeURIComponent(process.env.ATLAS_BASE_ENDPOINT?.trim() ?? '')}`, {
    method, headers: { Authorization: `Bearer ${process.env.RUNPOD_API_KEY?.trim() ?? ''}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`RunPod endpoint call failed (${response.status}).`);
  return await response.json() as { workersMin?: number; workersMax?: number };
}

/** first capacity error: keep one worker warm for 60 min (idempotent while a warm window is open) */
export async function escalateWarm(reason: string) {
  if (!fallbackConfigured() || !hasSharedAtlasStore()) return;
  try {
    const state = await readJson<WarmState>(stateUrl());
    if (state && Date.parse(state.until) > Date.now()) return;
    const current = await runpodRest('GET');
    const originalMax = Math.max(0, Number(state?.originalMax ?? current.workersMax ?? 0));
    await runpodRest('PATCH', { workersMin: 1, workersMax: Math.max(2, originalMax) });
    await writeJson(stateUrl(), { until: new Date(Date.now() + WARM_MS).toISOString(), originalMax, startedAt: new Date().toISOString(), reason } satisfies WarmState);
    await logSwitch({ action: 'warm-on', workersMin: 1, untilMinutes: 60, originalMax, reason });
  } catch (error) { console.warn('warm escalation failed', error); }
}

/** cron: when the warm window has ended, back to workersMin 0 and the original workersMax */
export async function coolDownIfDue() {
  if (!fallbackConfigured() || !hasSharedAtlasStore()) return { acted: false, reason: 'not configured' };
  const state = await readJson<WarmState>(stateUrl());
  if (!state || state.until === 'done' || Date.parse(state.until) > Date.now()) return { acted: false, reason: state ? 'window still open' : 'no warm state' };
  await runpodRest('PATCH', { workersMin: 0, workersMax: state.originalMax });
  await writeJson(stateUrl(), { ...state, until: 'done' });
  await logSwitch({ action: 'warm-off', workersMin: 0, workersMax: state.originalMax, warmedForMinutes: Math.round((Date.now() - Date.parse(state.startedAt)) / 60000) });
  return { acted: true };
}

/** one image from the RunPod base endpoint (async run + status poll); gives up after timeoutMs and cancels the job */
export async function runpodBaseImage(prompt: string, width: number, height: number, timeoutMs: number) {
  const endpoint = encodeURIComponent(imageEndpoint());
  const headers = { Authorization: `Bearer ${process.env.RUNPOD_API_KEY?.trim() ?? ''}`, 'Content-Type': 'application/json' };
  const t0 = Date.now();
  const submit = await fetch(`https://api.runpod.ai/v2/${endpoint}/run`, { method: 'POST', headers, body: JSON.stringify({ input: { prompt, width, height, mode: 'base' } }) });
  if (!submit.ok) throw new Error(`RunPod base submit failed (${submit.status}).`);
  const job = await submit.json() as { id?: string };
  if (!job.id) throw new Error('RunPod base submit returned no job id.');
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (Date.now() - t0 > timeoutMs) {
      await fetch(`https://api.runpod.ai/v2/${endpoint}/cancel/${job.id}`, { method: 'POST', headers }).catch(() => undefined);
      throw new Error('RunPod base image timed out.');
    }
    const poll = await fetch(`https://api.runpod.ai/v2/${endpoint}/status/${job.id}`, { headers });
    if (!poll.ok) continue;
    const status = await poll.json() as { status?: string; executionTime?: number; output?: { image_b64?: string } };
    if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(status.status ?? '')) throw new Error(`RunPod base job ${status.status}.`);
    if (status.status === 'COMPLETED' && status.output?.image_b64) {
      const perSecond = Number(process.env.ATLAS_BASE_USD_PER_SEC) || 0.00076;
      return { dataUrl: `data:image/png;base64,${status.output.image_b64}`, ms: Date.now() - t0, usd: typeof status.executionTime === 'number' ? Math.round(status.executionTime / 1000 * perSecond * 1e6) / 1e6 : null };
    }
  }
}
