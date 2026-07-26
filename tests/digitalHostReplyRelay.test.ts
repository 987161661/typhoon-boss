import assert from "node:assert/strict";
import test from "node:test";
import { queueItemToHostReplyReady } from "../lib/digitalHostReplyRelay";

test("relays a played viewer reply from the shared operator queue", () => {
  assert.deepEqual(queueItemToHostReplyReady({
    eventId: "bilibili:comment-1",
    text: "海风 的弹幕：现在到哪里了",
    source: "bilibili",
    viewerId: "viewer-1",
    viewerName: "海风",
    status: "done",
    preparedReply: "最新中心位置在这里。",
    doneAt: 1_234,
    roomContext: {
      samples: [{ viewerId: "viewer-1", text: "现在到哪里了" }]
    }
  }), {
    type: "linglan:reply-ready",
    version: 1,
    requestId: "bilibili:comment-1",
    replyText: "最新中心位置在这里。",
    kind: "audience",
    viewerName: "海风",
    viewerText: "现在到哪里了",
    source: "bilibili",
    readyAt: 1_234
  });
});

test("does not expose prepared or failed turns as broadcast replies", () => {
  for (const status of ["ready", "failed"]) {
    assert.equal(queueItemToHostReplyReady({
      eventId: `turn-${status}`,
      source: "bilibili",
      status,
      preparedReply: "尚未播出",
      updatedAt: 1_234
    }), null);
  }
});

test("classifies radar operator speech the same way as the iframe bridge", () => {
  const event = queueItemToHostReplyReady({
    eventId: "radar-chat-1",
    text: "切换到分析",
    source: "parent-message",
    viewerId: "radar-operator",
    viewerName: "雷达操作台",
    status: "speaking",
    preparedReply: "收到。",
    updatedAt: 1_234
  });
  assert.equal(event?.kind, "control");
  assert.equal(event?.viewerName, undefined);
  assert.equal(event?.viewerText, undefined);
});
