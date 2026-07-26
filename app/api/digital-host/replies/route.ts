import { NextResponse } from "next/server";
import { readControlConsoleSettings } from "@/lib/controlConsoleSettingsStore";
import { queueItemToHostReplyReady } from "@/lib/digitalHostReplyRelay";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_HOST_URL = "http://127.0.0.1:5173";

export async function GET() {
  const settings = await readControlConsoleSettings();
  const hostUrl = settings.digitalHostUrl
    || process.env.LINGLAN_HOST_URL
    || DEFAULT_HOST_URL;
  try {
    const response = await fetch(
      `${hostUrl.replace(/\/$/, "")}/api/operator-queue?view=history&limit=20`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(2_000)
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as { items?: unknown[] };
    const replies = (payload.items ?? [])
      .map((item) => queueItemToHostReplyReady(item))
      .filter((item) => item !== null);
    return NextResponse.json(
      { replies },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch {
    return NextResponse.json(
      { error: "digital_host_unavailable", replies: [] },
      {
        status: 503,
        headers: { "Cache-Control": "no-store, max-age=0" }
      }
    );
  }
}
