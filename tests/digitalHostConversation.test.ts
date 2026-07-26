import assert from "node:assert/strict";
import test from "node:test";
import {
  activeConversations,
  conversationReplyTarget,
  HOST_REPLY_INITIAL_REVEAL_DELAY_MS,
  hostReplyRevealDelayMs,
  isHostReplyReadyEvent,
  MAX_VISIBLE_CONVERSATIONS,
  READY_CONVERSATION_RETENTION_MS,
  recordConversationPrompt,
  recordConversationReply,
  splitHostReplyText,
  WAITING_CONVERSATION_RETENTION_MS
} from "../lib/digitalHostConversation";

test("an audience turn joins the original message to Linglan's reply-ready event", () => {
  const waiting = recordConversationPrompt([], {
    id: "turn-1",
    viewerName: "雨辰",
    viewerText: "台风来了吗",
    at: 100
  });
  const ready = recordConversationReply(waiting, {
    type: "linglan:reply-ready",
    version: 1,
    requestId: "turn-1",
    replyText: "还在汕尾东南方向，先看最新路径时次。",
    kind: "audience",
    viewerName: "雨辰",
    readyAt: 200
  });

  assert.deepEqual(ready, [{
    id: "turn-1",
    kind: "audience",
    viewerName: "雨辰",
    viewerText: "台风来了吗",
    replyText: "还在汕尾东南方向，先看最新路径时次。",
    status: "ready",
    updatedAt: 200
  }]);
});

test("ambient and control speech never invent an @ target", () => {
  for (const kind of ["ambient", "control", "narration"] as const) {
    const [entry] = recordConversationReply([], {
      type: "linglan:reply-ready",
      version: 1,
      requestId: `turn-${kind}`,
      replyText: "进入下一段直播节奏。",
      kind,
      viewerName: "不应显示",
      readyAt: 300
    });
    assert.equal(entry.viewerName, null);
    assert.equal(entry.viewerText, null);
  }
});

test("reply-ready wire events are bounded and shape checked", () => {
  assert.equal(isHostReplyReadyEvent({
    type: "linglan:reply-ready",
    version: 1,
    requestId: "turn-1",
    replyText: "回复",
    kind: "audience",
    readyAt: Date.now()
  }), true);
  assert.equal(isHostReplyReadyEvent({
    type: "linglan:reply-ready",
    version: 1,
    requestId: "",
    replyText: "回复",
    kind: "audience",
    readyAt: Date.now()
  }), false);
});

test("an audience reply keeps an explicit target even when the prompt event was missed", () => {
  const [entry] = recordConversationReply([], {
    type: "linglan:reply-ready",
    version: 1,
    requestId: "turn-reply-only",
    replyText: "先看最新预警。",
    kind: "audience",
    viewerName: "海风",
    readyAt: 500
  });

  assert.equal(entry.viewerText, null);
  assert.equal(conversationReplyTarget(entry), "海风");
});

test("a reply-ready event can carry the original audience comment itself", () => {
  const [entry] = recordConversationReply([], {
    type: "linglan:reply-ready",
    version: 1,
    requestId: "turn-with-comment",
    replyText: "先看最新路径。",
    kind: "audience",
    viewerName: "海风",
    viewerText: "这个台风会转向吗？",
    readyAt: 500
  });

  assert.equal(entry.viewerName, "海风");
  assert.equal(entry.viewerText, "这个台风会转向吗？");
});

test("internal live-comment labels are removed before the panel adds its viewer prefix", () => {
  for (const viewerText of [
    "小雨的弹幕：台风会转向吗？",
    "小雨 的弹幕：台风会转向吗？",
    "@小雨：台风会转向吗？",
    "观众小雨的弹幕:台风会转向吗？",
    "观众 小雨 的弹幕：台风会转向吗？"
  ]) {
    const [entry] = recordConversationReply([], {
      type: "linglan:reply-ready",
      version: 1,
      requestId: `turn-${viewerText}`,
      replyText: "先看最新路径。",
      kind: "audience",
      viewerName: "小雨",
      viewerText,
      readyAt: 500
    });

    assert.equal(entry.viewerText, "台风会转向吗？");
    assert.equal(`@${entry.viewerName}：${entry.viewerText}`, "@小雨：台风会转向吗？");
  }
});

