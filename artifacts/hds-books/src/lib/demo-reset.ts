export const DEMO_PREFIX = 'hds_pf_';

type StorageLike = Pick<Storage, 'length' | 'key' | 'removeItem'>;

function clear(storage: StorageLike | null | undefined): number {
  if (!storage) return 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(DEMO_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => storage.removeItem(k));
    return keys.length;
  } catch {
    return 0;
  }
}

/** Remove every hds_pf_ key from both storages; other apps' keys are untouched. */
export function resetDemoStorage(local: StorageLike | null | undefined, session: StorageLike | null | undefined): number {
  return clear(local) + clear(session);
}

function safe(get: () => Storage): Storage | null {
  try { return get(); } catch { return null; }
}

/** Clear storage and reload the app's base URL; a new server session follows. */
export function resetDemo() {
  resetDemoStorage(safe(() => window.localStorage), safe(() => window.sessionStorage));
  window.location.assign(import.meta.env.BASE_URL);
}
