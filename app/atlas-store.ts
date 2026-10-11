import { head, list, put, type ListBlobResultBlob } from '@vercel/blob';

import { CURRENT_INTELLIGENCE_VERSION, type AtlasGalleryItem, type FoundryAtlas } from './foundry-data';

const defaultGalleryPrefix = 'atlas-foundry/v1';
// ATLAS_GALLERY_PREFIX lets a preview or test deployment write to its own area of the shared blob store (never the production prefix).
export function galleryRoot() {
  const configured = process.env.ATLAS_GALLERY_PREFIX?.trim();
  return configured && /^[a-z0-9][a-z0-9/_-]{2,60}$/.test(configured) && !configured.includes('//') ? configured.replace(/\/+$/, '') : defaultGalleryPrefix;
}
const numberWords: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
};

export function cacheKeyForPrompt(prompt: string) {
  const normalized = prompt
    .normalize('NFKD')
    .toLowerCase()
    .replace(/^\s*(?:a|an|the)\s+/, '')
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (word) => numberWords[word] ?? word)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  if (normalized === 'data-center' || normalized === 'data-centers') return 'data-center';
  if (normalized === 'falcon-9' || normalized === 'spacex-falcon-9') return 'falcon-9';
  if (normalized === '8-mattress' || normalized === '8-sleep-mattress') return 'eight-sleep-mattress';
  if (normalized === 'mac-512k') return 'macintosh-512k';
  return normalized || 'atlas';
}

export function hasSharedAtlasStore() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN);
}

function atlasPath(cacheKey: string) {
  return `${galleryRoot()}/${cacheKey}/atlas.json`;
}

function draftPath(cacheKey: string) {
  return `${galleryRoot()}/${cacheKey}/draft.json`;
}

function isFoundryAtlas(value: unknown): value is FoundryAtlas {
  if (!value || typeof value !== 'object') return false;
  const atlas = value as Partial<FoundryAtlas>;
  return typeof atlas.subject === 'string'
    && Array.isArray(atlas.parts)
    && Array.isArray(atlas.sources)
    && (atlas.imageOrientation === 'landscape' || atlas.imageOrientation === 'portrait');
}

async function readAtlasUrl(url: string) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) return null;
  const value = await response.json() as unknown;
  return isFoundryAtlas(value) ? value : null;
}

export async function loadCachedAtlas(cacheKey: string) {
  if (!hasSharedAtlasStore()) return null;
  const candidateKeys = cacheKey === 'falcon-9'
    ? ['falcon-9', 'falcon-9-block-5-launch-vehicle']
    : [cacheKey];
  for (const candidateKey of candidateKeys) {
    try {
      const blob = await head(atlasPath(candidateKey));
      const atlas = await readAtlasUrl(blob.url);
      if (atlas) return atlas;
    } catch {
      // Continue through any known legacy keys before reporting a miss.
    }
  }
  return null;
}

export async function loadAtlasDraft(cacheKey: string) {
  if (!hasSharedAtlasStore()) return null;
  try {
    const blob = await head(draftPath(cacheKey));
    return await readAtlasUrl(blob.url);
  } catch {
    return null;
  }
}

export function isSafeCacheKey(value: string) {
  return /^[a-z0-9][a-z0-9-]{0,95}$/.test(value);
}

export async function loadGalleryAtlas(cacheKey: string) {
  if (!isSafeCacheKey(cacheKey)) return null;
  return await loadCachedAtlas(cacheKey) ?? await loadAtlasDraft(cacheKey);
}

function decodeDataImage(value: string) {
  const match = /^data:(image\/(?:webp|png|jpeg));base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if (!match) return null;
  return { contentType: match[1], bytes: Buffer.from(match[2], 'base64') };
}

async function persistImage(cacheKey: string, kind: 'assembled' | 'exploded', value?: string) {
  if (!value) return undefined;
  const decoded = decodeDataImage(value);
  if (!decoded) return value;
  const extension = decoded.contentType === 'image/jpeg' ? 'jpg' : decoded.contentType.split('/')[1];
  const blob = await put(`${galleryRoot()}/${cacheKey}/${kind}.${extension}`, decoded.bytes, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: decoded.contentType,
    cacheControlMaxAge: 31_536_000,
  });
  return blob.url;
}

