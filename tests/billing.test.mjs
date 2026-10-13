// run: node --test tests/billing.test.mjs  (ROOT=<dir> for another checkout). Tests the pure billing function of app/atlas-jobs.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const root = process.env.ROOT ?? process.cwd();
const entry = path.join(root, 'node_modules', `.billing-entry-${process.pid}.ts`);
const out = path.join(root, 'node_modules', `.billing-test-${process.pid}.mjs`);
fs.writeFileSync(entry, `export * from '${root}/app/atlas-jobs.ts';\n`);
buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, alias: { '@': root }, packages: 'external', logLevel: 'error' });
const mod = await import(pathToFileURL(out).href);

const call = (i, stage, usd, extra = {}) => ({ i, stage, model: stage.startsWith('image') ? 'chutes/qwen-image-2512' : 'tao-1', provider: stage.startsWith('image') ? 'other' : 'tao1', inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, webSearchCalls: 0, images: ['image-assembled', 'image-exploded', 'image-text-removal'].includes(stage) ? 1 : 0, usd, ok: true, ...extra });
const rec = (buildId, phase, outcome, calls) => ({ buildId, phase, outcome, who: { kind: 'tao1', id: 't' }, usd: null, unpriced: [], ms: 1, lines: [], calls });
const draftCalls = [call(1, 'research', 0.05, { inputTokens: 1000, outputTokens: 2000 }), call(2, 'image-assembled', 0.02), call(3, 'image-exploded', 0.02), call(4, 'image-qa', 0.002), call(5, 'image-exploded', 0.02), call(6, 'image-qa', 0.002)];

test('no exploded view delivered: no exploded render is billed', () => {
  const u = mod.billableUsage([rec('a', 'draft', 'draft_saved', draftCalls)], { explodedDelivered: false });
  assert.equal(u.totals.images, 1, 'only the assembled image bills');
  assert.ok(Math.abs(u.totals.usd - (0.05 + 0.02 + 0.002 + 0.002)) < 1e-9, `usd ${u.totals.usd}`);
  assert.ok(Math.abs(u.undelivered.usd - 0.04) < 1e-9, 'both exploded renders are our cost');
});

test('exploded view delivered: only the final render bills, failed attempts are ours', () => {
  const u = mod.billableUsage([rec('a', 'draft', 'draft_saved', draftCalls)], { explodedDelivered: true });
  assert.equal(u.totals.images, 2, 'assembled + the last exploded render');
  assert.ok(Math.abs(u.undelivered.usd - 0.02) < 1e-9, 'the first exploded attempt is our cost');
});

test('a failed build bills nothing; a delivered one still bills its text', () => {
  const u = mod.billableUsage([rec('a', 'draft', 'draft_saved', draftCalls), rec('b', 'enrich', 'failed_http_500', [call(1, 'vendor', 0.3, { inputTokens: 500, outputTokens: 900 })])], { explodedDelivered: false });
  assert.ok(Math.abs(u.undelivered.usd - (0.04 + 0.3)) < 1e-9);
  assert.equal(u.undelivered.builds.length, 1);
  assert.equal(u.totals.prompt_tokens, 1000, 'the failed vendor call adds no tokens');
});

test('a job that failed outright has zero totals', () => {
  const u = mod.billableUsage([rec('a', 'draft', 'failed_http_500', draftCalls)], { explodedDelivered: false });
  assert.equal(u.totals.usd, 0);
  assert.equal(u.totals.inputTokens, 0);
});
