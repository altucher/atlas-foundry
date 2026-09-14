import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';

import { adminCookieName, analyticsConfigured, readAnalyticsEvents, validAdminCookie, type AnalyticsEvent } from '@/app/analytics';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Private Analytics — Explode Anything',
  robots: { index: false, follow: false, nocache: true },
};

function ranked(events: AnalyticsEvent[], key: (event: AnalyticsEvent) => string, limit = 12) {
  const counts = new Map<string, number>();
  for (const event of events) {
    const value = key(event).trim();
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function prop(event: AnalyticsEvent, key: string) {
  const value = event.properties[key];
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string; error?: string }> }) {
  const query = await searchParams;
  const cookieStore = await cookies();
  const authenticated = validAdminCookie(cookieStore.get(adminCookieName)?.value);

  if (!authenticated) {
    return (
      <main className="analytics-login" data-analytics-private="true">
        <section>
          <span>EXPLODE ANYTHING / PRIVATE</span>
          <h1>Analytics access</h1>
          <p>{analyticsConfigured() ? 'Enter the private admin password to view visitor behavior and research demand.' : 'Analytics is locked until ANALYTICS_ADMIN_PASSWORD is configured on the server.'}</p>
          <form action="/api/analytics/login" method="post">
            <label htmlFor="analytics-password">Admin password</label>
            <input id="analytics-password" name="password" type="password" autoComplete="current-password" required disabled={!analyticsConfigured()} />
            {query.error ? <small>That password was not accepted.</small> : null}
            <button type="submit" disabled={!analyticsConfigured()}>Open dashboard</button>
          </form>
          <Link href="/">Return to Explode Anything</Link>
        </section>
      </main>
    );
  }

  const requestedDays = Number(query.days ?? 30);
  const days = [7, 30, 90, 3650].includes(requestedDays) ? requestedDays : 30;
  const since = Date.now() - days * 86_400_000;
  const events = (await readAnalyticsEvents()).filter((event) => new Date(event.timestamp).getTime() >= since);
  const pageViews = events.filter((event) => event.event === 'page_view');
  const clicks = events.filter((event) => event.event === 'click');
  const queries = events.filter((event) => event.event === 'query_submit');
  const results = events.filter((event) => event.event === 'atlas_result');
  const visitors = new Set(events.map((event) => event.visitorId)).size;
  const sessions = new Set(events.map((event) => event.sessionId)).size;
  const successfulResults = results.filter((event) => prop(event, 'status') === 'success').length;
  const querySuccess = results.length ? Math.round(successfulResults / results.length * 100) : 0;
  const topQueries = ranked(queries, (event) => prop(event, 'query'));
  const topClicks = ranked(clicks, (event) => prop(event, 'label'));
  const topAtlases = ranked(events.filter((event) => ['gallery_open', 'component_select'].includes(event.event)), (event) => prop(event, 'atlas'));
  const topComponents = ranked(events.filter((event) => event.event === 'component_select'), (event) => `${prop(event, 'atlas')} · ${prop(event, 'component')}`);
  const topVendors = ranked(events.filter((event) => event.event === 'vendor_select'), (event) => prop(event, 'vendor'));
  const countries = ranked(events, (event) => event.country, 8);
  const devices = ranked(pageViews, (event) => event.device, 4);
  const recentQueries = queries.slice(0, 50);
  const chartDays = Math.min(days, 30);
  const daily = Array.from({ length: chartDays }, (_, offset) => {
    const date = new Date(Date.now() - (chartDays - offset - 1) * 86_400_000).toISOString().slice(0, 10);
    return { date, views: pageViews.filter((event) => event.timestamp.startsWith(date)).length, queries: queries.filter((event) => event.timestamp.startsWith(date)).length };
  });
  const chartMax = Math.max(1, ...daily.flatMap((day) => [day.views, day.queries]));

  return (
    <main className="analytics-shell" data-analytics-private="true">
      <header className="analytics-head">
        <div><span>EXPLODE ANYTHING / PRIVATE</span><h1>Audience intelligence</h1><p>Anonymous product usage, research demand, and interaction behavior.</p></div>
        <div className="analytics-actions"><Link href="/">Open site</Link><form action="/api/analytics/logout" method="post"><button type="submit">Sign out</button></form></div>
      </header>

      <nav className="analytics-range" aria-label="Analytics date range">
        {[7, 30, 90, 3650].map((range) => <Link className={days === range ? 'active' : ''} href={`/analytics?days=${range}`} key={range}>{range === 3650 ? 'All time' : `${range} days`}</Link>)}
      </nav>

      <section className="analytics-metrics">
        <article><span>PAGE VIEWS</span><strong>{pageViews.length.toLocaleString()}</strong></article>
        <article><span>VISITORS</span><strong>{visitors.toLocaleString()}</strong></article>
        <article><span>SESSIONS</span><strong>{sessions.toLocaleString()}</strong></article>
        <article><span>QUERIES</span><strong>{queries.length.toLocaleString()}</strong></article>
        <article><span>CLICKS</span><strong>{clicks.length.toLocaleString()}</strong></article>
        <article><span>BUILD SUCCESS</span><strong>{querySuccess}%</strong></article>
      </section>

      <section className="analytics-chart-panel">
        <div className="analytics-section-title"><span>ACTIVITY</span><small><i /> PAGE VIEWS <i /> QUERIES</small></div>
        <div className="analytics-chart">
          {daily.map((day) => <div className="analytics-day" key={day.date} title={`${day.date}: ${day.views} views, ${day.queries} queries`}><div><i style={{ height: `${day.views / chartMax * 100}%` }} /><i style={{ height: `${day.queries / chartMax * 100}%` }} /></div><small>{day.date.slice(5)}</small></div>)}
        </div>
      </section>

      <section className="analytics-grid">
        <Rank title="TOP QUERIES" rows={topQueries} empty="No searches yet." />
        <Rank title="MOST-OPENED ATLASES" rows={topAtlases} empty="No atlas opens yet." />
        <Rank title="MOST-CLICKED COMPONENTS" rows={topComponents} empty="No component clicks yet." />
        <Rank title="VENDOR INTEREST" rows={topVendors} empty="No vendor clicks yet." />
        <Rank title="CLICK TARGETS" rows={topClicks} empty="No clicks yet." />
        <Rank title="COUNTRIES" rows={countries} empty="No location data yet." />
        <Rank title="DEVICES" rows={devices} empty="No device data yet." />
      </section>

      <section className="analytics-table-panel">
        <div className="analytics-section-title"><span>RECENT QUERIES</span><small>Exact submitted text</small></div>
        <div className="analytics-table-wrap"><table><thead><tr><th>Time</th><th>Query</th><th>Page</th><th>Country</th><th>Device</th></tr></thead><tbody>
          {recentQueries.length ? recentQueries.map((event) => <tr key={event.id}><td>{dateLabel(event.timestamp)}</td><td>{prop(event, 'query')}</td><td>{event.path}</td><td>{event.country}{event.city ? ` · ${event.city}` : ''}</td><td>{event.device}</td></tr>) : <tr><td colSpan={5}>No queries have been collected in this range.</td></tr>}
        </tbody></table></div>
      </section>

      <footer className="analytics-foot">No names or raw IP addresses are stored. Visitor and session identifiers are random browser IDs. Event payloads are encrypted before being written to Blob storage.</footer>
    </main>
  );
}

function Rank({ title, rows, empty }: { title: string; rows: Array<[string, number]>; empty: string }) {
  const max = Math.max(1, ...rows.map(([, count]) => count));
  return <article className="analytics-rank"><div className="analytics-section-title"><span>{title}</span></div>{rows.length ? rows.map(([label, count]) => <div className="analytics-rank-row" key={label}><div><span>{label}</span><i style={{ width: `${count / max * 100}%` }} /></div><strong>{count}</strong></div>) : <p>{empty}</p>}</article>;
}
