export interface StaleWhileRefreshCacheOptions<T> {
  loader: () => Promise<T>;
  readPersisted: () => Promise<T | null>;
  ttlMs: number;
  now?: () => number;
}

/**
 * Returns the last usable value immediately and refreshes it in the background.
 * A caller blocks only when neither memory nor persisted storage has a value.
 */
export function createStaleWhileRefreshCache<T>({
  loader,
  readPersisted,
  ttlMs,
  now = Date.now
}: StaleWhileRefreshCacheOptions<T>) {
  let memory: { value: T; expiresAt: number } | null = null;
  let refreshInFlight: Promise<T> | null = null;

  const beginRefresh = () => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = loader()
      .then((value) => {
        memory = { value, expiresAt: now() + ttlMs };
        return value;
      })
      .finally(() => {
        refreshInFlight = null;
      });
    return refreshInFlight;
  };

  const refreshInBackground = () => {
    void beginRefresh().catch(() => undefined);
  };

  return {
    async get() {
      const cached = memory;
      if (cached?.expiresAt && cached.expiresAt > now()) return cached.value;
      if (cached) {
        refreshInBackground();
        return cached.value;
      }

      const persisted = await readPersisted();
      if (persisted) {
        memory = { value: persisted, expiresAt: now() + ttlMs };
        refreshInBackground();
        return persisted;
      }
      return beginRefresh();
    }
  };
}
