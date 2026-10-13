// run: node --test tests/atlas-store-exploded.test.mjs (ROOT=<dir> for another checkout). The exploded view survives the LoRA-exploded / supplier-pass race even when the blob CDN serves a stale copy of
// atlas.json or draft.json (witness 10-13: head size 50,407 bytes vs 48,110 bytes on the wire, for minutes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const root = process.env.ROOT ?? process.cwd();
const out = path.join(root, 'node_modules', `.atlas-store-test-${process.pid}.mjs`);
const stub = `const S = (globalThis.__blobs ??= new Map());
  export const head = async (p) => { const v = S.get(p); if (!v) throw new Error('not found'); return { url: 'mem://' + p, uploadedAt: new Date(v.at), size: v.body.length }; };
  export const put = async (p, body) => { const old = S.get(p); S.set(p, { body: typeof body === 'string' ? body : Buffer.from(body).toString('latin1'), prev: old?.body, at: (old?.at ?? 1000) + 1000 }); return { url: 'mem://' + p }; };
  export const list = async () => ({ blobs: [], hasMore: false });`;
await build({ entryPoints: [path.join(root, 'app/atlas-store.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error', external: [],
  plugins: [{ name: 'blob', setup(b) { b.onResolve({ filter: /^@vercel\/blob$/ }, (a) => ({ path: a.path, namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: stub, loader: 'js' })); } }] });
process.env.BLOB_READ_WRITE_TOKEN = 'x'.repeat(30); process.env.ATLAS_GALLERY_PREFIX = 'atlas-foundry/unit';
globalThis.__blobs ??= new Map();
const realFetch = globalThis.fetch;
// the CDN: a path listed in __stale serves the PREVIOUS body (the bug); a ?v=<uploadedAt> fetch of a record never read before is fresh
globalThis.fetch = async (url) => {
  const u = String(url); if (!u.startsWith('mem://')) return realFetch(url);
  const p = u.slice(6).split('?')[0]; const v = globalThis.__blobs.get(p); if (!v) return { ok: false };
  const body = globalThis.__stale?.has(p) && v.prev !== undefined ? v.prev : v.body;
  return { ok: true, json: async () => JSON.parse(body) };
};
const { saveAtlasDraft, saveAtlasToGallery, loadCachedAtlas, loadAtlasDraft, loadGalleryAtlas } = await import(pathToFileURL(out).href);
const base = (extra = {}) => ({ subject: 'Unit Widget', subtitle: 's', category: 'c', summary: 'x', accuracyNote: 'a', parts: [], sources: [], image: 'https://blob/unit/assembled.png', imageAlt: 'i', explodedImageAlt: 'alt', imageOrientation: 'landscape', mode: 'generated', generatedAt: '2026-10-13T00:00:00Z', ...extra });
const reset = () => { globalThis.__blobs.clear(); globalThis.__stale = new Set(); };
globalThis.__stale = new Set();
const EX = { explodedImage: 'https://blob/unit/exploded.jpg', hotspots: { a: { x: 1, y: 2 } } };

test('witness: the exploded step saved to the draft record, then the supplier pass overwrote atlas.json from a stale copy without it: the exploded view still loads (from the sidecar)', async () => {
  reset();
  await saveAtlasDraft(base(), 'Unit Widget');                                   // draft, no exploded yet
  await saveAtlasDraft(base(EX), 'Unit Widget');                                 // the exploded step's save (draft record + sidecar)
  await saveAtlasToGallery(base({ generatedAt: '2026-10-13T00:03:00Z' }), 'Unit Widget'); // the supplier pass's final save from a stale copy: NO exploded
  globalThis.__stale.add('atlas-foundry/unit/unit-widget/draft.json');            // and the CDN serves the older draft.json too
  const atlas = await loadCachedAtlas('unit-widget');
  assert.equal(atlas.explodedImage, EX.explodedImage); assert.deepEqual(atlas.hotspots, EX.hotspots);
  const draft = await loadAtlasDraft('unit-widget'); assert.equal(draft.explodedImage, EX.explodedImage, 'a stale draft.json read gets it too');
  assert.equal((await loadGalleryAtlas('unit-widget')).explodedImage, EX.explodedImage);
});
test('an atlas that already carries its exploded view is returned unchanged; one without a sidecar likewise', async () => {
  reset();
  await saveAtlasToGallery(base({ explodedImage: 'https://blob/unit/own.jpg' }), 'Unit Widget');
  assert.equal((await loadCachedAtlas('unit-widget')).explodedImage, 'https://blob/unit/own.jpg');
  reset(); await saveAtlasToGallery(base(), 'Plain Thing');
  const a = await loadCachedAtlas('plain-thing'); assert.equal(a.explodedImage, undefined); assert.equal(a.hotspots, undefined);
});
test('the sidecar is written only for a real (stored) exploded image URL', async () => {
  reset(); await saveAtlasDraft(base({ explodedImage: undefined }), 'Unit Widget');
  assert.equal(globalThis.__blobs.has('atlas-foundry/unit/unit-widget/exploded.json'), false);
  await saveAtlasDraft(base(EX), 'Unit Widget'); assert.equal(globalThis.__blobs.has('atlas-foundry/unit/unit-widget/exploded.json'), true);
});
