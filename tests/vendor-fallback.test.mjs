// run: node --test tests/vendor-fallback.test.mjs (ROOT=<dir> for another checkout)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
const root = process.env.ROOT ?? process.cwd();
const out = path.join(root, 'node_modules', `.vendor-fallback-test-${process.pid}.mjs`);
buildSync({ entryPoints: [path.join(root, 'app/vendor-fallback.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, packages: 'external', logLevel: 'error' });
const { auditLooksEmpty, supplierCount, vendorPinStore } = await import(pathToFileURL(out).href);

const part = (n, status = 'sourced') => ({ suppliers: Array.from({ length: n }, () => ({ company: 'X' })), supplierResearch: { status } });

test('the Instant Pot case (0 relationships, every part searched-no-specific-evidence) is an empty audit', () => {
  const parts = Array.from({ length: 19 }, () => part(0, 'searched-no-specific-evidence'));
  assert.equal(supplierCount(parts), 0);
  assert.equal(auditLooksEmpty(parts), true);
});

test('fewer than 3 relationships is empty even if some parts say sourced', () => {
  assert.equal(auditLooksEmpty([part(1), part(1), part(0, 'searched-no-specific-evidence')]), true);
});

test('every part searched-no-specific-evidence is empty even with relationships present', () => {
  assert.equal(auditLooksEmpty([part(3, 'searched-no-specific-evidence'), part(2, 'searched-no-specific-evidence')]), true);
});

test('a normal audit is not empty', () => {
  assert.equal(auditLooksEmpty([part(2), part(3), part(0, 'searched-no-specific-evidence')]), false);
  assert.equal(auditLooksEmpty([]), false);
});

test('the per-request pin override reaches nested async work and does not leak', async () => {
  assert.equal(vendorPinStore.getStore(), undefined);
  const seen = await vendorPinStore.run({ pin: '' }, async () => { await new Promise((r) => setTimeout(r, 5)); return vendorPinStore.getStore()?.pin; });
  assert.equal(seen, '');
  assert.equal(vendorPinStore.getStore(), undefined);
});
