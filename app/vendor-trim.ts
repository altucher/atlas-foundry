// ATLAS_VENDOR_TRIM=1: the supplier audit's output is ~42k tokens (75% of an explode's cost) and the long notes dominate it. Same companies and links, shorter notes, at most 4 relationships per component.

export const VENDOR_OUTPUT_BUDGET = '\n\nOUTPUT BUDGET (hard limits): every note at most 280 characters (one or two short sentences: the role, the product/version/time scope and what the cited source establishes; do not repeat the source title or the company name); at most 4 relationships per component (keep the best-evidenced, mark the rest out of scope); every coverage summary at most 200 characters.';

type SchemaLike = { properties: { relationships: unknown; coverage: unknown } };

/** a copy of the supplier schema with a note/summary length cap and a relationship cap proportional to the batch; the input is never mutated */
export function trimSupplierSchema<T extends SchemaLike>(base: T, partCount: number): T {
  const copy = JSON.parse(JSON.stringify(base)) as T;
  const rel = copy.properties.relationships as { maxItems?: number; items: { properties: { note: Record<string, unknown> } } };
  rel.maxItems = Math.max(4, partCount * 4);
  rel.items.properties.note = { type: 'string', maxLength: 280 };
  const cov = copy.properties.coverage as { items: { properties: { summary: Record<string, unknown> } } };
  cov.items.properties.summary = { type: 'string', maxLength: 200 };
  return copy;
}
