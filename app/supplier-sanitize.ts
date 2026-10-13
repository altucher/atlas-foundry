// A salvaged or repaired model reply can carry null / non-object entries inside the supplier-audit arrays (the gateway fixes a missing value by writing null). One such entry used to crash the whole enrichment
// ("Cannot read properties of null (reading 'partId')") and the user got an atlas without suppliers. The arrays are cleaned before anything reads them.

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown) => (typeof value === 'string' ? value : '');

export function sanitizeSupplierResult<T extends { relationships?: unknown; coverage?: unknown; sources?: unknown }>(raw: T): T {
  const objects = (value: unknown) => (Array.isArray(value) ? value.filter(isObject) : []);
  // a cheaper cell can return entries with missing text fields (witness 10-13: qwen3.8-27b, "Cannot read properties of undefined (reading 'slice')" killed the whole enrichment): every field the normaliser reads
  // as text is coerced to a string, entries that cannot work without a field are dropped
  const relationships = objects(raw.relationships)
    .filter((entry) => typeof entry.partId === 'string' && typeof entry.company === 'string' && entry.company.trim() && typeof entry.evidenceUrl === 'string' && typeof entry.relationshipStatus === 'string')
    .map((entry) => ({ ...entry, role: text(entry.role) || 'other', note: text(entry.note), ticker: typeof entry.ticker === 'string' ? entry.ticker : null, exchange: typeof entry.exchange === 'string' ? entry.exchange : null, yahooSymbol: typeof entry.yahooSymbol === 'string' ? entry.yahooSymbol : null, isPublicCompany: entry.isPublicCompany === true }));
  const coverage = objects(raw.coverage).filter((entry) => typeof entry.partId === 'string').map((entry) => ({ ...entry, status: text(entry.status), summary: text(entry.summary) }));
  const sources = objects(raw.sources).filter((entry) => typeof entry.url === 'string' && entry.url).map((entry) => ({ ...entry, id: text(entry.id), title: text(entry.title), publisher: text(entry.publisher) }));
  return { ...raw, relationships, coverage, sources };
}
