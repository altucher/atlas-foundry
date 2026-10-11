// BUILD USAGE LEDGER (AI2 2026-10-11): every paid call a build makes (research, supplier batches, image generation, image QA, hotspot mapping, TAO-1 text calls)
// is recorded per call with model, provider, tokens (input, cached, output, reasoning), web-search calls, images (size, quality) and the dollars at the price table.
// A request's ledger is kept through AsyncLocalStorage, then (1) logged as one JSON line ("atlas_cost"), (2) embedded in the saved atlas as buildCost (per phase),
// and (3) saved as a durable usage record at <gallery root>/_usage/<date>/<buildId>.json, also for failed and partial builds, so builds can be billed and audited
// (read them with the admin endpoint /api/admin/builds). Dollars need prices: ATLAS_PRICE_TABLE JSON {"model":{"in","cachedIn","out" per 1M tokens,"search" per 1000
// calls,"image" per image}}; models without a price add no dollars and are listed under unpriced. Prices are not guessed here.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import { put } from '@vercel/blob';

import { galleryRoot, hasSharedAtlasStore } from '@/app/atlas-store';

export type CostCall = {
  i: number;
  stage: string;
  model: string;
  provider: 'openai' | 'tao1' | 'other';
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  webSearchCalls: number;
  images: number;
  imageSize?: string;
  imageQuality?: string;
  usd: number | null;
  ok: boolean;
  ms?: number;
};

export type CostLine = {
  stage: string;
  model: string;
  provider: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  webSearchCalls: number;
  images: number;
  usd: number | null;
};

export type BuildCost = {
  phases: Record<string, { at: string; buildId?: string; lines: CostLine[]; usd: number | null; unpriced: string[] }>;
  totalUsd: number | null;
};

export type BuildWho = { kind: 'anonymous' | 'tao1' | 'internal-test'; id: string };

export type UsageRecord = {
  buildId: string;
  key: string;
  phase: string;
  outcome: string;
  who: BuildWho;
  startedAt: string;
  endedAt: string;
  ms: number;
  usd: number | null;
  unpriced: string[];
  totals: { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number; webSearchCalls: number; images: number; calls: number };
  lines: CostLine[];
  calls: CostCall[];
};

type Ledger = { buildId: string; phase: string; key: string; who: BuildWho; calls: CostCall[]; startedAt: number };

const storage = new AsyncLocalStorage<Ledger>();

export function runWithLedger<T>(phase: string, key: string, who: BuildWho, work: () => Promise<T>) {
  return storage.run({ buildId: randomUUID(), phase, key, who, calls: [], startedAt: Date.now() }, work);
}

