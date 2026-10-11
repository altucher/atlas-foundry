// EMBED BRIDGE (AI2 2026-10-11): messages from the embedded viewer (/embed) to the page that frames it (the TAO-1 chat). Contract (docs/EMBED_CONTRACT.md):
//   { source: 'explode-anything', version: 1, type: 'explode:ready' | 'explode:height' | 'explode:build-progress' | 'explode:done' | 'explode:error', key, parts, ... }
// The parent origin is read from location.ancestorOrigins (Chrome, Safari) or document.referrer and must be on the allow-list, otherwise nothing is sent.
const defaultParents = ['https://tao1.ai', 'https://www.tao1.ai', 'https://jtao.ai', 'https://www.jtao.ai'];

export function allowedParents() {
  const extra = (process.env.NEXT_PUBLIC_ATLAS_EMBED_ORIGINS ?? '').split(/[\s,]+/).filter((origin) => /^https:\/\/[a-z0-9.-]+$/i.test(origin));
  return [...defaultParents, ...extra];
}

export function parentOrigin(): string | null {
  if (typeof window === 'undefined' || window.parent === window) return null;
  const candidates: string[] = [];
  const ancestors = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  if (ancestors && ancestors.length) candidates.push(ancestors[0]);
  try { if (document.referrer) candidates.push(new URL(document.referrer).origin); } catch { /* no usable referrer */ }
  const allowed = allowedParents();
  return candidates.find((origin) => allowed.includes(origin)) ?? null;
}

export function postToParent(type: string, payload: Record<string, unknown> = {}) {
  const target = parentOrigin();
  if (!target) return false;
  window.parent.postMessage({ source: 'explode-anything', version: 1, type, ...payload }, target);
  return true;
}
