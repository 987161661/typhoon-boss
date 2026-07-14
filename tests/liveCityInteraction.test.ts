import assert from "node:assert/strict";
import test from "node:test";
import {
  extractChinaCityMention,
  isHostLiveComment,
  toCityInteractionRequest
} from "../lib/liveCityInteraction";

test("city interaction only accepts a bounded Chinese @city mention", () => {
  assert.equal(extractChinaCityMention("请看 @杭州"), "杭州");
  assert.equal(extractChinaCityMention("@杭州市，天气怎样"), "杭州");
  assert.equal(extractChinaCityMention("@深圳#战况"), "深圳");
  assert.equal(extractChinaCityMention("杭州天气如何"), null);
  assert.equal(extractChinaCityMention("@Auckland"), null);
  assert.equal(extractChinaCityMention("@杭州今天会不会下雨"), null);
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
    viewerName: "测试观众",
    receivedAt: 1_783_000_000_000
  });
  assert.equal(isHostLiveComment({ ...comment, text: "" }), false);
  assert.equal(isHostLiveComment({ ...comment, version: 2 }), false);
});
