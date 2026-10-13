// run: node --test tests/pricing.test.mjs (ROOT=<dir> for another checkout)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
const root = process.env.ROOT ?? process.cwd();
const out = path.join(root, 'node_modules', `.pricing-test-${process.pid}.mjs`);
buildSync({ entryPoints: [path.join(root, 'app/cost-ledger.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, packages: 'external', logLevel: 'error' });
const mod = await import(pathToFileURL(out).href);
process.env.ATLAS_PRICE_TABLE = JSON.stringify({ 'tao-1': { in: 0.5, cachedIn: 0.15, out: 7.5 }, 'chutes/qwen-image-2512': { image: 0.02 } });
const call = (model, provider, extra = {}) => ({ i: 1, stage: 'vendor', model, provider, inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 100_000, reasoningTokens: 0, webSearchCalls: 0, images: 0, ok: true, ...extra });

test('a TAO-1 call served by a pinned cell is priced at the tao-1 list entry', () => {
  const usd = mod.callUsd(call('openrouter/deepseek/deepseek-v4.1-flash', 'tao1'));
  assert.ok(Math.abs(usd - 1.18) < 1e-6, `usd ${usd}`);
});

test('the tao-1 label itself still prices as before', () => {
  assert.ok(Math.abs(mod.callUsd(call('tao-1', 'tao1')) - 1.18) < 1e-6);
});

test('a non-TAO-1 call with no table entry stays unpriced (null), never silently zero', () => {
  assert.equal(mod.callUsd(call('some/unknown-model', 'other')), null);
});
