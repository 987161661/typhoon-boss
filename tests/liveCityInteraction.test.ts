import assert from "node:assert/strict";
import test from "node:test";
import {
  extractChinaCityMention,
  isHostLiveComment,
  isHostViewerRelationEvent,
  toCityInteractionRequest,
  viewerIdentityKey
} from "../lib/liveCityInteraction";

test("city interaction only accepts a bounded Chinese @city mention", () => {
  assert.equal(extractChinaCityMention("请看 @杭州"), "杭州");
  assert.equal(extractChinaCityMention("@杭州市，天气怎样"), "杭州市");
  assert.equal(extractChinaCityMention("@深圳#战况"), "深圳");
  assert.equal(extractChinaCityMention("杭州天气如何"), null);
  assert.equal(extractChinaCityMention("@Auckland"), null);
  assert.equal(extractChinaCityMention("@杭州今天会不会下雨"), null);
});

test("city mentions retain administrative context for live-room resolution", () => {
  assert.equal(extractChinaCityMention("@吉林市"), "吉林市");
  assert.equal(extractChinaCityMention("@广东省广州市"), "广东省广州市");
  assert.equal(extractChinaCityMention("@中国北京"), "中国北京");
});

test("host bridge comment is shape-checked before it can enter the city queue", () => {
  const comment = {
    type: "aituber:live-comment",
    version: 1,
    id: "comment-1",
    text: "@北京",
    viewerName: "测试观众",
    receivedAt: 1_783_000_000_000
  } as const;
  assert.equal(isHostLiveComment(comment), true);
  assert.deepEqual(toCityInteractionRequest(comment), {
    id: "comment-1",
    cityQuery: "北京",
    viewerId: null,
    viewerName: "测试观众",
    platform: null,
    followEvidence: "unknown",
    followObservedAt: null,
    receivedAt: 1_783_000_000_000
  });
  assert.equal(isHostLiveComment({ ...comment, text: "" }), false);
  assert.equal(isHostLiveComment({ ...comment, version: 2 }), false);
});

test("viewer relation requires an exact platform and viewer id", () => {
  const event = {
    type: "aituber:viewer-relation",
    version: 1,
    id: "follow-1",
    relation: "follow",
    state: "verified",
    viewerId: "U-42",
    viewerName: "同名观众",
    platform: "BILIBILI",
    observedAt: 1_783_000_000_100
  } as const;
  assert.equal(isHostViewerRelationEvent(event), true);
  assert.equal(viewerIdentityKey(event.platform, event.viewerId), "bilibili:U-42");
  assert.notEqual(viewerIdentityKey("bilibili", "U-42"), viewerIdentityKey("douyin", "U-42"));
  assert.notEqual(viewerIdentityKey("bilibili", "U-42"), viewerIdentityKey("bilibili", "u-42"));
  assert.equal(isHostViewerRelationEvent({ ...event, viewerId: " " }), false);
});
