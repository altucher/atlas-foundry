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
