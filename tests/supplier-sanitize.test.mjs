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
    relationships: [null, { partId: 'p1', company: 'ACME', evidenceUrl: 'https://a', relationshipStatus: 'confirmed' }, 'x', { partId: null, company: 'B' }, { company: 'C' }],
    coverage: [{ partId: 'p1', status: 'sourced' }, null, undefined, { status: 'x' }],
    sources: [null, { url: 'https://a', title: 't', publisher: 'p' }],
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

test('entries with missing text fields no longer crash the normaliser (qwen3.8-27b case)', () => {
  const r = sanitizeSupplierResult({
    relationships: [{ partId: 'p1', company: 'ACME', evidenceUrl: 'https://a', relationshipStatus: 'confirmed' }, { partId: 'p2', company: 'B', relationshipStatus: 'confirmed' }],
    coverage: [{ partId: 'p1' }],
    sources: [{ url: 'https://a' }, { title: 'no url' }],
  });
  assert.equal(r.relationships.length, 1, 'a relationship without an evidence url is dropped');
  assert.equal(typeof r.relationships[0].note, 'string');
  assert.doesNotThrow(() => r.relationships[0].note.trim().slice(0, 420));
  assert.equal(r.coverage[0].summary, '');
  assert.equal(r.sources.length, 1);
  assert.doesNotThrow(() => r.sources[0].title.slice(0, 140) + r.sources[0].publisher.slice(0, 80));
});
