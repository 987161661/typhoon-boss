import { NextResponse } from "next/server";
import { readControlConsoleSettings } from "@/lib/controlConsoleSettingsStore";
import { appendDigitalHostServiceLog, chatTextMetadata } from "@/lib/digitalHostServiceLog";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_HOST_URL = "http://127.0.0.1:5173";

export async function POST(request: Request) {
  let payload: { requestId?: unknown; text?: unknown; viewerId?: unknown; viewerName?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const requestId = typeof payload.requestId === "string" ? payload.requestId.trim() : "";
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const viewerId = typeof payload.viewerId === "string" && payload.viewerId.trim() ? payload.viewerId.trim() : "001号人类";
  const viewerName = typeof payload.viewerName === "string" && payload.viewerName.trim() ? payload.viewerName.trim() : viewerId;
  if (!requestId || !text || text.length > 500) {
    await appendDigitalHostServiceLog({ event: "bridge_fallback_failed", channel: "http-fallback", error: "invalid_chat_request" });
    return NextResponse.json({ error: "invalid_chat_request" }, { status: 400 });
  }

  const settings = await readControlConsoleSettings();
  const hostUrl = settings.digitalHostUrl || process.env.LINGLAN_HOST_URL || DEFAULT_HOST_URL;
  try {
    await appendDigitalHostServiceLog({
      event: "bridge_fallback_started",
      requestId,
      channel: "http-fallback",
      ...chatTextMetadata(text)
    });
    const response = await fetch(`${hostUrl.replace(/\/$/, "")}/api/external-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, text, viewerId, viewerName, requestedAt: Date.now() }),
      cache: "no-store",
      signal: AbortSignal.timeout(2_000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await appendDigitalHostServiceLog({
      event: "bridge_fallback_accepted",
      requestId,
      channel: "http-fallback",
      status: response.status
    });
    return NextResponse.json({ accepted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await appendDigitalHostServiceLog({
      event: "bridge_fallback_failed",
      requestId,
      channel: "http-fallback",
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json({ error: "digital_host_unavailable" }, { status: 503 });
  }
}
