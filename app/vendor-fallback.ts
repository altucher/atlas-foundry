import { AsyncLocalStorage } from 'node:async_hooks';

// The supplier audit may run on a cheaper cell (ATLAS_VENDOR_ONLY_MODEL, e.g. openrouter/deepseek/deepseek-v4.1-flash). When that cell returns an empty audit (witness 10-13: Instant Pot, 19 parts, 0 relationships,
// every part 'searched-no-specific-evidence', job 'done' with no error) the stage is re-run ONCE on the default cell, and a still-empty result is flagged instead of finishing silently.

/** per-request override of the vendor pin: pin '' = no only_model (default cell) for this request's vendor calls */
export const vendorPinStore = new AsyncLocalStorage<{ pin: string }>();

export type SupplierPart = { suppliers?: unknown[]; supplierResearch?: { status?: string } };

export function supplierCount(parts: SupplierPart[]) {
  return parts.reduce((total, part) => total + (Array.isArray(part.suppliers) ? part.suppliers.length : 0), 0);
}

/** true when the audit is empty enough to distrust: fewer than 3 relationships, or every part ended 'searched-no-specific-evidence' */
export function auditLooksEmpty(parts: SupplierPart[]) {
  if (!parts.length) return false;
  if (supplierCount(parts) < 3) return true;
  return parts.every((part) => part.supplierResearch?.status === 'searched-no-specific-evidence');
}

type AuditPart = { id: string; suppliers?: unknown[]; supplierResearch?: unknown };
type AuditAtlas = { parts: AuditPart[]; sources: Array<{ url?: string; id?: string }> };

/** the share of parts that ended with no retained relationship */
export function unsourcedShare(parts: SupplierPart[]) {
  if (!parts.length) return 0;
  return parts.filter((part) => !(Array.isArray(part.suppliers) && part.suppliers.length)).length / parts.length;
}

/**
 * HYBRID (flash first, K3 for the gaps): take the cheap pass, then replace ONLY the parts it left without a relationship by what the default cell found for them (when it found any).
 * Sources are the union by url (relationships cite urls, not source ids), ids renumbered. Pure, tested.
 */
export function mergeAudits<A extends AuditAtlas>(first: A, second: A): A {
  const byId = new Map(second.parts.map((part) => [part.id, part]));
  const parts = first.parts.map((part) => {
    if (Array.isArray(part.suppliers) && part.suppliers.length) return part;
    const other = byId.get(part.id);
    return other && Array.isArray(other.suppliers) && other.suppliers.length ? { ...part, suppliers: other.suppliers, supplierResearch: other.supplierResearch } : part;
  });
  const seen = new Set<string>();
  const sources = [...first.sources, ...second.sources].filter((source) => {
    const key = source.url ?? '';
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((source, index) => ({ ...source, id: `source-${index + 1}` }));
  return { ...first, parts, sources };
}
