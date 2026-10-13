// run: node --test tests/supplier-sanitize.test.mjs (ROOT=<dir> for another checkout)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
const root = process.env.ROOT ?? process.cwd();
const out = path.join(root, 'node_modules', `.sanitize-test-${process.pid}.mjs`);
buildSync({ entryPoints: [path.join(root, 'app/supplier-sanitize.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
const { sanitizeSupplierResult } = await import(pathToFileURL(out).href);

test('null and non-object entries are dropped, good entries kept', () => {
  const r = sanitizeSupplierResult({
    relationships: [null, { partId: 'p1', company: 'ACME' }, 'x', { partId: null, company: 'B' }, { company: 'C' }],
    coverage: [{ partId: 'p1', status: 'sourced' }, null, undefined, { status: 'x' }],
    sources: [null, { url: 'https://a' }],
  });
  assert.equal(r.relationships.length, 1);
  assert.equal(r.coverage.length, 1);
  assert.equal(r.sources.length, 1);
  // the shape the enrichment reads must not throw
  assert.doesNotThrow(() => r.coverage.map((c) => c.partId));
  assert.doesNotThrow(() => r.relationships.filter((x) => x.partId === 'p1'));
});

test('missing arrays become empty arrays', () => {
  const r = sanitizeSupplierResult({});
  assert.deepEqual([r.relationships, r.coverage, r.sources], [[], [], []]);
});
