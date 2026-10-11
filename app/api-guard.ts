// REQUEST GUARDS for the paid generation route (AI2 2026-10-11).
// - adminAuthorized: X-Atlas-Admin must equal ATLAS_ADMIN_SECRET (16+ chars). Without the env var every admin-only header is ignored.
// - clientId: the caller's address from headers Vercel sets itself (x-vercel-forwarded-for, x-real-ip); x-forwarded-for and cf-connecting-ip can be forged by a caller
//   outside Cloudflare, so they are only a last resort off Vercel.
// - hitLimit: a fixed-window counter kept in the shared blob store, so the limit holds across serverless instances (the old limiter was an in-memory Map per
//   instance and never saw the enrich phase). The read-modify-write is not atomic: two simultaneous requests can both pass, so a limit may be exceeded by
//   the number of concurrent callers; it cannot be bypassed by landing on another instance. The in-memory counter stays as a second, per-instance check.
import { createHash, timingSafeEqual } from 'node:crypto';

import { head, put } from '@vercel/blob';

import { galleryRoot, hasSharedAtlasStore } from '@/app/atlas-store';

export function adminAuthorized(request: Request) {
  const secret = process.env.ATLAS_ADMIN_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  const given = request.headers.get('x-atlas-admin') ?? '';
  return timingSafeEqual(createHash('sha256').update(secret).digest(), createHash('sha256').update(given).digest());
}

export function clientId(request: Request) {
  const vercel = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
  if (vercel) return vercel;
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || 'local';
}

type Counter = { windowStart: number; count: number };
const memory = new Map<string, Counter>();

function counterPath(bucket: string, id: string) {
  const digest = createHash('sha256').update(`${bucket}:${id}`).digest('hex').slice(0, 40);
  return `${galleryRoot()}/_limits/${bucket}/${digest}.json`;
}

async function readCounter(path: string): Promise<Counter | null> {
  try {
    const blob = await head(path);
    const response = await fetch(blob.url, { cache: 'no-store' });
    if (!response.ok) return null;
    const value = await response.json() as Counter;
    return typeof value?.windowStart === 'number' && typeof value?.count === 'number' ? value : null;
  } catch {
    return null;
  }
}

export type LimitResult = { ok: boolean; count: number; limit: number; retryAfterSec: number };

export async function hitLimit({ bucket, id, limit, windowMs, now = Date.now() }: { bucket: string; id: string; limit: number; windowMs: number; now?: number }): Promise<LimitResult> {
  const key = `${bucket}:${id}`;
  const local = memory.get(key);
  const localCounter: Counter = local && now - local.windowStart < windowMs ? local : { windowStart: now, count: 0 };
  let counter = localCounter;
  const path = hasSharedAtlasStore() ? counterPath(bucket, id) : null;
  if (path) {
    const stored = await readCounter(path);
    if (stored && now - stored.windowStart < windowMs && stored.count > counter.count) counter = stored;
  }
  if (counter.count >= limit) {
    memory.set(key, counter);
    return { ok: false, count: counter.count, limit, retryAfterSec: Math.max(1, Math.ceil((counter.windowStart + windowMs - now) / 1000)) };
  }
  const next: Counter = { windowStart: counter.windowStart, count: counter.count + 1 };
  memory.set(key, next);
  if (path) {
    try {
      await put(path, JSON.stringify(next), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 1 });
    } catch (error) {
      console.warn('Durable rate limit write failed; the per-instance count still applies', error instanceof Error ? error.message : error);
    }
  }
  return { ok: true, count: next.count, limit, retryAfterSec: 0 };
}

export function dayBucket(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}