test("a reply-provided viewer name cleans a decorated prompt captured without a name", () => {
  const waiting = recordConversationPrompt([], {
    id: "turn-late-viewer-name",
    viewerName: null,
    viewerText: "小雨 的弹幕：台风会转向吗？",
    at: 400
  });
  const [entry] = recordConversationReply(waiting, {
    type: "linglan:reply-ready",
    version: 1,
    requestId: "turn-late-viewer-name",
    replyText: "先看最新路径。",
    kind: "audience",
    viewerName: "小雨",
    readyAt: 500
  });

  assert.equal(entry.viewerName, "小雨");
  assert.equal(entry.viewerText, "台风会转向吗？");
});

test("an audience reply keeps the original comment when the speech bridge changes its id", () => {
  const waiting = recordConversationPrompt([], {
    id: "platform-comment-1",
    viewerName: "海风",
    viewerText: "现在离汕尾还有多远？",
    at: 400
  });
  const ready = recordConversationReply(waiting, {
    type: "linglan:reply-ready",
    version: 1,
    requestId: "speech-turn-9",
    replyText: "先看最新定位。",
    kind: "audience",
    readyAt: 500
  });

  assert.deepEqual(ready, [{
    id: "speech-turn-9",
    kind: "audience",
    viewerName: "海风",
    viewerText: "现在离汕尾还有多远？",
    replyText: "先看最新定位。",
    status: "ready",
    updatedAt: 500
  }]);
});

test("reply correlation prefers the matching viewer over another queued comment", () => {
  const waiting = [
    ...recordConversationPrompt([], {
      id: "comment-a",
      viewerName: "甲",
      viewerText: "甲的问题",
      at: 100
    }),
    ...recordConversationPrompt([], {
      id: "comment-b",
      viewerName: "乙",
      viewerText: "乙的问题",
      at: 200
    })
  ];
  const ready = recordConversationReply(waiting, {
    type: "linglan:reply-ready",
    version: 1,
    requestId: "speech-b",
    replyText: "回复乙。",
    kind: "audience",
    viewerName: "乙",
    readyAt: 300
  });

  assert.equal(ready.find((entry) => entry.id === "speech-b")?.viewerText, "乙的问题");
  assert.equal(ready.some((entry) => entry.id === "comment-b"), false);
  assert.equal(ready.some((entry) => entry.id === "comment-a"), true);
});

test("the live window expires old turns and keeps only the newest visible messages", () => {
  const now = 200_000;
  const entries = [
    ...Array.from({ length: MAX_VISIBLE_CONVERSATIONS + 2 }, (_, index) => ({
      id: `ready-${index}`,
      kind: "audience" as const,
      viewerName: `观众${index}`,
      viewerText: "问题",
      replyText: "回复",
      status: "ready" as const,
      updatedAt: now - 1_000 + index
    })),
    {
      id: "expired-ready",
      kind: "audience" as const,
      viewerName: "旧观众",
      viewerText: "旧问题",
      replyText: "旧回复",
      status: "ready" as const,
      updatedAt: now - READY_CONVERSATION_RETENTION_MS
    },
    {
      id: "expired-waiting",
      kind: "audience" as const,
      viewerName: "等待过久",
      viewerText: "旧问题",
      replyText: null,
      status: "waiting" as const,
      updatedAt: now - WAITING_CONVERSATION_RETENTION_MS
    }
  ];

  assert.deepEqual(
    activeConversations(entries, now).map((entry) => entry.id),
    ["ready-2", "ready-3", "ready-4", "ready-5"]
  );
});

test("the visible conversation list also cleans decorated entries retained across hot reload", () => {
  const [entry] = activeConversations([{
    id: "retained-dirty-turn",
    kind: "audience",
    viewerName: "小雨",
    viewerText: "小雨 的弹幕：台风会转向吗？",
    replyText: "先看最新路径。",
    status: "ready",
    updatedAt: 900
  }], 1_000);

  assert.equal(entry.viewerText, "台风会转向吗？");
});

test("host replies reveal by user-visible characters with speech-like pauses", () => {
  assert.deepEqual(splitHostReplyText("台风🌊A"), ["台", "风", "🌊", "A"]);
  assert.ok(HOST_REPLY_INITIAL_REVEAL_DELAY_MS > 0);
  assert.ok(hostReplyRevealDelayMs("。") > hostReplyRevealDelayMs("，"));
  assert.ok(hostReplyRevealDelayMs("，") > hostReplyRevealDelayMs("台"));
  assert.ok(hostReplyRevealDelayMs("台") > hostReplyRevealDelayMs("A"));
});
