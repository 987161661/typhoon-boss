"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  BookOpen,
  Bot,
  ExternalLink,
  Eye,
  EyeOff,
  LayoutDashboard,
  PanelLeftOpen,
  RadioTower,
  Save,
  Send,
  Settings2,
  SlidersHorizontal
} from "lucide-react";
import type { LiveControlSettings } from "@/lib/liveControlSettings";

const DEFAULT_HOST_URL = "http://127.0.0.1:5173";

type SettingsStatus = "loading" | "saved" | "saving" | "error";

export function LiveOperatorControls({
  hostVisible,
  onToggleHost,
  onSendChat,
  settings,
  settingsStatus,
  onSaveSettings
}: {
  hostVisible: boolean;
  onToggleHost: () => void;
  onSendChat: (text: string) => "city" | "host";
  settings: LiveControlSettings;
  settingsStatus: SettingsStatus;
  onSaveSettings: (patch: Partial<LiveControlSettings>) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [lastSent, setLastSent] = useState("");
  const [lastDispatch, setLastDispatch] = useState<"city" | "host" | null>(null);
  const [drawerPinned, setDrawerPinned] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState(settings);
  const hostUrl = process.env.NEXT_PUBLIC_LINGLAN_HOST_URL || DEFAULT_HOST_URL;
  const linglanSettingsUrl = `${hostUrl.replace(/\/$/, "")}/?settings=1`;

  useEffect(() => setDraft(settings), [settings]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;
    setLastDispatch(onSendChat(text));
    setLastSent(text);
    setMessage("");
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSaveSettings({
      sceneRotationEnabled: draft.sceneRotationEnabled,
      briefingDurationSeconds: draft.briefingDurationSeconds,
      analysisDurationSeconds: draft.analysisDurationSeconds,
      evolutionAgentEnabled: draft.evolutionAgentEnabled,
      evolutionAgentIntervalMinutes: draft.evolutionAgentIntervalMinutes
    });
  };

  return (
    <>
      <aside
        className={`live-command-drawer ${drawerPinned ? "is-pinned" : ""}`}
        aria-label="直播版控制面板"
      >
        <button
          className="live-command-sensor"
          type="button"
          aria-expanded={drawerPinned}
          aria-controls="live-command-panel"
          onClick={() => setDrawerPinned((current) => !current)}
        >
          <i />
          <PanelLeftOpen aria-hidden="true" />
          <span>控制</span>
        </button>
        <div className="live-command-panel" id="live-command-panel">
          <header>
            <RadioTower aria-hidden="true" />
            <div>
              <span>LIVE CONTROL</span>
              <strong>导播控制台</strong>
            </div>
          </header>
          <nav aria-label="直播页面操作">
            <button type="button" onClick={onToggleHost} aria-pressed={hostVisible}>
              {hostVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              <span>{hostVisible ? "关闭数字人窗口" : "打开数字人窗口"}</span>
              <b>{hostVisible ? "ON" : "OFF"}</b>
            </button>
            <Link href="/dex">
              <BookOpen aria-hidden="true" />
              <span>进入 Boss 图鉴</span>
              <b>DEX</b>
            </Link>
            <button
              type="button"
              onClick={() => {
                setSettingsOpen((current) => !current);
                setDrawerPinned(true);
              }}
              aria-expanded={settingsOpen}
              aria-controls="live-settings-panel"
            >
              <Settings2 aria-hidden="true" />
              <span>配置设置</span>
              <b>{settingsOpen ? "OPEN" : "CFG"}</b>
            </button>
            <Link href="/">
              <LayoutDashboard aria-hidden="true" />
              <span>主界面版</span>
              <b>MAIN</b>
            </Link>
          </nav>
          <footer>
            <i /> 光标移出后自动收起
          </footer>
        </div>
      </aside>

      {settingsOpen ? (
        <aside className="live-settings-bay" id="live-settings-panel" aria-label="直播版配置设置">
          <header>
            <SlidersHorizontal aria-hidden="true" />
            <div>
              <span>CONTROL PARAMETERS</span>
              <strong>直播运行设置</strong>
            </div>
            <button type="button" onClick={() => setSettingsOpen(false)} aria-label="关闭配置设置">
              ×
            </button>
          </header>
          <form onSubmit={saveSettings}>
            <fieldset>
              <legend>页面导播</legend>
              <label className="live-setting-switch">
                <span>
                  <b>自动轮换页面</b>
                  <small>关闭后停留在当前直播画面</small>
                </span>
                <input
                  type="checkbox"
                  checked={draft.sceneRotationEnabled}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      sceneRotationEnabled: event.target.checked
                    }))
                  }
                />
                <i aria-hidden="true" />
              </label>
              <div className="live-setting-duration-grid">
                <label>
                  <span>态势页停留</span>
                  <input
                    type="number"
                    min="3"
                    max="120"
                    value={draft.briefingDurationSeconds}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        briefingDurationSeconds: Number(event.target.value)
                      }))
                    }
                  />
                  <small>秒</small>
                </label>
                <label>
                  <span>数据页停留</span>
                  <input
                    type="number"
                    min="3"
                    max="120"
                    value={draft.analysisDurationSeconds}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        analysisDurationSeconds: Number(event.target.value)
                      }))
                    }
                  />
                  <small>秒</small>
                </label>
              </div>
            </fieldset>

            <fieldset>
              <legend>实时文档整理智能体</legend>
              <label className="live-setting-switch">
                <span>
                  <b>自动整理与更新</b>
                  <small>持续汇总公开台风资料与变化</small>
                </span>
                <input
                  type="checkbox"
                  checked={draft.evolutionAgentEnabled}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      evolutionAgentEnabled: event.target.checked
                    }))
                  }
                />
                <i aria-hidden="true" />
              </label>
              <label className="live-setting-frequency">
                <span>
                  <Bot aria-hidden="true" />
                  咨询更新频率
                </span>
                <select
                  value={draft.evolutionAgentIntervalMinutes}
                  disabled={!draft.evolutionAgentEnabled}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      evolutionAgentIntervalMinutes: Number(event.target.value)
                    }))
                  }
                >
                  <option value="5">每 5 分钟</option>
                  <option value="10">每 10 分钟</option>
                  <option value="15">每 15 分钟</option>
                  <option value="30">每 30 分钟</option>
                  <option value="60">每 60 分钟</option>
                  <option value="120">每 2 小时</option>
                </select>
              </label>
            </fieldset>

            <div className="live-settings-actions">
              <a href={linglanSettingsUrl} target="_blank" rel="noreferrer">
                凌岚高级设置 <ExternalLink aria-hidden="true" />
              </a>
              <button type="submit" disabled={settingsStatus === "saving"}>
                <Save aria-hidden="true" />
                {settingsStatus === "saving" ? "保存中" : "保存并应用"}
              </button>
            </div>
            <p className={`live-settings-state is-${settingsStatus}`} role="status">
              {settingsStatus === "loading"
                ? "正在读取运行配置"
                : settingsStatus === "saving"
                  ? "正在重新安排直播任务"
                  : settingsStatus === "error"
                    ? "配置未保存，请检查后台服务"
                    : "设置已同步到当前直播进程"}
            </p>
          </form>
        </aside>
      ) : null}

      <form className="live-chat-dock" onSubmit={submit} aria-label="与凌岚聊天">
        <div className="live-chat-ident">
          <span>DIRECT LINK</span>
          <strong>和凌岚说话</strong>
        </div>
        <label htmlFor="live-linglan-chat">输入消息；@城市触发城市战况卡</label>
        <input
          id="live-linglan-chat"
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
          {lastSent
            ? lastDispatch === "city"
              ? "已触发城市战况卡"
              : "已送入凌岚对话队列"
            : "输入 @城市触发战况卡"}
        </span>
      </form>
    </>
  );
}
