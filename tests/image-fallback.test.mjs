// run: node --test tests/image-fallback.test.mjs (ROOT=<dir> for another checkout). The warm-window logic with the blob store and the RunPod REST API stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = process.env.ROOT ?? process.cwd();
const out = path.join(root, 'node_modules', `.image-fallback-test-${process.pid}.mjs`);
const stubs = {
  '@vercel/blob': `const store = (globalThis.__blob ??= new Map());
    export const head = async (p) => { if (!store.has(p)) throw new Error('not found'); return { url: 'mem://' + p }; };
    export const put = async (p, body) => { store.set(p, body); return { url: 'mem://' + p }; };`,
  '@/app/atlas-store': `export const galleryRoot = () => 'atlas-foundry/test'; export const hasSharedAtlasStore = () => true;`,
};
await build({ entryPoints: [path.join(root, 'app/image-fallback.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /^(@vercel\/blob|@\/app\/atlas-store)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubs[a.path], loader: 'js' }));
  } }] });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('mem://')) { const v = globalThis.__blob.get(u.slice(6).split('?')[0]); return { ok: v !== undefined, json: async () => JSON.parse(v) }; }
  if (u.startsWith('https://rest.runpod.io/')) {
    (globalThis.__calls ??= []).push({ method: init?.method, body: init?.body ? JSON.parse(init.body) : null });
    return { ok: true, json: async () => ({ workersMin: globalThis.__ep.workersMin, workersMax: globalThis.__ep.workersMax }) };
  }
  if (u.startsWith('https://api.runpod.ai/v2/') && u.endsWith('/health')) {
    if (globalThis.__healthThrows) throw new Error('network');
    return { ok: true, json: async () => ({ workers: globalThis.__workers }) };
  }
  return realFetch(url, init);
};
process.env.ATLAS_BASE_WARM = '1'; process.env.RUNPOD_API_KEY = 'x'.repeat(30); process.env.ATLAS_BASE_ENDPOINT = 'ep123';
const { escalateWarm, coolDownIfDue, isCapacityError, fallbackConfigured, primaryRunpodOn, imageEndpoint, liveHasFreeWorker, loraEndpointUsable } = await import(pathToFileURL(out).href);
const patches = () => (globalThis.__calls ?? []).filter((c) => c.method === 'PATCH');

test('capacity errors are recognised, others are not', () => {
  assert.equal(isCapacityError(new Error('chutes/qwen-image-2512: HTTP 429 {"detail":"Infrastructure is at maximum capacity"}')), true);
  assert.equal(isCapacityError(new Error('HTTP 500 No infrastructure available to serve request')), true);
  assert.equal(isCapacityError(new Error('HTTP 400 bad prompt')), false);
});

test('not configured without the three settings', () => {
  assert.equal(fallbackConfigured(), true);
  delete process.env.ATLAS_BASE_WARM; assert.equal(fallbackConfigured(), false); process.env.ATLAS_BASE_WARM = '1';
});

test('the first capacity error warms the endpoint once for the window and logs the switch', async () => {
  globalThis.__ep = { workersMin: 0, workersMax: 0 }; globalThis.__calls = []; globalThis.__blob.clear();
  await escalateWarm('chutes 429');
  await escalateWarm('chutes 429 again');
  assert.equal(patches().length, 1, 'idempotent while the window is open');
  assert.deepEqual(patches()[0].body, { workersMin: 1, workersMax: 2 });
  const log = JSON.parse(globalThis.__blob.get('atlas-foundry/test/_ops/warm-log.json'));
  assert.equal(log.length, 1);
  assert.equal(log[0].action, 'warm-on');
});

test('the cooldown does nothing while the window is open and restores min 0 + the original max once it ended', async () => {
  const early = await coolDownIfDue();
  assert.equal(early.acted, false);
  const key = 'atlas-foundry/test/_ops/warm-state.json';
  const state = JSON.parse(globalThis.__blob.get(key));
  globalThis.__blob.set(key, JSON.stringify({ ...state, until: new Date(Date.now() - 1000).toISOString(), originalMax: 3 }));
  globalThis.__calls = [];
  const done = await coolDownIfDue();
  assert.equal(done.acted, true);
  assert.deepEqual(patches()[0].body, { workersMin: 0, workersMax: 3 });
  assert.equal((await coolDownIfDue()).acted, false, 'only once');
  const log = JSON.parse(globalThis.__blob.get('atlas-foundry/test/_ops/warm-log.json'));
  assert.equal(log.at(-1).action, 'warm-off');
});

test('the live endpoint is the primary only when asked for and fully configured; the live id wins over the base id', () => {
  delete process.env.ATLAS_IMAGE_PRIMARY; assert.equal(primaryRunpodOn(), false);
  process.env.ATLAS_IMAGE_PRIMARY = 'runpod'; assert.equal(primaryRunpodOn(), true);
  assert.equal(imageEndpoint(), 'ep123');
  process.env.ATLAS_LIVE_ENDPOINT = 'live999'; assert.equal(imageEndpoint(), 'live999');
  const key = process.env.RUNPOD_API_KEY; delete process.env.RUNPOD_API_KEY; assert.equal(primaryRunpodOn(), false); process.env.RUNPOD_API_KEY = key;
  delete process.env.ATLAS_LIVE_ENDPOINT; delete process.env.ATLAS_IMAGE_PRIMARY;
});

test('health check: a user job goes to our endpoint only when a worker is idle or ready; unknown state never blocks', async () => {
  process.env.ATLAS_LIVE_ENDPOINT = 'live-a';
  globalThis.__workers = { idle: 1, ready: 0, running: 0, initializing: 0 };
  assert.equal(await liveHasFreeWorker(), true);
  process.env.ATLAS_LIVE_ENDPOINT = 'live-b';
  globalThis.__workers = { idle: 0, ready: 0, running: 2, initializing: 0 };
  assert.equal(await liveHasFreeWorker(), false, 'all workers busy -> Chutes at once');
  process.env.ATLAS_LIVE_ENDPOINT = 'live-c';
  globalThis.__workers = { idle: 0, ready: 0, running: 0, initializing: 2 };
  assert.equal(await liveHasFreeWorker(), false, 'cold-starting only -> Chutes at once');
  process.env.ATLAS_LIVE_ENDPOINT = 'live-d';
  globalThis.__healthThrows = true;
  assert.equal(await liveHasFreeWorker(), true, 'health unreachable -> unknown, not blocked');
  globalThis.__healthThrows = false;
  process.env.ATLAS_LIVE_HEALTH_CHECK = '0';
  process.env.ATLAS_LIVE_ENDPOINT = 'live-e';
  globalThis.__workers = { idle: 0, ready: 0, running: 0, initializing: 0 };
  assert.equal(await liveHasFreeWorker(), true, 'check switched off');
  delete process.env.ATLAS_LIVE_HEALTH_CHECK;
});

test('health check for the LoRA exploded step: a busy worker is fine (not a user wait), cold-only or none is skipped', async () => {
  globalThis.__workers = { idle: 0, ready: 0, running: 1, initializing: 0 };
  assert.equal(await loraEndpointUsable('lora-a', 'k'.repeat(30)), true);
  globalThis.__workers = { idle: 0, ready: 0, running: 0, initializing: 2 };
  assert.equal(await loraEndpointUsable('lora-b', 'k'.repeat(30)), false);
});
