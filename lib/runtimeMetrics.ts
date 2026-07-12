export interface RuntimeMetrics {
  snapshotRequests: number;
  snapshotBytes: number;
  snapshotLastDurationMs: number | null;
  snapshotLastGeneratedAt: string | null;
  bossProfilesLastCount: number;
}

declare global {
  var typhoonRuntimeMetrics: RuntimeMetrics | undefined;
}

export function runtimeMetrics(): RuntimeMetrics {
  globalThis.typhoonRuntimeMetrics ??= { snapshotRequests: 0, snapshotBytes: 0, snapshotLastDurationMs: null, snapshotLastGeneratedAt: null, bossProfilesLastCount: 0 };
  return globalThis.typhoonRuntimeMetrics;
}

export function recordSnapshot(bytes: number, durationMs: number, bossCount: number) {
  const metrics = runtimeMetrics();
  metrics.snapshotRequests += 1;
  metrics.snapshotBytes = bytes;
  metrics.snapshotLastDurationMs = durationMs;
  metrics.snapshotLastGeneratedAt = new Date().toISOString();
  metrics.bossProfilesLastCount = bossCount;
}
