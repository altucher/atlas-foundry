import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { list, put } from '@vercel/blob';

const analyticsPrefix = 'atlas-foundry/analytics/v1';
const adminCookieName = 'atlas_analytics_admin';
const maxPropertyLength = 240;

export const analyticsEventNames = [
  'page_view',
  'click',
  'query_submit',
  'atlas_result',
  'gallery_open',
  'component_select',
  'vendor_select',
  'filter_change',
  'explosion_change',
] as const;

export type AnalyticsEventName = (typeof analyticsEventNames)[number];

export type AnalyticsEvent = {
  id: string;
  timestamp: string;
  event: AnalyticsEventName;
  sessionId: string;
  visitorId: string;
  path: string;
  country: string;
  region: string;
  city: string;
  device: string;
  browser: string;
  properties: Record<string, string | number | boolean>;
};

type EncryptedEvent = { v: 1; iv: string; tag: string; data: string };

function analyticsSecret() {
  return process.env.ANALYTICS_ADMIN_PASSWORD?.trim() ?? '';
}

export function analyticsConfigured() {
  return Boolean(analyticsSecret() && (process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN));
}

function deriveKey(secret: string) {
  return createHash('sha256').update(`atlas-foundry-events:${secret}`).digest();
}

function encryptEvent(event: AnalyticsEvent, secret: string): EncryptedEvent {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(event), 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: encrypted.toString('base64url'),
  };
}

function decryptEvent(payload: EncryptedEvent, secret: string): AnalyticsEvent | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(payload.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64url')), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8')) as AnalyticsEvent;
  } catch {
    return null;
  }
}

function cleanScalar(value: unknown): string | number | boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return value.trim().slice(0, maxPropertyLength);
  return null;
}

function cleanProperties(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 16).flatMap(([key, raw]) => {
    const cleaned = cleanScalar(raw);
    return cleaned === null ? [] : [[key.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48), cleaned] as const];
  });
  return Object.fromEntries(entries);
}

function cleanId(value: unknown) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value) ? value : '';
}

function userAgentSummary(userAgent: string) {
  const device = /ipad|tablet/i.test(userAgent) ? 'Tablet' : /mobile|iphone|android/i.test(userAgent) ? 'Mobile' : 'Desktop';
  const browser = /edg\//i.test(userAgent) ? 'Edge' : /firefox\//i.test(userAgent) ? 'Firefox' : /chrome\//i.test(userAgent) ? 'Chrome' : /safari\//i.test(userAgent) ? 'Safari' : 'Other';
  return { device, browser };
}

export async function recordAnalyticsEvent(body: Record<string, unknown>, headers: Headers) {
  const secret = analyticsSecret();
  if (!secret || !analyticsConfigured()) return false;
  const event = typeof body.event === 'string' && analyticsEventNames.includes(body.event as AnalyticsEventName)
    ? body.event as AnalyticsEventName
    : null;
  const sessionId = cleanId(body.sessionId);
  const visitorId = cleanId(body.visitorId);
  if (!event || !sessionId || !visitorId) return false;
  const userAgent = userAgentSummary(headers.get('user-agent') ?? '');
  const timestamp = new Date().toISOString();
  const record: AnalyticsEvent = {
    id: randomUUID(),
    timestamp,
    event,
    sessionId,
    visitorId,
    path: typeof body.path === 'string' && body.path.startsWith('/') ? body.path.slice(0, 180) : '/',
    country: (headers.get('x-vercel-ip-country') ?? 'Unknown').slice(0, 60),
    region: (headers.get('x-vercel-ip-country-region') ?? '').slice(0, 80),
    city: decodeURIComponent(headers.get('x-vercel-ip-city') ?? '').slice(0, 80),
    device: userAgent.device,
    browser: userAgent.browser,
    properties: cleanProperties(body.properties),
  };
  const day = timestamp.slice(0, 10).replaceAll('-', '/');
  await put(`${analyticsPrefix}/${day}/${Date.now()}-${record.id}.json.enc`, JSON.stringify(encryptEvent(record, secret)), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: 'application/octet-stream',
    cacheControlMaxAge: 31_536_000,
  });
  return true;
}

export function expectedAdminCookie() {
  const secret = analyticsSecret();
  return secret ? createHmac('sha256', secret).update('atlas-foundry-admin-session-v1').digest('base64url') : '';
}

export function validAdminCookie(value?: string) {
  const expected = expectedAdminCookie();
  if (!value || !expected) return false;
  const supplied = Buffer.from(value);
  const target = Buffer.from(expected);
  return supplied.length === target.length && timingSafeEqual(supplied, target);
}

export function validAdminPassword(value: string) {
  const secret = analyticsSecret();
  if (!secret) return false;
  const supplied = createHash('sha256').update(value).digest();
  const target = createHash('sha256').update(secret).digest();
  return timingSafeEqual(supplied, target);
}

export { adminCookieName };

export async function readAnalyticsEvents(maxEvents = 10_000) {
  const secret = analyticsSecret();
  if (!secret || !analyticsConfigured()) return [];
  const blobs: Array<{ url: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `${analyticsPrefix}/`, limit: Math.min(1000, maxEvents - blobs.length), cursor });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && blobs.length < maxEvents);

  const events: AnalyticsEvent[] = [];
  for (let index = 0; index < blobs.length; index += 40) {
    const batch = await Promise.all(blobs.slice(index, index + 40).map(async (blob) => {
      try {
        const response = await fetch(blob.url, { cache: 'no-store' });
        if (!response.ok) return null;
        return decryptEvent(await response.json() as EncryptedEvent, secret);
      } catch {
        return null;
      }
    }));
    events.push(...batch.filter((event): event is AnalyticsEvent => Boolean(event)));
  }
  return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
