'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

export type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;

function browserId(storage: Storage, key: string) {
  const current = storage.getItem(key);
  if (current) return current;
  const value = crypto.randomUUID();
  storage.setItem(key, value);
  return value;
}

export function trackAnalytics(event: string, properties: AnalyticsProperties = {}) {
  if (typeof window === 'undefined') return;
  const payload = JSON.stringify({
    event,
    sessionId: browserId(window.sessionStorage, 'atlas_session_id'),
    visitorId: browserId(window.localStorage, 'atlas_visitor_id'),
    path: window.location.pathname,
    properties: {
      ...properties,
      viewport: window.innerWidth < 760 ? 'mobile' : window.innerWidth < 1100 ? 'tablet' : 'desktop',
    },
  });
  void fetch('/api/analytics/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => undefined);
}

export default function AnalyticsClient() {
  const pathname = usePathname();
  const lastPath = useRef('');

  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    let referrer = '';
    try {
      referrer = document.referrer ? new URL(document.referrer).hostname : '';
    } catch {
      referrer = '';
    }
    trackAnalytics('page_view', { referrer });
  }, [pathname]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('a,button') : null;
      if (!target || target.closest('[data-analytics-private="true"]')) return;
      const label = (target.getAttribute('data-analytics-label') || target.getAttribute('aria-label') || target.textContent || target.tagName)
        .replace(/\s+/g, ' ').trim().slice(0, 160);
      const section = target.closest('[aria-label],section,aside')?.getAttribute('aria-label') ?? '';
      const href = target instanceof HTMLAnchorElement ? target.href : '';
      trackAnalytics('click', { label, section, href: href ? new URL(href).hostname : '', element: target.tagName.toLowerCase() });
    };
    document.addEventListener('click', handleClick, { capture: true });
    return () => document.removeEventListener('click', handleClick, { capture: true });
  }, []);

  return null;
}
