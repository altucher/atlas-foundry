// run: node --test tests/tao1-text.test.mjs  (ROOT=<dir> to test another checkout). Bundles app/tao1-text.ts with esbuild and calls it against a mock gateway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { buildSync } from 'esbuild';

const root = process.env.ROOT ?? process.cwd();
const out = path.join(root, 'node_modules', `.tao1-text-test-${process.pid}.mjs`);
const entry = path.join(root, 'node_modules', `.tao1-text-entry-${process.pid}.ts`);
fs.writeFileSync(entry, `export * from '${root}/app/tao1-text.ts';\nexport { runWithLedger } from '${root}/app/cost-ledger.ts';\n`);
buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, alias: { '@': root }, external: ['undici'], logLevel: 'error' });
const { tao1StructuredCall, runWithLedger } = await import(pathToFileURL(out).href);
const visionOut = path.join(root, 'node_modules', `.tao1-vision-test-${process.pid}.mjs`);
buildSync({ entryPoints: [path.join(root, 'app/tao1-image.ts')], bundle: true, platform: 'node', format: 'esm', outfile: visionOut, alias: { '@': root }, external: ['undici'], logLevel: 'error' });

function gateway(replies) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push(JSON.parse(body));
      const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: reply.content }, finish_reason: reply.finish ?? 'stop' }], usage: reply.usage ?? { prompt_tokens: 10, completion_tokens: 5 } }));
    });
  });
  server.unref();
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, conn: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'k', model: 'tao-1' } })));
}
const body = { instructions: 'x', input: 'y', text: { format: { schema: { required: ['parts'] } } } };

test('a reply cut short (finish_reason length) is never accepted as a whole result', async () => {
  const { server, calls, conn } = await gateway([{ content: '{"parts":[1]}', finish: 'length' }, { content: '{"parts":[1,2,3]}', finish: 'stop' }]);
  const payload = await tao1StructuredCall(conn, body);
  server.close();
  assert.equal(calls.length, 2, 'the cut reply must be retried');
  assert.match(JSON.stringify(payload), /\[1,2,3\]/);
});

test('three cut replies fail instead of shipping a partial result', async () => {
  const { server, conn } = await gateway([{ content: '{"parts":[1]}', finish: 'length' }]);
  await assert.rejects(() => tao1StructuredCall(conn, body), /cut short|no usable JSON/);
  server.close();
});

test('the retry budget stops before another attempt once the request is past it', async () => {
  process.env.ATLAS_RESEARCH_BUDGET_MS = '5';
  const { server, calls, conn } = await gateway([{ content: 'not json' }]);
  await assert.rejects(() => runWithLedger('draft', 'k', { kind: 'internal-test', id: 't' }, async () => { await new Promise((r) => setTimeout(r, 30)); return tao1StructuredCall(conn, body); }), /Research budget exceeded/);
  server.close();
  delete process.env.ATLAS_RESEARCH_BUDGET_MS;
  assert.equal(calls.length, 0, 'no call may start past the budget');
});

test('a vision reply cut short (finish_reason length) is rejected', async () => {
  const { server, conn } = await gateway([{ content: '{"hotspots":[{"id":"a","x":1,"y":1,"width":1,"height":1}]}', finish: 'length' }]);
  const { tao1VisionText } = await import(pathToFileURL(visionOut).href);
  await assert.rejects(() => tao1VisionText(conn, 'sys', 'user', 'data:image/png;base64,AAAA', 100), /cut short/);
  server.close();
});

test('cached prompt tokens reach the usage record (summed over attempts)', async () => {
  const usage = { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 400 } };
  const { server, conn } = await gateway([{ content: '{"parts":[1]}', finish: 'stop', usage }]);
  const payload = await tao1StructuredCall(conn, body);
  server.close();
  assert.equal(payload.usage.input_tokens, 1000);
  assert.equal(payload.usage.input_tokens_details.cached_tokens, 400);
});
