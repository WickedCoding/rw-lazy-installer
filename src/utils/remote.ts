/**
 * Compare git remotes ignoring case, a trailing slash and a `.git` suffix.
 */
export function sameRemote(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const normalize = (url: string) => url.trim().toLowerCase().replace(/\/+$/, '').replace(/\.git$/, '');
  return normalize(a) === normalize(b);
}
