import assert from "node:assert/strict";
import test from "node:test";
import {
  createLiveDirectorQueueState,
  resolveIdleDirectorLens,
  retainQueuedRequestPayloads,
  selectDirectorLens,
  transitionLiveDirectorQueue,
  type DirectorCityRequest
} from "../lib/liveDirectorQueue";

const nationalRequest = (id: string): DirectorCityRequest => ({
  id,
  cityKey: id,
  lensIntent: { kind: "national" }
});

const markPresented = (
  state: ReturnType<typeof createLiveDirectorQueueState>,
  id: string,
  now: number
) => transitionLiveDirectorQueue(state, { type: "presented", id, now });

test("a queued request cannot replace the active city before ten seconds", () => {
  let state = transitionLiveDirectorQueue(createLiveDirectorQueueState(), { type: "request", request: nationalRequest("杭州"), now: 0 });
  state = markPresented(state, "杭州", 0);
  state = transitionLiveDirectorQueue(state, { type: "request", request: nationalRequest("广州"), now: 9_999 });
  assert.equal(state.active?.request.id, "杭州");
  assert.deepEqual(state.pending.map((request) => request.id), ["广州"]);

  state = transitionLiveDirectorQueue(state, { type: "tick", now: 10_000 });
  assert.equal(state.active?.request.id, "广州");
  assert.equal(state.active?.startedAt, 10_000);
});

test("a request arriving after ten seconds switches immediately", () => {
  let state = transitionLiveDirectorQueue(createLiveDirectorQueueState(), { type: "request", request: nationalRequest("杭州"), now: 100 });
  state = markPresented(state, "杭州", 100);
  state = transitionLiveDirectorQueue(state, { type: "request", request: nationalRequest("深圳"), now: 10_100 });
  assert.equal(state.active?.request.id, "深圳");
  assert.deepEqual(state.pending, []);
});

test("a city scene without new requests leaves after at most thirty seconds", () => {
  let state = transitionLiveDirectorQueue(createLiveDirectorQueueState(), { type: "request", request: nationalRequest("杭州"), now: 0 });
  state = markPresented(state, "杭州", 0);
  state = transitionLiveDirectorQueue(state, { type: "tick", now: 29_999 });
  assert.equal(state.active?.request.id, "杭州");
  state = transitionLiveDirectorQueue(state, { type: "tick", now: 30_000 });
  assert.equal(state.active, null);
});

test("lens intent is explicit and high official warnings keep the idle camera national", () => {
  assert.deepEqual(resolveIdleDirectorLens({ highestOfficialWarningLevel: null, focusedStormId: null }), { kind: "national" });
  assert.deepEqual(resolveIdleDirectorLens({ highestOfficialWarningLevel: null, focusedStormId: "storm-1" }), { kind: "typhoon", stormId: "storm-1" });
  assert.deepEqual(resolveIdleDirectorLens({ highestOfficialWarningLevel: "red", focusedStormId: "storm-1" }), { kind: "national" });

  const typhoonRequest: DirectorCityRequest = { id: "storm-city", cityKey: "海口", lensIntent: { kind: "typhoon", stormId: "storm-1" } };
  const state = transitionLiveDirectorQueue(createLiveDirectorQueueState(), { type: "request", request: typhoonRequest, now: 0 });
  assert.deepEqual(selectDirectorLens(state), { kind: "typhoon", stormId: "storm-1" });
});

test("duplicate request ids do not create duplicate queue entries", () => {
  const request = nationalRequest("杭州");
  let state = transitionLiveDirectorQueue(createLiveDirectorQueueState(), { type: "request", request, now: 0 });
  state = transitionLiveDirectorQueue(state, { type: "request", request, now: 1_000 });
  assert.equal(state.active?.request.id, "杭州");
  assert.deepEqual(state.pending, []);
});

test("completion is deferred until ten seconds and then releases to the queued request", () => {
  let state = transitionLiveDirectorQueue(createLiveDirectorQueueState(), { type: "request", request: nationalRequest("杭州"), now: 0 });
  state = markPresented(state, "杭州", 0);
  state = transitionLiveDirectorQueue(state, { type: "request", request: nationalRequest("广州"), now: 1_000 });
  state = transitionLiveDirectorQueue(state, { type: "complete", id: "杭州", now: 2_000 });
  assert.equal(state.active?.request.id, "杭州");
  assert.equal(state.active?.releaseRequested, true);
  state = transitionLiveDirectorQueue(state, { type: "tick", now: 10_000 });
  assert.equal(state.active?.request.id, "广州");
});

test("a slow city briefing keeps its slot and receives a full visible window once presented", () => {
  let state = transitionLiveDirectorQueue(
    createLiveDirectorQueueState(),
    { type: "request", request: nationalRequest("slow-city"), now: 0 }
  );

  state = transitionLiveDirectorQueue(state, { type: "tick", now: 35_000 });
  assert.equal(state.active?.request.id, "slow-city");

  state = transitionLiveDirectorQueue(state, {
    type: "presented",
    id: "slow-city",
    now: 35_000
  });
  state = transitionLiveDirectorQueue(state, { type: "tick", now: 64_999 });
  assert.equal(state.active?.request.id, "slow-city");

  state = transitionLiveDirectorQueue(state, { type: "tick", now: 65_000 });
  assert.equal(state.active, null);
});

test("operator-style front insertion remains FIFO within its priority", () => {
  let state = transitionLiveDirectorQueue(createLiveDirectorQueueState(), { type: "request", request: nationalRequest("杭州"), now: 0 });
  state = markPresented(state, "杭州", 0);
  state = transitionLiveDirectorQueue(state, { type: "request", request: nationalRequest("普通队列"), now: 1_000 });
  state = transitionLiveDirectorQueue(state, { type: "request", request: nationalRequest("操作台"), position: "front", now: 2_000 });
  assert.deepEqual(state.pending.map((request) => request.id), ["操作台", "普通队列"]);
  state = transitionLiveDirectorQueue(state, { type: "request", request: nationalRequest("操作台2"), position: "front", now: 10_000 });
  assert.equal(state.active?.request.id, "操作台2");
  assert.deepEqual(state.pending.map((request) => request.id), ["操作台", "普通队列"]);
});

test("completed request payloads are reclaimed across a long-running queue", () => {
  let state = createLiveDirectorQueueState();
  const payloads = new Map<string, { city: string }>();
  for (let index = 0; index < 1_000; index += 1) {
    const id = `city-${index}`;
    const now = index * 20_000;
    payloads.set(id, { city: id });
    state = transitionLiveDirectorQueue(state, { type: "request", request: nationalRequest(id), now });
    retainQueuedRequestPayloads(payloads, state);
    assert.ok(payloads.size <= 1);
    state = transitionLiveDirectorQueue(state, { type: "complete", id, now: now + 10_000 });
    retainQueuedRequestPayloads(payloads, state);
  }
  assert.equal(payloads.size, 0);
});
