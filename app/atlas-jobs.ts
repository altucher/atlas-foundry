// ON-DEMAND BUILD JOBS (AI2 2026-10-12, Master: "give jtao a clean on-demand endpoint"). POST /api/atlas-jobs starts (or joins) the build of one subject; GET /api/atlas-jobs/<id> reports
// progress; the job id IS the atlas cache key, so two callers asking for "pancake" share ONE build. The build itself is the normal /api/generate-atlas pipeline (draft, then enrich),
// called in-process, so TAO-1 text, Chutes images and (when set) the OpenRouter exploded view, the ledger and the saved atlas all work exactly as for a browser visitor.
// State lives in the shared blob store at <gallery>/_jobs/<key>.json. Auth: header x-atlas-jobs-key must equal ATLAS_JOBS_KEY (the caller is jtao's server, not a browser).
import { createHash, timingSafeEqual } from 'node:crypto';

import { head, list, put } from '@vercel/blob';

import { galleryRoot, hasSharedAtlasStore } from '@/app/atlas-store';

export type UsageLine = { stage: string; model: string; provider: string; calls: number; inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number; webSearchCalls: number; images: number; usd: number | null };
export type JobUsage = {
  /** sums over all builds of the job; usd is null when any line is unpriced (then see unpriced[]; the wallet can price the tokens itself) */
  totals: { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number; webSearchCalls: number; images: number; usd: number | null; prompt_tokens: number; cached_tokens: number; completion_tokens: number; imageUsd: number };
  unpriced: string[];
  builds: Array<{ buildId: string; phase: string; outcome: string; who: { kind: string; id: string }; usd: number | null; unpriced: string[]; ms: number; lines: UsageLine[] }>;
};

export type JobState = 'queued' | 'drafting' | 'draft_ready' | 'enriching' | 'done' | 'failed';
export type JobRecord = {
  id: string;
  subject: string;
  state: JobState;
  stage?: string;
  message?: string;
  /** set as soon as a draft exists: the atlas can be opened with ?atlas=<atlasKey> */
  atlasKey?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  caller?: string;
  error?: string;
  warning?: string;
  /** the opaque end-user/session the wallet charges (from the POST body); only the caller that STARTED the build is billable, joiners pay nothing */
  session?: string;
  /** billing: exact usage of every pipeline call this job made (draft and enrich), also when the job failed; see usageOfBuilds() */
  usage?: JobUsage;
  buildIds?: string[];
};

const ACTIVE: JobState[] = ['queued', 'drafting', 'draft_ready', 'enriching'];
/** a job whose record has not been touched for this long is treated as dead (its function was cut off) */
export const STALE_MS = 25 * 60 * 1000;

export function jobsAuthorized(request: Request) {
  const secret = process.env.ATLAS_JOBS_KEY?.trim();
  if (!secret || secret.length < 16) return false;
  const given = request.headers.get('x-atlas-jobs-key') ?? '';
  return timingSafeEqual(createHash('sha256').update(secret).digest(), createHash('sha256').update(given).digest());
}

export function isActive(job: JobRecord, now = Date.now()) {
  return ACTIVE.includes(job.state) && now - Date.parse(job.updatedAt) < STALE_MS;
}

function jobPath(id: string) {
  return `${galleryRoot()}/_jobs/${id}.json`;
}

export async function readJob(id: string): Promise<JobRecord | null> {
  if (!hasSharedAtlasStore()) return null;
  try {
    const blob = await head(jobPath(id));
    const response = await fetch(`${blob.url}?t=${Date.now()}`, { cache: 'no-store' });
    return response.ok ? await response.json() as JobRecord : null;
  } catch {
    return null;
  }
}

export async function writeJob(job: JobRecord) {
  await put(jobPath(job.id), JSON.stringify({ ...job, updatedAt: new Date().toISOString() }), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 });
}

export async function countActiveJobs() {
  const blobs: Array<{ url: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `${galleryRoot()}/_jobs/`, limit: 1000, cursor });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const jobs = await Promise.all(blobs.map(async (blob) => {
    try { const r = await fetch(`${blob.url}?t=${Date.now()}`, { cache: 'no-store' }); return r.ok ? await r.json() as JobRecord : null; } catch { return null; }
  }));
  return jobs.filter((job): job is JobRecord => Boolean(job) && isActive(job as JobRecord)).length;
}

export { refusedSubject } from '@/app/blocked-atlases';

/** reads the durable usage record of each pipeline call (written by finishLedger before the call returns; today's or yesterday's date folder) and sums them */
export async function usageOfBuilds(buildIds: string[]): Promise<JobUsage> {
  const builds: JobUsage['builds'] = [];
  for (const buildId of buildIds) {
    for (const day of [0, 1]) {
      const date = new Date(Date.now() - day * 86_400_000).toISOString().slice(0, 10);
      try {
        const blob = await head(`${galleryRoot()}/_usage/${date}/${buildId}.json`);
        const record = await (await fetch(`${blob.url}?t=${Date.now()}`, { cache: 'no-store' })).json() as { phase: string; outcome: string; who: { kind: string; id: string }; usd: number | null; unpriced?: string[]; ms: number; lines: UsageLine[] };
        builds.push({ buildId, phase: record.phase, outcome: record.outcome, who: record.who, usd: record.usd, unpriced: record.unpriced ?? [], ms: record.ms, lines: record.lines });
        break;
      } catch { /* try the other date folder; a call that spent nothing writes no record */ }
    }
  }
  const lines = builds.flatMap((b) => b.lines);
  const sum = (pick: (l: UsageLine) => number) => lines.reduce((t, l) => t + pick(l), 0);
  const unpriced = [...new Set([...lines.filter((l) => l.usd === null).map((l) => l.model), ...builds.flatMap((b) => b.unpriced)])];
  return {
    totals: { inputTokens: sum((l) => l.inputTokens), cachedInputTokens: sum((l) => l.cachedInputTokens), outputTokens: sum((l) => l.outputTokens), reasoningTokens: sum((l) => l.reasoningTokens), webSearchCalls: sum((l) => l.webSearchCalls), images: sum((l) => l.images),
      usd: unpriced.length ? null : Math.round(sum((l) => l.usd ?? 0) * 1e6) / 1e6,
      // per-token billing aliases (additive): completion includes reasoning; cached is a subset of prompt; imageUsd = lines billed per image (no tokens)
      prompt_tokens: sum((l) => l.inputTokens), cached_tokens: sum((l) => l.cachedInputTokens), completion_tokens: sum((l) => l.outputTokens + l.reasoningTokens),
      imageUsd: Math.round(sum((l) => (l.images > 0 ? l.usd ?? 0 : 0)) * 1e6) / 1e6 },
    unpriced,
    builds,
  };
}
