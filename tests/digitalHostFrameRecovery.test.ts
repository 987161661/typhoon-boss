import assert from "node:assert/strict";
import test from "node:test";
import { shouldRecoverDigitalHostFrame } from "../lib/digitalHostFrameRecovery";

test("recovers a ready-to-speak turn whose browser runtime disappeared", () => {
  assert.equal(
    shouldRecoverDigitalHostFrame({
      isObsBrowser: true,
      frameReady: true,
      runtimeOwnerActive: false,
      hostPhase: "deliberating",
      activeTurnId: "viewer-turn",
      lastEventAt: 10_000,
      now: 80_000,
      lastRecoveryAt: 0
    }),
    true
  );
});

test("recovers a pending turn before an active turn id has been assigned", () => {
  assert.equal(
    shouldRecoverDigitalHostFrame({
      isObsBrowser: true,
      frameReady: true,
      runtimeOwnerActive: false,
      queueDepth: 1,
      hostPhase: "deliberating",
      lastEventAt: 1_000,
      now: 80_000,
      lastRecoveryAt: 0
    }),
    true
  );
});

test("does not reload an idle, healthy, or recently recovered frame", () => {
  const base = {
    isObsBrowser: true,
    frameReady: true,
    runtimeOwnerActive: false,
    hostPhase: "observing",
    activeTurnId: undefined,
    lastEventAt: 10_000,
    now: 80_000,
    lastRecoveryAt: 0
  };
  assert.equal(shouldRecoverDigitalHostFrame(base), false);
  assert.equal(
    shouldRecoverDigitalHostFrame({
      ...base,
      hostPhase: "deliberating",
      activeTurnId: "viewer-turn",
      lastRecoveryAt: 60_000
    }),
    false
  );
  assert.equal(
    shouldRecoverDigitalHostFrame({
      ...base,
      runtimeOwnerActive: true,
      hostPhase: "deliberating",
      activeTurnId: "viewer-turn"
    }),
    false
  );
});