export async function saveAtlasToGallery(atlas: FoundryAtlas, prompt: string) {
  if (!hasSharedAtlasStore()) return atlas;
  const cacheKey = cacheKeyForPrompt(prompt);
  const [image, explodedImage] = await Promise.all([
    persistImage(cacheKey, 'assembled', atlas.image),
    persistImage(cacheKey, 'exploded', atlas.explodedImage),
  ]);
  const persisted: FoundryAtlas = { ...atlas, intelligenceVersion: CURRENT_INTELLIGENCE_VERSION, cacheKey, image, explodedImage, buildStage: 'complete' };
  await put(atlasPath(cacheKey), JSON.stringify(persisted), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
  });
  await refreshGalleryIndex().catch((error) => console.warn('Gallery index refresh after save failed', error instanceof Error ? error.message : error));
  return persisted;
}

export async function saveAtlasDraft(atlas: FoundryAtlas, prompt: string) {
  if (!hasSharedAtlasStore()) return { ...atlas, cacheKey: cacheKeyForPrompt(prompt), buildStage: 'draft' as const };
  const cacheKey = cacheKeyForPrompt(prompt);
  const [image, explodedImage] = await Promise.all([
    persistImage(cacheKey, 'assembled', atlas.image),
    persistImage(cacheKey, 'exploded', atlas.explodedImage),
  ]);
  const persisted: FoundryAtlas = { ...atlas, cacheKey, image, explodedImage, buildStage: 'draft' };
  await put(draftPath(cacheKey), JSON.stringify(persisted), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
  });
  return persisted;
}

function galleryItem(atlas: FoundryAtlas, fallbackKey: string): AtlasGalleryItem {
  const suppliers = new Set(atlas.parts.flatMap((part) => (part.suppliers ?? []).map((supplier) => supplier.company.toLowerCase())));
  return {
    intelligenceVersion: atlas.intelligenceVersion,
    cacheKey: atlas.cacheKey ?? fallbackKey,
    subject: atlas.subject,
    subtitle: atlas.subtitle,
    category: atlas.category,
    image: atlas.image,
    explodedImage: atlas.explodedImage,
    imageOrientation: atlas.imageOrientation,
    partCount: atlas.parts.length,
    supplierCount: suppliers.size,
    generatedAt: atlas.generatedAt,
  };
}

function hasGeneratedImagePair(atlas: FoundryAtlas) {
  return Boolean(atlas.image?.trim() && atlas.explodedImage?.trim());
}

// THE GALLERY LIST (AI2 2026-10-11): the old list fetched every saved atlas.json at once (about 250 files), ran out of sockets (EMFILE) and returned 503 for the
// whole gallery. Now: the list reads ONE small index blob (items plus a signature per source file), a rebuild fetches only new or changed files with bounded
// concurrency, one bad file is skipped instead of failing the list, and a stale index is served if a rebuild fails.
type GalleryIndexEntry = { sig: string; uploadedAt: string; item: AtlasGalleryItem };
type GalleryIndex = { builtAt: string; entries: GalleryIndexEntry[] };
const galleryIndexFreshMs = 10 * 60 * 1000;
const galleryMemoryMs = 60 * 1000;
let galleryMemory: { at: number; items: AtlasGalleryItem[] } | null = null;
let galleryRebuild: Promise<AtlasGalleryItem[]> | null = null;

function galleryIndexPath() {
  return `${galleryRoot()}/_index/gallery.json`;
}

async function readGalleryIndex(): Promise<GalleryIndex | null> {
  try {
    const blob = await head(galleryIndexPath());
    const response = await fetch(blob.url, { cache: 'no-store' });
    if (!response.ok) return null;
    const value = await response.json() as GalleryIndex;
    return value && Array.isArray(value.entries) && typeof value.builtAt === 'string' ? value : null;
  } catch {
    return null;
  }
}

async function mapWithLimit<T, R>(values: T[], limit: number, work: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await work(values[index]);
    }
  }));
  return results;
}

