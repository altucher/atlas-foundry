// run: node --test tests/open-only.test.mjs  (ROOT=<dir> for another checkout). Tests app/open-only.ts and the caller pseudonym of app/atlas-jobs.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const root = process.env.ROOT ?? process.cwd();
const entry = path.join(root, 'node_modules', `.openonly-entry-${process.pid}.ts`);
const out = path.join(root, 'node_modules', `.openonly-test-${process.pid}.mjs`);
fs.writeFileSync(entry, `export * from '${root}/app/open-only.ts';\nexport { pseudonym } from '${root}/app/atlas-jobs.ts';\n`);
buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, alias: { '@': root }, packages: 'external', logLevel: 'error' });
const { openOnlyOn, openOnlyViolations, pseudonym } = await import(pathToFileURL(out).href);

const good = { ATLAS_OPEN_ONLY: '1', TAO1_API_KEY: 'k', ATLAS_TEXT_PROVIDER: 'tao1', ATLAS_VISION_PROVIDER: 'tao1', CHUTES_API_KEY: 'c', ATLAS_IMAGE_PROVIDER: 'chutes' };

test('a complete open-weight configuration has no violations', () => {
  assert.equal(openOnlyOn(good), true);
  assert.deepEqual(openOnlyViolations(good), []);
  // OpenAI / gateway / OpenRouter keys being present is not itself a violation: they are inert in this mode
  assert.deepEqual(openOnlyViolations({ ...good, OPENAI_API_KEY: 'x', OPENROUTER_API_KEY: 'y', AI_GATEWAY_API_KEY: 'z' }), []);
});

test('each unset or mis-set provider variable is refused', () => {
  for (const [name, patch] of [
    ['no TAO-1 key', { TAO1_API_KEY: '' }],
    ['text provider openai', { ATLAS_TEXT_PROVIDER: 'openai' }],
    ['text provider unset', { ATLAS_TEXT_PROVIDER: undefined }],
    ['vision provider openai', { ATLAS_VISION_PROVIDER: 'openai' }],
    ['vision provider unset', { ATLAS_VISION_PROVIDER: undefined }],
    ['no Chutes key', { CHUTES_API_KEY: undefined }],
    ['image provider openai', { ATLAS_IMAGE_PROVIDER: 'openai' }],
    ['image provider unset', { ATLAS_IMAGE_PROVIDER: undefined }],
    ['exploded via OpenRouter Gemini', { ATLAS_EXPLODED_PROVIDER: 'openrouter' }],
  ]) {
    assert.ok(openOnlyViolations({ ...good, ...patch }).length >= 1, name);
  }
});

test('admin request overrides cannot switch to a closed provider', () => {
  assert.ok(openOnlyViolations(good, { text: 'openai' }).length >= 1);
  assert.ok(openOnlyViolations(good, { image: 'openai' }).length >= 1);
  assert.deepEqual(openOnlyViolations(good, { text: 'tao1', image: 'chutes' }), []);
});

test('the mode is off unless ATLAS_OPEN_ONLY is exactly 1', () => {
  assert.equal(openOnlyOn({}), false);
  assert.equal(openOnlyOn({ ATLAS_OPEN_ONLY: '0' }), false);
  assert.equal(openOnlyOn({ ATLAS_OPEN_ONLY: 'true' }), false);
});

test('the caller pseudonym is keyed, stable, and never contains the raw id', () => {
  const a = pseudonym('user:34259156-997a-445d-8f39-c836aed94934', 'secret-1');
  assert.match(a, /^h:[0-9a-f]{16}$/);
  assert.equal(a, pseudonym('user:34259156-997a-445d-8f39-c836aed94934', 'secret-1'));
  assert.notEqual(a, pseudonym('user:34259156-997a-445d-8f39-c836aed94934', 'secret-2'), 'a different key gives a different pseudonym');
  assert.ok(!a.includes('34259156'));
  assert.equal(pseudonym('', 'secret-1'), '');
});
