import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Atlas Foundry workbench", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Atlas Foundry — Take Anything Apart<\/title>/i);
  assert.match(html, /What do you want to/);
  assert.match(html, /SAVED \/ SHARED GALLERY/);
  assert.match(html, /VENDORS/);
  assert.match(html, /EXPLOSION/);
  assert.match(html, /Cross-generation platform/);
  assert.match(html, /SUPPLIERS \/ VENDORS/);
  assert.doesNotMatch(html, /Know what this is/i);
  assert.doesNotMatch(html, /Conceptual by default/i);
});

test("keeps credentials server-side and implements shared gallery storage", async () => {
  const [page, generationRoute, galleryRoute, store] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/generate-atlas/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/gallery/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/atlas-store.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /NEXT_PUBLIC_(OPENAI|AI_GATEWAY)/);
  assert.match(generationRoute, /process\.env\.OPENAI_API_KEY/);
  assert.match(generationRoute, /loadCachedAtlas/);
  assert.match(generationRoute, /saveAtlasToGallery/);
  assert.match(generationRoute, /application\/x-ndjson/);
  assert.match(generationRoute, /Source ·/);
  assert.match(generationRoute, /vendor-neutral reference architecture/);
  assert.match(generationRoute, /data-center atlas/);
  assert.match(generationRoute, /connections to explain architecture/);
  assert.match(generationRoute, /maxItems: 60/);
  assert.match(generationRoute, /maxDuration = 800/);
  assert.match(generationRoute, /headersTimeout: 780_000/);
  assert.match(generationRoute, /background: true/);
  assert.match(generationRoute, /responses\/\$\{encodeURIComponent\(responseId\)\}/);
  assert.match(generationRoute, /gpt-5\.6-terra/);
  assert.match(generationRoute, /gpt-5\.6-luna/);
  assert.match(generationRoute, /retrying automatically/);
  assert.match(generationRoute, /forensic component-supply-chain researcher/);
  assert.match(generationRoute, /Supplier evidence pass/);
  assert.match(generationRoute, /Coverage is an audit ledger/);
  assert.match(generationRoute, /const batchSize = 6/);
  assert.match(generationRoute, /ip-licensor/);
  assert.match(galleryRoute, /ATLAS_CACHE_ORIGIN/);
  assert.match(store, /@vercel\/blob/);
  assert.match(store, /cacheKeyForPrompt/);
  assert.match(store, /CURRENT_INTELLIGENCE_VERSION/);
  assert.match(page, /scrollIntoView/);
  assert.match(page, /foundry-build-journal/);
  assert.match(page, /COMPONENT AUDIT/);
  assert.match(page, /Open evidence for/);
  assert.match(page, /RESEARCH REFRESH/);
  assert.match(page, /foundry-connection-lines/);
});
