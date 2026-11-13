import type { Mod } from '../types/mod';

/**
 * Compare git remotes ignoring case, a trailing slash and a `.git` suffix.
 */
export function sameRemote(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const normalize = (url: string) => url.trim().toLowerCase().replace(/\/+$/, '').replace(/\.git$/, '');
  return normalize(a) === normalize(b);
}

/**
 * Find the registry entry for a remote, including entries the remote moved away from.
 */
export function findRegistryMod(registry: Mod[], remote: string | undefined): Mod | undefined {
  return registry.find(m => sameRemote(m.remote, remote)) ??
    registry.find(m => m.previousRemotes?.some(r => sameRemote(r, remote)));
}
