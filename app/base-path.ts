// Mount prefix for running this app under a sub-path (e.g. tao1.ai/explodeanything).
// Set NEXT_PUBLIC_BASE_PATH at build time; leave unset to serve from the root.
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

export function withBase(path: string): string;
export function withBase(path: string | undefined): string | undefined;
export function withBase(path: string | undefined): string | undefined {
  if (!path) return path;
  return path.startsWith('/') && !path.startsWith('//') ? `${BASE_PATH}${path}` : path;
}