export function currentBuildId() {
  return storage.getStore()?.buildId ?? null;
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

type Price = { in?: number; out?: number; cachedIn?: number; search?: number; image?: number };

function priceTable(): Record<string, Price> {
  try {
    const parsed = JSON.parse(process.env.ATLAS_PRICE_TABLE ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function callUsd(call: Omit<CostCall, 'usd'>): number | null {
  const price = priceTable()[call.model];
  if (!price) return null;
  const usd = ((call.inputTokens - call.cachedInputTokens) * (price.in ?? 0) + call.cachedInputTokens * (price.cachedIn ?? price.in ?? 0) + call.outputTokens * (price.out ?? 0)) / 1e6
    + (call.webSearchCalls * (price.search ?? 0)) / 1000
    + (call.outputTokens > 0 ? 0 : call.images * (price.image ?? 0)); // a per-image price applies only when the API reported no token usage for the image
  return Math.round(usd * 1e6) / 1e6;
}

function push(stage: string, model: string, provider: CostCall['provider'], usage: unknown, extra: { webSearchCalls?: number; images?: number; imageSize?: string; imageQuality?: string; ok?: boolean; ms?: number }) {
  const ledger = storage.getStore();
  if (!ledger || ledger.calls.length >= 500) return;
  const u = (usage && typeof usage === 'object' ? usage : {}) as Record<string, unknown>;
  const inputDetails = (u.input_tokens_details ?? u.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const outputDetails = (u.output_tokens_details ?? u.completion_tokens_details ?? {}) as Record<string, unknown>;
  const base = {
    i: ledger.calls.length + 1, stage, model, provider,
    inputTokens: num(u.input_tokens ?? u.prompt_tokens),
    cachedInputTokens: num(inputDetails.cached_tokens),
    outputTokens: num(u.output_tokens ?? u.completion_tokens),
    reasoningTokens: num(outputDetails.reasoning_tokens),
    webSearchCalls: extra.webSearchCalls ?? 0,
    images: extra.images ?? 0,
    imageSize: extra.imageSize, imageQuality: extra.imageQuality,
    ok: extra.ok ?? true, ms: extra.ms,
  };
  ledger.calls.push({ ...base, usd: callUsd(base) });
}

/** a /responses payload (research, supplier, QA, hotspots) or a TAO-1 chat result shaped like one */
export function recordResponse(stage: string, model: string, payload: unknown, opts: { provider?: CostCall['provider']; ms?: number } = {}) {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const searches = Array.isArray(p.output) ? p.output.filter((item) => item && typeof item === 'object' && (item as Record<string, unknown>).type === 'web_search_call').length : 0;
  push(stage, model, opts.provider ?? 'openai', p.usage, { webSearchCalls: searches, ok: p.status === undefined || p.status === 'completed', ms: opts.ms });
}

/** an /images/generations payload: one image, plus token usage when the model reports it */
export function recordImage(stage: string, model: string, payload: unknown, opts: { size?: string; quality?: string; ms?: number } = {}) {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  push(stage, model, 'openai', p.usage, { images: 1, imageSize: opts.size, imageQuality: opts.quality, ms: opts.ms });
}

function lineKey(call: CostCall) {
  return `${call.stage}|${call.model}|${call.provider}`;
}

export function summarizeCalls(calls: CostCall[]) {
  const lines = new Map<string, CostLine>();
  const unpriced = new Set<string>();
  for (const call of calls) {
    const id = lineKey(call);
    const line = lines.get(id) ?? { stage: call.stage, model: call.model, provider: call.provider, calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, webSearchCalls: 0, images: 0, usd: 0 as number | null };
    line.calls += 1;
    line.inputTokens += call.inputTokens; line.outputTokens += call.outputTokens; line.cachedInputTokens += call.cachedInputTokens; line.reasoningTokens += call.reasoningTokens;
    line.webSearchCalls += call.webSearchCalls; line.images += call.images;
    if (call.usd === null) { unpriced.add(call.model); } else if (line.usd !== null) line.usd = Math.round((line.usd + call.usd) * 1e6) / 1e6;
    lines.set(id, line);
  }
  const all = [...lines.values()];
  const priced = calls.filter((call) => call.usd !== null);
  const usd = priced.length ? Math.round(priced.reduce((sum, call) => sum + (call.usd ?? 0), 0) * 1e6) / 1e6 : null;
  const totals = calls.reduce((t, c) => ({
    inputTokens: t.inputTokens + c.inputTokens, cachedInputTokens: t.cachedInputTokens + c.cachedInputTokens, outputTokens: t.outputTokens + c.outputTokens,
    reasoningTokens: t.reasoningTokens + c.reasoningTokens, webSearchCalls: t.webSearchCalls + c.webSearchCalls, images: t.images + c.images, calls: t.calls + 1,
  }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, webSearchCalls: 0, images: 0, calls: 0 });
  return { lines: all, usd, unpriced: [...unpriced], totals };
}

/** this request's phase summary (used for the atlas's buildCost) */
export function summarizeLedger(): { phase: string; at: string; buildId: string; lines: CostLine[]; usd: number | null; unpriced: string[] } | null {
  const ledger = storage.getStore();
  if (!ledger) return null;
  const s = summarizeCalls(ledger.calls);
  return { phase: ledger.phase, at: new Date().toISOString(), buildId: ledger.buildId, lines: s.lines, usd: s.usd, unpriced: s.unpriced };
}

/** the saved atlas's buildCost: previous phases kept, this phase added */
export function mergeBuildCost(previous: BuildCost | undefined, summary: ReturnType<typeof summarizeLedger>): BuildCost | undefined {
  if (!summary) return previous;
  const phases = { ...(previous?.phases ?? {}) };
  phases[summary.phase] = { at: summary.at, buildId: summary.buildId, lines: summary.lines, usd: summary.usd, unpriced: summary.unpriced };
  const values = Object.values(phases);
  return { phases, totalUsd: values.every((phase) => phase.usd !== null) ? Math.round(values.reduce((sum, phase) => sum + (phase.usd ?? 0), 0) * 1e6) / 1e6 : null };
}

/** called once when the request ends: logs the line and saves the durable usage record (skipped when the request spent nothing, e.g. a cached view) */
export async function finishLedger(outcome: string) {
  const ledger = storage.getStore();
  if (!ledger || !ledger.calls.length) return null;
  const s = summarizeCalls(ledger.calls);
  const endedAt = new Date();
  const record: UsageRecord = {
    buildId: ledger.buildId, key: ledger.key, phase: ledger.phase, outcome, who: ledger.who,
    startedAt: new Date(ledger.startedAt).toISOString(), endedAt: endedAt.toISOString(), ms: endedAt.getTime() - ledger.startedAt,
    usd: s.usd, unpriced: s.unpriced, totals: s.totals, lines: s.lines, calls: ledger.calls,
  };
  console.info(JSON.stringify({ atlas_cost: { buildId: record.buildId, key: record.key, phase: record.phase, outcome, who: record.who.kind, ms: record.ms, usd: record.usd, unpriced: record.unpriced, totals: record.totals } }));
  if (hasSharedAtlasStore()) {
    try {
      await put(`${galleryRoot()}/_usage/${endedAt.toISOString().slice(0, 10)}/${record.buildId}.json`, JSON.stringify(record), {
        access: 'public', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json', cacheControlMaxAge: 60,
      });
    } catch (error) {
      console.error('Usage record was not saved', error instanceof Error ? error.message : error);
    }
  }
  return record;
}
