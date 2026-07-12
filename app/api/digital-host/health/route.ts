import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_HOST_URL = "http://127.0.0.1:5173";

export async function GET() {
  const hostUrl = process.env.LINGLAN_HOST_URL || DEFAULT_HOST_URL;
  try {
    const response = await fetch(
      `${hostUrl.replace(/\/$/, "")}/api/live-runtime-health`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(2_000)
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store, max-age=0" }
    });
  } catch {
    return NextResponse.json(
      {
        error: "digital_host_unavailable",
        queueDepth: 0,
        isSpeaking: false,
        supervisor: { state: "offline", connectedClients: 0 }
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store, max-age=0" }
      }
    );
  }
}
