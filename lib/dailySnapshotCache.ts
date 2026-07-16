export type SnapshotClock = () => Date;
export type DailySnapshotLoader<T> = (dayKey: string) => Promise<T>;
export type SnapshotCachePolicy<T> = (value: T) => boolean;

/** Beijing civil day key used by city ranking snapshots. */
export function beijingDayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

/**
 * Process-wide instances of this repository can be shared by route requests.
 * The day key, completed value and in-flight load are separate so concurrent
 * city questions cannot start duplicate ranking crawls.
 */
export class DailySnapshotCache<T> {
  private readonly values = new Map<string, T>();
  private readonly inFlight = new Map<string, Promise<T>>();

  constructor(
    private readonly loader: DailySnapshotLoader<T>,
    private readonly clock: SnapshotClock = () => new Date(),
    private readonly dayKey: (date: Date) => string = beijingDayKey,
    private readonly shouldCache: SnapshotCachePolicy<T> = () => true
  ) {}

  get(): Promise<T> {
    const key = this.dayKey(this.clock());
    const cached = this.values.get(key);
    if (cached !== undefined) return Promise.resolve(cached);

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const load = Promise.resolve()
      .then(() => this.loader(key))
      .then((value) => {
        if (this.shouldCache(value)) {
          this.values.set(key, value);
          this.retainCurrentAndPreviousDay(key);
        }
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, load);
    return load;
  }

  invalidate(dayKey?: string) {
    if (dayKey) {
      this.values.delete(dayKey);
      return;
    }
    this.values.clear();
  }

  private retainCurrentAndPreviousDay(currentKey: string) {
    const otherKeys = [...this.values.keys()].filter((key) => key !== currentKey).sort().reverse();
    for (const key of otherKeys.slice(1)) this.values.delete(key);
  }
}
