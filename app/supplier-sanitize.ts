// A salvaged or repaired model reply can carry null / non-object entries inside the supplier-audit arrays (the gateway fixes a missing value by writing null). One such entry used to crash the whole enrichment
// ("Cannot read properties of null (reading 'partId')") and the user got an atlas without suppliers. The arrays are cleaned before anything reads them.

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function sanitizeSupplierResult<T extends { relationships?: unknown; coverage?: unknown; sources?: unknown }>(raw: T): T {
  const objects = (value: unknown) => (Array.isArray(value) ? value.filter(isObject) : []);
  return {
    ...raw,
    relationships: objects(raw.relationships).filter((entry) => typeof entry.partId === 'string' && typeof entry.company === 'string'),
    coverage: objects(raw.coverage).filter((entry) => typeof entry.partId === 'string'),
    sources: objects(raw.sources),
  };
}
