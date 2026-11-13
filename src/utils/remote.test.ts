import { describe, it, expect } from 'vitest';
import { sameRemote, findRegistryMod } from './remote.js';
import type { Mod } from '../types/mod';

describe('sameRemote', () => {
  it.each([
    ['https://gitlab.com/Nabber/rimvore-2', 'https://gitlab.com/Nabber/rimvore-2.git'],
    ['https://gitlab.com/Nabber/rimvore-2.git', 'https://gitlab.com/nabber/rimvore-2'],
    ['https://gitgud.io/a/b/', 'https://gitgud.io/a/b.git'],
  ])('treats %s and %s as the same remote', (a, b) => {
    expect(sameRemote(a, b)).toBe(true);
  });

  it('only strips .git at the end', () => {
    expect(sameRemote('https://host/a.github/b', 'https://host/ahub/b')).toBe(false);
  });

  it('never matches a missing remote', () => {
    expect(sameRemote(undefined, undefined)).toBe(false);
    expect(sameRemote('https://host/a', undefined)).toBe(false);
  });
});

describe('findRegistryMod', () => {
  const registry: Mod[] = [
    { id: 'a', name: 'a', label: 'A', remote: 'https://host/new/a.git', previousRemotes: ['https://host/old/a.git'] },
    { id: 'b', name: 'b', label: 'B', remote: 'https://host/b.git' },
  ];

  it('finds an entry by its current remote, ignoring the .git suffix', () => {
    expect(findRegistryMod(registry, 'https://host/b')?.name).toBe('b');
  });

  it('finds an entry by a remote it moved away from', () => {
    expect(findRegistryMod(registry, 'https://host/old/a')?.name).toBe('a');
  });

  it('returns undefined for an unknown remote', () => {
    expect(findRegistryMod(registry, 'https://host/c.git')).toBeUndefined();
  });
});
