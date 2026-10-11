// BUILD COST LEDGER (AI2 2026-10-11): every paid call a build makes (research, supplier batches, image generation, image QA, hotspot mapping) records its model,
// tokens, web-search calls and images here, per request, through AsyncLocalStorage. A request logs one JSON line ("atlas_cost") and the saved atlas keeps
// buildCost (per phase: draft, enrich, deep), so a build's cost can be read back later. Dollar figures need prices: set ATLAS_PRICE_TABLE to JSON like
// {"gpt-5.4-mini":{"in":0.75,"out":4.5,"cachedIn":0.075,"search":10},"gpt-image-2.5-flare":{"image":0.19}} (USD per 1M tokens, per 1000 search calls, per image); models
// without a price are listed under unpriced and add no dollars. Prices are NOT guessed here.
import { AsyncLocalStorage } from 'node:async_hooks';

export type CostLine = {
  stage: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  webSearchCalls: number;
  images: number;
};

export type BuildCost = {
  phases: Record<string, { at: string; lines: CostLine[]; usd: number | null; unpriced: string[] }>;
  totalUsd: number | null;
};

type Ledger = { phase: string; key: string; lines: Map<string, CostLine>; startedAt: number };

const storage = new AsyncLocalStorage<Ledger>();

export function runWithLedger<T>(phase: string, key: string, work: () => Promise<T>) {
  return storage.run({ phase, key, lines: new Map(), startedAt: Date.now() }, work);
}

function line(stage: string, model: string) {
  const ledger = storage.getStore();
  if (!ledger) return null;
  const id = `${stage}|${model}`;
  let entry = ledger.lines.get(id);
  if (!entry) {
    entry = { stage, model, calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, webSearchCalls: 0, images: 0 };
    ledger.lines.set(id, entry);
  }
  return entry;
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

function addUsage(entry: CostLine, usage: unknown) {
  const u = (usage && typeof usage === 'object' ? usage : {}) as Record<string, unknown>;
  const inputDetails = (u.input_tokens_details ?? u.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const outputDetails = (u.output_tokens_details ?? u.completion_tokens_details ?? {}) as Record<string, unknown>;
  entry.calls += 1;
  entry.inputTokens += num(u.input_tokens ?? u.prompt_tokens);
  entry.outputTokens += num(u.output_tokens ?? u.completion_tokens);
  entry.cachedInputTokens += num(inputDetails.cached_tokens);
  entry.reasoningTokens += num(outputDetails.reasoning_tokens);
}

/** a /responses payload (research, supplier, QA, hotspots): usage plus the web_search_call items it made */
export function recordResponse(stage: string, model: string, payload: unknown) {
  const entry = line(stage, model);
  if (!entry) return;
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  addUsage(entry, p.usage);
  if (Array.isArray(p.output)) entry.webSearchCalls += p.output.filter((item) => item && typeof item === 'object' && (item as Record<string, unknown>).type === 'web_search_call').length;
}

/** an /images/generations payload: one image, plus token usage when the model reports it */
export function recordImage(stage: string, model: string, payload: unknown) {
  const entry = line(stage, model);
  if (!entry) return;
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  addUsage(entry, p.usage);
  entry.images += 1;
}

function priceTable(): Record<string, { in?: number; out?: number; cachedIn?: number; search?: number; image?: number }> {
  try {
    const parsed = JSON.parse(process.env.ATLAS_PRICE_TABLE ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function summarizeLedger(): { phase: string; at: string; lines: CostLine[]; usd: number | null; unpriced: string[] } | null {
  const ledger = storage.getStore();
  if (!ledger) return null;
  const prices = priceTable();
  const lines = [...ledger.lines.values()];
  const unpriced = new Set<string>();
  let usd = 0;
  let priced = 0;
  for (const entry of lines) {
    const price = prices[entry.model];
    if (!price) { unpriced.add(entry.model); continue; }
    priced += 1;
    usd += ((entry.inputTokens - entry.cachedInputTokens) * (price.in ?? 0) + entry.cachedInputTokens * (price.cachedIn ?? price.in ?? 0) + entry.outputTokens * (price.out ?? 0)) / 1e6
      + (entry.webSearchCalls * (price.search ?? 0)) / 1000 + (entry.outputTokens > 0 ? 0 : entry.images * (price.image ?? 0)); // a per-image price applies only when the API reported no token usage for the image
  }
  return { phase: ledger.phase, at: new Date().toISOString(), lines, usd: priced ? Math.round(usd * 10000) / 10000 : null, unpriced: [...unpriced] };
}

/** the saved atlas's buildCost: previous phases kept, this phase added */
export function mergeBuildCost(previous: BuildCost | undefined, summary: ReturnType<typeof summarizeLedger>): BuildCost | undefined {
  if (!summary) return previous;
  const phases = { ...(previous?.phases ?? {}) };
  phases[summary.phase] = { at: summary.at, lines: summary.lines, usd: summary.usd, unpriced: summary.unpriced };
  const values = Object.values(phases);
  return { phases, totalUsd: values.every((phase) => phase.usd !== null) ? Math.round(values.reduce((sum, phase) => sum + (phase.usd ?? 0), 0) * 10000) / 10000 : null };
}

export function logLedger(outcome: string) {
  const ledger = storage.getStore();
  const summary = summarizeLedger();
  if (!ledger || !summary) return;
  console.info(JSON.stringify({ atlas_cost: { key: ledger.key, phase: ledger.phase, outcome, ms: Date.now() - ledger.startedAt, usd: summary.usd, unpriced: summary.unpriced, lines: summary.lines } }));
}
