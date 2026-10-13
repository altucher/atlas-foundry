// run: node --test tests/tail-route.test.mjs (ROOT=<dir> for another checkout). Bundles the tail route with its dependencies stubbed: a STALE stored job record must not strand a job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = process.env.ROOT ?? process.cwd();
const out = path.join(root, 'node_modules', `.tail-route-test-${process.pid}.mjs`);
const stubs = {
  'next/server': `export const after = (fn) => { globalThis.__after = fn; }; export const NextResponse = { json: (body, init) => ({ status: init?.status ?? 200, body }) };`,
  '@/app/atlas-store': `export const isSafeCacheKey = () => true;`,
  '@/app/atlas-jobs': `export const jobsAuthorized = () => true; export const readJob = async () => globalThis.__stored ?? null; export const writeJob = async (job) => { globalThis.__written = job; };`,
  '@/app/jobs-pipeline': `export const runJobTail = async (job, ctx) => { globalThis.__tailRan = { job, ctx }; };`,
};
await build({
  entryPoints: [path.join(root, 'app/api/atlas-jobs/[id]/tail/route.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error',
  plugins: [{ name: 'stubs', setup(build) {
    build.onResolve({ filter: /^(next\/server|@\/app\/(atlas-store|atlas-jobs|jobs-pipeline))$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
  } }],
});
process.env.ATLAS_JOBS_KEY = 'k'.repeat(32);
const { POST } = await import(pathToFileURL(out).href);
const ctx = { params: Promise.resolve({ id: 'some-subject' }) };
const reqWith = (body) => ({ url: 'https://x.test/api/atlas-jobs/some-subject/tail', json: async () => body, headers: { get: () => 'k'.repeat(32) } });
const queuedJob = { id: 'some-subject', subject: 'Some subject', state: 'enriching', tail: { state: 'queued', enrichmentPending: true, hasExploded: false }, startedAt: 'x', updatedAt: 'x' };
const staleJob = { ...queuedJob, state: 'draft_ready', tail: undefined };

test('a stale stored record (still draft_ready) does not strand the job: the record sent in the handoff body wins', async () => {
  globalThis.__stored = staleJob; globalThis.__tailRan = null;
  const res = await POST(reqWith({ callerAddress: 'a', who: 'w', job: queuedJob }), ctx);
  assert.equal(res.status, 202, 'the tail must claim the job');
  await globalThis.__after();
  assert.ok(globalThis.__tailRan, 'the tail work ran');
  assert.equal(globalThis.__tailRan.ctx.enrichmentPending, true);
});

test('without a job in the body the stored record is used (and a stale one is refused with 200, never 202)', async () => {
  globalThis.__stored = staleJob; globalThis.__tailRan = null;
  const res = await POST(reqWith({ callerAddress: 'a' }), ctx);
  assert.equal(res.status, 200);
  assert.equal(globalThis.__tailRan, null);
});

test('a job already running is not started twice', async () => {
  globalThis.__tailRan = null;
  const res = await POST(reqWith({ job: { ...queuedJob, tail: { ...queuedJob.tail, state: 'running' } } }), ctx);
  assert.equal(res.status, 200);
  assert.equal(globalThis.__tailRan, null);
});
