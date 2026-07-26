import assert from "node:assert/strict";
import test from "node:test";
import {
  latestLiveCityEventSequence,
  publishLiveCityEvent,
  readLiveCityEvents
} from "../lib/liveCityEventRelay";

test("gateway relay stores only valid host comments and advances its cursor", () => {
  const before = readLiveCityEvents(0).at(-1)?.sequence ?? 0;
  assert.equal(publishLiveCityEvent({ type: "wrong" }), false);
  assert.equal(publishLiveCityEvent({
    type: "aituber:live-comment",
    version: 1,
    id: "gateway-city-1",
    text: "@上海",
    viewerId: "viewer-1",
    viewerName: "观众",
    platform: "bilibili",
    receivedAt: 1
  }), true);
  const [stored] = readLiveCityEvents(before);
  assert.equal(stored.event.text, "@上海");
  assert.equal(readLiveCityEvents(stored.sequence).length, 0);
});

test("a freshly mounted live page can align to the latest cursor without replaying history", () => {
  const latest = latestLiveCityEventSequence();
  assert.equal(readLiveCityEvents(latest).length, 0);
});

test("gateway retries are idempotent by live event id", () => {
  const before = latestLiveCityEventSequence();
  const event = {
    type: "aituber:live-comment" as const,
    version: 1 as const,
    id: "gateway-city-retry-1",
    text: "@深圳",
    viewerId: "viewer-1",
    platform: "bilibili",
    receivedAt: 1_785_021_786_217
  };

  assert.equal(publishLiveCityEvent(event), true);
  assert.equal(publishLiveCityEvent(event), true);
  assert.equal(latestLiveCityEventSequence(), before + 1);
  assert.equal(
    readLiveCityEvents(before).filter((item) => item.event.id === event.id).length,
    1
  );
});