function itemsFromEntries(entries: GalleryIndexEntry[]) {
  const sorted = [...entries].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  const seenSubjects = new Set<string>();
  return sorted.flatMap((entry) => {
    const subjectKey = cacheKeyForPrompt(entry.item.subject);
    if (seenSubjects.has(subjectKey)) return [];
    seenSubjects.add(subjectKey);
    return [entry.item];
  });
}

async function rebuildGalleryIndex(previous: GalleryIndex | null): Promise<AtlasGalleryItem[]> {
  const blobs: ListBlobResultBlob[] = [];
  let cursor: string | undefined;
  do {
    const result = await list({ prefix: `${galleryRoot()}/`, limit: 1000, cursor });
    blobs.push(...result.blobs);
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);

  const recordsByKey = new Map<string, ListBlobResultBlob>();
  for (const blob of blobs) {
    if (!blob.pathname.endsWith('/atlas.json') && !blob.pathname.endsWith('/draft.json')) continue;
    const pathParts = blob.pathname.split('/');
    const cacheKey = pathParts[pathParts.length - 2];
    if (!cacheKey || cacheKey.startsWith('_')) continue;
    const current = recordsByKey.get(cacheKey);
    const isComplete = blob.pathname.endsWith('/atlas.json');
    const currentIsComplete = current?.pathname.endsWith('/atlas.json') ?? false;
    if (!current || (isComplete && !currentIsComplete) || (isComplete === currentIsComplete && blob.uploadedAt > current.uploadedAt)) {
      recordsByKey.set(cacheKey, blob);
    }
  }

  const known = new Map((previous?.entries ?? []).map((entry) => [entry.sig, entry]));
  const entries: GalleryIndexEntry[] = [];
  const toFetch: Array<{ blob: ListBlobResultBlob; sig: string }> = [];
  for (const blob of recordsByKey.values()) {
    const sig = `${blob.pathname}@${blob.uploadedAt.toISOString()}`;
    const reuse = known.get(sig);
    if (reuse) entries.push(reuse);
    else toFetch.push({ blob, sig });
  }
  const fetched = await mapWithLimit(toFetch, 6, async ({ blob, sig }) => {
    try {
      const atlas = await readAtlasUrl(blob.url);
      const fallbackKey = blob.pathname.split('/').slice(-2)[0] ?? 'atlas';
      return atlas && hasGeneratedImagePair(atlas)
        ? { sig, uploadedAt: blob.uploadedAt.toISOString(), item: galleryItem(atlas, fallbackKey) }
        : null;
    } catch (error) {
      console.warn('Gallery record skipped', blob.pathname, error instanceof Error ? error.message : error);
      return null;
    }
  });
  for (const entry of fetched) if (entry) entries.push(entry);

  try {
    await put(galleryIndexPath(), JSON.stringify({ builtAt: new Date().toISOString(), entries } satisfies GalleryIndex), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      cacheControlMaxAge: 60,
    });
  } catch (error) {
    console.warn('Gallery index was not saved', error instanceof Error ? error.message : error);
  }
  return itemsFromEntries(entries);
}

export async function refreshGalleryIndex() {
  if (!hasSharedAtlasStore()) return [];
  galleryRebuild ??= (async () => {
    try {
      const items = await rebuildGalleryIndex(await readGalleryIndex());
      galleryMemory = { at: Date.now(), items };
      return items;
    } finally {
      galleryRebuild = null;
    }
  })();
  return galleryRebuild;
}

export async function listGalleryAtlases() {
  if (!hasSharedAtlasStore()) return [];
  if (galleryMemory && Date.now() - galleryMemory.at < galleryMemoryMs) return galleryMemory.items;
  const index = await readGalleryIndex();
  if (index && Date.now() - Date.parse(index.builtAt) < galleryIndexFreshMs) {
    const items = itemsFromEntries(index.entries);
    galleryMemory = { at: Date.now(), items };
    return items;
  }
  try {
    return await refreshGalleryIndex();
  } catch (error) {
    console.error('Gallery rebuild failed', error);
    if (index) return itemsFromEntries(index.entries);
    throw error;
  }
}
