// run: node --test tests/exploded-merge.test.mjs (ROOT=<dir> for another checkout). The exploded-view choice in the supplier pass's final save.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const root = process.env.ROOT ?? process.cwd();
const out = path.join(root, 'node_modules', `.exploded-merge-test-${process.pid}.mjs`);
await build({ entryPoints: [path.join(root, 'app/exploded-merge.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
const { pickExploded } = await import(pathToFileURL(out).href);
const X = (n) => ({ explodedImage: `https://blob/${n}/exploded.jpg`, explodedImageAlt: `alt ${n}`, hotspots: [{ id: n }] });

test('the draft already has an exploded view: nothing to carry', () => { assert.deepEqual(pickExploded(X('draft'), X('g'), X('d')), {}); });
test('witness bug: the exploded step saved to the GALLERY record, the draft record has none: it is carried (the old code only read the draft record and lost it)', () => {
  assert.deepEqual(pickExploded({}, X('gallery'), {}), X('gallery'));
  assert.deepEqual(pickExploded(undefined, X('gallery'), null), X('gallery'));
});
test('the exploded step saved to the draft record: carried as before', () => { assert.deepEqual(pickExploded({}, {}, X('draft')), X('draft')); assert.deepEqual(pickExploded({}, null, X('draft')), X('draft')); });
test('both records have one: the gallery record (written last by the exploded step on a complete atlas) wins', () => { assert.deepEqual(pickExploded({}, X('gallery'), X('draft')), X('gallery')); });
test('no exploded view anywhere: nothing carried', () => { assert.deepEqual(pickExploded({}, {}, {}), {}); assert.deepEqual(pickExploded(null, null, null), {}); });

test('RACE TEST (red on the old final save): the old rule read only the draft record, so an exploded view the exploded step saved to the gallery record was lost; the route now routes the choice through pickExploded with BOTH records', async () => {
  const oldPick = (draft, latestDraft) => (!draft.explodedImage && latestDraft?.explodedImage ? { explodedImage: latestDraft.explodedImage } : {}); // the pre-r32 line in route.ts
  const gallery = X('gallery'); const draftRecord = {}; // the witness state: exploded saved to the gallery record, none in draft.json
  assert.deepEqual(oldPick({}, draftRecord), {}, 'the old rule loses it (the Garmin / Anker bug)');
  assert.deepEqual(pickExploded({}, gallery, draftRecord), gallery, 'the new rule keeps it');
  const fs = await import('node:fs'); const src = fs.readFileSync(path.join(root, 'app/api/generate-atlas/route.ts'), 'utf8');
  assert.match(src, /pickExploded\(draft, latestGallery, latestDraft\)/, 'the final save must call pickExploded with the gallery record too');
  assert.match(src, /latestGallery = await loadCachedAtlas\(promptCacheKey\)/, 'and must load the freshest gallery record');
  assert.doesNotMatch(src, /!draft\.explodedImage && latestDraft\?\.explodedImage/, 'the draft-only rule is gone');
});
