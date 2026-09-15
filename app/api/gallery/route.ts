import { NextResponse } from 'next/server';

import { cacheKeyForPrompt, hasSharedAtlasStore, listGalleryAtlases, loadGalleryAtlas } from '@/app/atlas-store';

export const runtime = 'nodejs';

function remoteGalleryUrl(request: Request) {
  const configured = process.env.ATLAS_CACHE_ORIGIN?.trim();
  if (!configured || hasSharedAtlasStore()) return null;
  try {
    const target = new URL('/api/gallery', configured);
    const current = new URL(request.url);
    if (target.origin === current.origin) return null;
    target.search = current.search;
    return target;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const remote = remoteGalleryUrl(request);
  if (remote) {
    const response = await fetch(remote, { cache: 'no-store' });
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  try {
    const url = new URL(request.url);
    const key = url.searchParams.get('key')?.trim();
    const prompt = url.searchParams.get('prompt')?.trim();
    if (key || prompt) {
      const atlas = await loadGalleryAtlas(key || cacheKeyForPrompt(prompt ?? ''));
      if (!atlas) return NextResponse.json({ error: 'Atlas not found in the shared gallery.' }, { status: 404 });
      return NextResponse.json({ atlas, cached: true }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    const items = await listGalleryAtlases();
    return NextResponse.json({ items }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Gallery lookup failed', error);
    return NextResponse.json({ items: [], error: 'The shared gallery is temporarily unavailable.' }, { status: 503 });
  }
}
