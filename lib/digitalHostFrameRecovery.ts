const STALE_RUNTIME_MS = 45_000;
const RECOVERY_COOLDOWN_MS = 60_000;

export function shouldRecoverDigitalHostFrame(input: {
  isObsBrowser: boolean;
  frameReady: boolean;
  runtimeOwnerActive?: boolean;
  queueDepth?: number;
  hostPhase?: string;
  activeTurnId?: string;
  lastEventAt?: number;
  now: number;
  lastRecoveryAt: number;
}): boolean {
  return Boolean(
    input.isObsBrowser &&
      input.frameReady &&
      input.runtimeOwnerActive === false &&
      input.hostPhase === "deliberating" &&
      (Boolean(input.activeTurnId) || (input.queueDepth ?? 0) > 0) &&
      input.lastEventAt &&
      input.now - input.lastEventAt >= STALE_RUNTIME_MS &&
      input.now - input.lastRecoveryAt >= RECOVERY_COOLDOWN_MS
  );
}
