import { head, list, put, type ListBlobResultBlob } from '@vercel/blob';

import { CURRENT_INTELLIGENCE_VERSION, type AtlasGalleryItem, type FoundryAtlas } from './foundry-data';

const galleryPrefix = 'atlas-foundry/v1';
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
  return `${galleryPrefix}/${cacheKey}/atlas.json`;
}

function draftPath(cacheKey: string) {
  return `${galleryPrefix}/${cacheKey}/draft.json`;
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

export async function loadGalleryAtlas(cacheKey: string) {
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
  const blob = await put(`${galleryPrefix}/${cacheKey}/${kind}.${extension}`, decoded.bytes, {
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

export async function listGalleryAtlases() {
  if (!hasSharedAtlasStore()) return [];
  const blobs: ListBlobResultBlob[] = [];
  let cursor: string | undefined;
  do {
    const result = await list({ prefix: `${galleryPrefix}/`, limit: 1000, cursor });
    blobs.push(...result.blobs);
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);

  const recordsByKey = new Map<string, ListBlobResultBlob>();
  for (const blob of blobs) {
    if (!blob.pathname.endsWith('/atlas.json') && !blob.pathname.endsWith('/draft.json')) continue;
    const pathParts = blob.pathname.split('/');
    const cacheKey = pathParts[pathParts.length - 2];
    if (!cacheKey) continue;
    const current = recordsByKey.get(cacheKey);
    const isComplete = blob.pathname.endsWith('/atlas.json');
    const currentIsComplete = current?.pathname.endsWith('/atlas.json') ?? false;
    if (!current || (isComplete && !currentIsComplete) || (isComplete === currentIsComplete && blob.uploadedAt > current.uploadedAt)) {
      recordsByKey.set(cacheKey, blob);
    }
  }

  const records = [...recordsByKey.values()];
  const atlases = await Promise.all(records.map(async (blob) => {
    const atlas = await readAtlasUrl(blob.url);
    const pathParts = blob.pathname.split('/');
    const fallbackKey = pathParts[pathParts.length - 2] ?? 'atlas';
    return atlas && hasGeneratedImagePair(atlas)
      ? { item: galleryItem(atlas, fallbackKey), uploadedAt: blob.uploadedAt }
      : null;
  }));
  const sorted = atlases
    .filter((record): record is NonNullable<typeof record> => Boolean(record))
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  const seenSubjects = new Set<string>();
  return sorted.flatMap((record) => {
    const subjectKey = cacheKeyForPrompt(record.item.subject);
    if (seenSubjects.has(subjectKey)) return [];
    seenSubjects.add(subjectKey);
    return [record.item];
  });
}
