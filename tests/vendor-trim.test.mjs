// run: node --test tests/vendor-trim.test.mjs (ROOT=<dir> for another checkout)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
const root = process.env.ROOT ?? process.cwd();
const out = path.join(root, 'node_modules', `.vendor-trim-test-${process.pid}.mjs`);
buildSync({ entryPoints: [path.join(root, 'app/vendor-trim.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
const { trimSupplierSchema, VENDOR_OUTPUT_BUDGET } = await import(pathToFileURL(out).href);
const base = { properties: { relationships: { type: 'array', maxItems: 160, items: { properties: { note: { type: 'string' }, company: { type: 'string' } } } }, coverage: { type: 'array', items: { properties: { summary: { type: 'string' } } } } } };

test('the trimmed schema caps note, summary and relationships, and leaves the base untouched', () => {
  const t = trimSupplierSchema(base, 6);
  assert.equal(t.properties.relationships.items.properties.note.maxLength, 280);
  assert.equal(t.properties.coverage.items.properties.summary.maxLength, 200);
  assert.equal(t.properties.relationships.maxItems, 24);
  assert.equal(t.properties.relationships.items.properties.company.type, 'string', 'other fields kept');
  assert.equal(base.properties.relationships.maxItems, 160);
  assert.equal(base.properties.relationships.items.properties.note.maxLength, undefined);
});

test('the output budget text states the limits', () => {
  assert.match(VENDOR_OUTPUT_BUDGET, /280 characters/);
  assert.match(VENDOR_OUTPUT_BUDGET, /at most 4 relationships/);
});
