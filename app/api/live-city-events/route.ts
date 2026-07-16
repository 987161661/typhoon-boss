import { NextRequest, NextResponse } from "next/server";
import {
  latestLiveCityEventSequence,
  publishLiveCityEvent,
  readLiveCityEvents
} from "@/lib/liveCityEventRelay";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  if (!publishLiveCityEvent(payload)) {
    return NextResponse.json({ error: "invalid_live_city_event" }, { status: 400 });
  }
  return NextResponse.json({ ok: true }, { headers: noStoreHeaders() });
}

export function GET(request: NextRequest) {
  const requestedAfter = request.nextUrl.searchParams.get("after");
  const latestSequence = latestLiveCityEventSequence();
  const events = requestedAfter === "latest"
    ? []
    : readLiveCityEvents(Number(requestedAfter) || 0);
  return NextResponse.json({ events, latestSequence }, { headers: noStoreHeaders() });
}

function noStoreHeaders() {
  return { "Cache-Control": "no-store, max-age=0" };
}
