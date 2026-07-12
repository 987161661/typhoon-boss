import { NextResponse } from "next/server";
import { appendDigitalHostServiceLog } from "@/lib/digitalHostServiceLog";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const EVENT_NAMES = new Set([
  "delivery_postmessage_sent",
  "delivery_postmessage_ack",
  "bridge_fallback_started",
  "bridge_fallback_accepted",
  "bridge_fallback_failed",
  "fact_validation_rewrite",
  "sanitizer_failure",
  "tts_rate_limit"
]);

export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const event = typeof payload.event === "string" ? payload.event : payload.stage;
  if (typeof event !== "string" || !EVENT_NAMES.has(event)) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }
  const reasons = Array.isArray(payload.reasons)
    ? payload.reasons.filter((reason): reason is string => typeof reason === "string")
    : undefined;
  await appendDigitalHostServiceLog({
    event,
    requestId: typeof payload.requestId === "string" ? payload.requestId.slice(0, 120) : undefined,
    channel:
      payload.channel === "postmessage" || payload.channel === "http-fallback" || payload.channel === "virtual-runtime"
        ? payload.channel
        : "virtual-runtime",
    reasons,
    status: typeof payload.status === "number" ? payload.status : undefined,
    error: typeof payload.error === "string" ? payload.error : undefined,
    at: typeof payload.at === "number" ? payload.at : undefined
  });
  return NextResponse.json({ accepted: true }, { headers: { "Cache-Control": "no-store" } });
}
