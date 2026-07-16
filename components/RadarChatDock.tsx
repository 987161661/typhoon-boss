"use client";

import { useState, type FormEvent } from "react";
import { Send } from "lucide-react";

export function RadarChatDock({
  className = "live-chat-dock",
  onSendChat
}: {
  className?: string;
  onSendChat: (text: string) => "city" | "host";
}) {
  const [message, setMessage] = useState("");
  const [lastDispatch, setLastDispatch] = useState<"city" | "host" | null>(null);
  const isMainDock = className.includes("main-chat-dock");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;
    setLastDispatch(onSendChat(text));
    setMessage("");
  };

  return (
    <form className={`${className} live-chat-dock`.trim()} onSubmit={submit} aria-label="与凌岚聊天">
      <div className="live-chat-ident">
        <span>DIRECT LINK</span>
        <strong>和凌岚说话</strong>
      </div>
      <label htmlFor={isMainDock ? "main-linglan-chat" : "live-linglan-chat"}>输入消息；@城市触发城市战况卡</label>
      <input
        id={isMainDock ? "main-linglan-chat" : "live-linglan-chat"}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        maxLength={500}
        autoComplete="off"
        placeholder="输入问题，或 @杭州 查看城市战况"
      />
      <button type="submit" disabled={!message.trim()}>
        <Send aria-hidden="true" />
        发送
      </button>
      <span className="live-chat-status" role="status">
        {lastDispatch === "city" ? "已触发城市战况卡" : lastDispatch === "host" ? "已送入凌岚对话队列" : "输入 @城市触发战况卡"}
      </span>
    </form>
  );
}
